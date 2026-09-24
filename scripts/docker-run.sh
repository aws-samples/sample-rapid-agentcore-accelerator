#!/bin/bash
# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

# Run an agent container locally, optionally building it first.
#
# AgentCore Runtime requires ARM64, so --build builds for linux/arm64 to match
# what gets deployed. On an x86 host that needs emulation — see
# docs/troubleshooting.md.
#
# AWS credentials are resolved on the host and passed in as environment
# variables, in this order:
#   1. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN, if already
#      set in the environment.
#   2. `aws configure export-credentials`, which runs the host credential chain.
#      This covers static profiles, credential_process, SSO, and assume-role.
#      Select a profile with AWS_PROFILE.
# ~/.aws is deliberately not mounted — see the comment above
# export_host_credentials for why that does not work.
#
# Usage: scripts/docker-run.sh <agent> [OPTIONS]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUTS_FILE="$REPO_ROOT/.rapid/outputs.json"

PORT="${PORT:-8080}"
# Not defaulted to "default": a [default] profile holding only `region` (common
# when every real profile is named) resolves to no credentials at all, and forcing
# it here hid the host's actual working credential chain.
AWS_PROFILE_EXPLICIT="${AWS_PROFILE:-}"
DEBUG="${DEBUG:-true}"
BUILD="false"
AGENT_NAME=""

usage() {
    echo "Usage: scripts/docker-run.sh <agent> [OPTIONS]"
    echo ""
    echo "Arguments:"
    echo "  <agent>          Agent name as it appears in config.yaml (e.g. customer-support)"
    echo ""
    echo "Options:"
    echo "  --build, -b      Build the image (linux/arm64) before running"
    echo "  --port, -p PORT  Host port to publish (default: 8080)"
    echo "  --help, -h       Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  PORT               Host port to publish (default: 8080)"
    echo "  DEBUG              Enable agent debug logging (default: true)"
    echo "  AWS_PROFILE        Profile to resolve credentials from (default: host credential chain)"
    echo "  MEMORY_ID          AgentCore Memory ID; omit for in-session history only"
    echo "  KNOWLEDGE_BASE_ID  Bedrock Knowledge Base ID; enables RAG retrieval"
    echo "  MCP_RUNTIME_ARN    MCP server runtime ARN; enables MCP tools"
    echo ""
    echo "Examples:"
    echo "  scripts/docker-run.sh customer-support --build"
    echo "  KNOWLEDGE_BASE_ID=AG3AOYZKU7 scripts/docker-run.sh customer-support"
    echo "  make docker-run AGENT=it-helpdesk"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --build|-b)
            BUILD="true"
            shift
            ;;
        --port|-p)
            PORT="$2"
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        -*)
            echo "Unknown option: $1" >&2
            echo "Use --help for usage information" >&2
            exit 1
            ;;
        *)
            if [ -n "$AGENT_NAME" ]; then
                echo "Unexpected argument: $1" >&2
                echo "Use --help for usage information" >&2
                exit 1
            fi
            AGENT_NAME="$1"
            shift
            ;;
    esac
done

if [ -z "$AGENT_NAME" ]; then
    echo "Error: no agent name given." >&2
    echo "" >&2
    usage >&2
    exit 1
fi

AGENT_SRC_DIR="$REPO_ROOT/agent/$AGENT_NAME/src"
if [ ! -d "$AGENT_SRC_DIR" ]; then
    echo "Error: unknown agent \"$AGENT_NAME\" — agent/$AGENT_NAME/src does not exist." >&2
    echo "" >&2
    echo "Available agents:" >&2
    for dir in "$REPO_ROOT"/agent/*/src; do
        [ -d "$dir" ] || continue
        echo "  $(basename "$(dirname "$dir")")" >&2
    done
    exit 1
fi

# Image name is per-agent so two agents cannot overwrite each other's image.
IMAGE_NAME="rapid-$AGENT_NAME-agent"

# Prefer the region the agent was actually deployed into, taken from its runtime
# ARN, so container-side Bedrock and Memory calls land in the same region as the
# deployed resources. config.yaml is not consulted: it can have been edited since
# the last deploy, which is exactly when a silent region mismatch is worst.
ENV_REGION="${AWS_DEFAULT_REGION:-$AWS_REGION}"
DEPLOYED_REGION=""
if [ -r "$OUTPUTS_FILE" ] && command -v jq &> /dev/null; then
    runtime_arn=$(jq -r --arg name "$AGENT_NAME" \
        '.agents[$name].runtimeArn // empty' "$OUTPUTS_FILE" 2>/dev/null)
    if [ -n "$runtime_arn" ]; then
        DEPLOYED_REGION=$(echo "$runtime_arn" | cut -d: -f4)
    fi
fi
AWS_REGION="${DEPLOYED_REGION:-${ENV_REGION:-us-east-1}}"

if [ "$BUILD" = "true" ]; then
    echo "Building $IMAGE_NAME for linux/arm64..."
    docker build --platform linux/arm64 -t "$IMAGE_NAME" "$AGENT_SRC_DIR"
    echo "✓ Build complete: $IMAGE_NAME"
    echo ""
fi

if ! docker image inspect "$IMAGE_NAME" > /dev/null 2>&1; then
    echo "Error: image \"$IMAGE_NAME\" not found locally." >&2
    echo "Run with --build to build it first:" >&2
    echo "  scripts/docker-run.sh $AGENT_NAME --build" >&2
    exit 1
fi

if [ -z "$MEMORY_ID" ]; then
    echo "Note: MEMORY_ID not set — running without AgentCore Memory (in-session history only)"
    echo ""
fi

if [ -n "$KNOWLEDGE_BASE_ID" ]; then
    echo "Note: KNOWLEDGE_BASE_ID set — RAG retrieval enabled"
    echo ""
fi

if [ -n "$MCP_RUNTIME_ARN" ]; then
    echo "Note: MCP_RUNTIME_ARN set — MCP tools enabled"
    echo ""
fi

# Resolve credentials on the host and hand the container the resulting keys.
#
# Mounting ~/.aws does not work for most real setups, and fails silently:
#   - credential_process (aws-vault, saml2aws, or any corporate credential helper)
#     and sso_session both invoke host binaries or read a host token cache that
#     the image does not have
#   - the files are typically mode 600 owned by the host uid, while the image runs
#     as uid 1000 (USER bedrock_agentcore), so botocore cannot even read them
#   - a [default] profile carrying only `region` looks like a valid profile to a
#     grep-based check, so the mount was reported as a success
# In every one of those cases the container starts clean and the first turn dies
# with NoCredentialsError from inside botocore.
#
# `aws configure export-credentials` runs the full host credential chain — static
# keys, credential_process, SSO, assume-role — and returns the resolved keys, so
# whatever works for `aws` on the host works in the container.
export_host_credentials() {
    local out
    if [ -n "$AWS_PROFILE_EXPLICIT" ]; then
        out=$(aws configure export-credentials --format env-no-export \
            --profile "$AWS_PROFILE_EXPLICIT" 2>/dev/null) || return 1
    else
        out=$(aws configure export-credentials --format env-no-export 2>/dev/null) || return 1
    fi
    [ -n "$out" ] || return 1

    # Parsed rather than eval'd, and the values are never echoed.
    local key value
    while IFS='=' read -r key value; do
        case "$key" in
            AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)
                export "$key=$value"
                ;;
            AWS_CREDENTIAL_EXPIRATION)
                CREDENTIAL_EXPIRATION="$value"
                ;;
        esac
    done <<< "$out"

    [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ]
}

# Passing "-e VAR" without a value makes docker read it from this process's
# environment, so credentials never appear in the container's argv or in `ps`.
CREDENTIAL_ENV_ARGS="-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN"
CREDENTIAL_EXPIRATION=""

if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ]; then
    # Explicit keys in the environment win: the caller has already chosen.
    echo "Note: Using AWS credentials from environment variables"
    AWS_MOUNT_ARGS="$CREDENTIAL_ENV_ARGS"
    echo ""
elif command -v aws &> /dev/null && export_host_credentials; then
    if [ -n "$AWS_PROFILE_EXPLICIT" ]; then
        echo "Note: Resolved AWS credentials from profile '$AWS_PROFILE_EXPLICIT' (passed as environment variables)"
    else
        echo "Note: Resolved AWS credentials from the default host credential chain"
    fi
    if [ -n "$CREDENTIAL_EXPIRATION" ]; then
        echo "      These are temporary credentials and expire at $CREDENTIAL_EXPIRATION."
        echo "      Restart the container after that to pick up fresh ones."
    fi
    AWS_MOUNT_ARGS="$CREDENTIAL_ENV_ARGS"
    echo ""
else
    # Say so now, loudly. Otherwise the container starts fine and the failure
    # surfaces on the first turn as a botocore NoCredentialsError in the logs.
    echo "Warning: Could not resolve AWS credentials on this host."
    if ! command -v aws &> /dev/null; then
        echo "         The AWS CLI is not installed, so credentials cannot be resolved"
        echo "         from ~/.aws. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY instead."
    else
        if [ -n "$AWS_PROFILE_EXPLICIT" ]; then
            echo "         Profile '$AWS_PROFILE_EXPLICIT' did not yield credentials. Check it with:"
            echo "           aws sts get-caller-identity --profile $AWS_PROFILE_EXPLICIT"
        else
            echo "         No default credentials found. Check with: aws sts get-caller-identity"
        fi
        available=$(grep -hoE "^\[(profile[[:space:]]+)?[^]]+\]" \
            "$HOME/.aws/config" "$HOME/.aws/credentials" 2>/dev/null \
            | sed -E 's/^\[(profile[[:space:]]+)?//; s/\]$//' | sort -u | tr '\n' ' ')
        if [ -n "$available" ]; then
            echo "         Profiles in ~/.aws: $available"
            echo "         Select one with: AWS_PROFILE=<name> make docker-run AGENT=$AGENT_NAME"
        fi
    fi
    echo ""
    echo "The agent will start, but Bedrock calls will fail until credentials are available."
    echo ""
    AWS_MOUNT_ARGS=""
fi

echo "Starting $AGENT_NAME on port $PORT (region: $AWS_REGION)..."
echo "Chat with it in another shell: make chat AGENT=$AGENT_NAME CHAT_ARGS=--local"
echo ""

# AWS_MOUNT_ARGS is intentionally unquoted: it carries multiple docker flags.
# shellcheck disable=SC2086
docker run -p "$PORT:8080" \
    -e DEBUG="$DEBUG" \
    -e MEMORY_ID="$MEMORY_ID" \
    -e KNOWLEDGE_BASE_ID="$KNOWLEDGE_BASE_ID" \
    -e MCP_RUNTIME_ARN="$MCP_RUNTIME_ARN" \
    -e AWS_DEFAULT_REGION="$AWS_REGION" \
    $AWS_MOUNT_ARGS \
    "$IMAGE_NAME" \
    python -m main
