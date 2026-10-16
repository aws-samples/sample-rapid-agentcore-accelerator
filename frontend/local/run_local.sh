#!/bin/bash
# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

# Run the Next.js chat frontend locally (http://localhost:3000)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/.."
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUTS_FILE="$REPO_ROOT/.rapid/outputs.json"

# Load environment variables from .env file if present
ENV_FILE="$SCRIPT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    echo "✅ Loading environment from $ENV_FILE"
    set -a
    source "$ENV_FILE"
    set +a
fi

# Fallback: when no agent target is set, offer every deployed agent from
# .rapid/outputs.json (auto-wired deploy outputs) as AGENT_REGISTRY.
if [ -z "$AGENT_REGISTRY" ] && [ -z "$AGENTCORE_RUNTIME_ARN" ] && [ -z "$LOCAL_AGENT_URL" ]; then
    if [ ! -f "$OUTPUTS_FILE" ]; then
        echo "❌ Outputs not found — run \`make deploy\` first." >&2
        exit 1
    fi

    if ! command -v jq &>/dev/null; then
        echo "❌ jq is required. Install jq and try again." >&2
        exit 1
    fi

    REGISTRY=$(jq -c '.agents // {} | map_values(.runtimeArn) | with_entries(select(.value != null))' "$OUTPUTS_FILE" 2>/dev/null)
    if [ -z "$REGISTRY" ] || [ "$REGISTRY" = "{}" ]; then
        echo "❌ No agent runtime ARNs found in outputs — run \`make deploy\` first." >&2
        exit 1
    fi
    export AGENT_REGISTRY="$REGISTRY"
    echo "✅ Loaded agents from $OUTPUTS_FILE: $(echo "$REGISTRY" | jq -r 'keys | join(", ")')"

    # Auto-detect region from an ARN (arn:aws:bedrock-agentcore:<region>:...)
    DETECTED_REGION=$(echo "$REGISTRY" | jq -r 'to_entries | first | .value' | cut -d: -f4)
    if [ -n "$DETECTED_REGION" ] && [ -z "$AWS_REGION" ]; then
        export AWS_REGION="$DETECTED_REGION"
        echo "✅ Auto-detected AWS_REGION=$AWS_REGION from ARN"
    fi
fi

if [ -n "$LOCAL_AGENT_URL" ]; then
    echo "🔌 Local Agent URL: $LOCAL_AGENT_URL"
else
    echo "📍 AWS Region: ${AWS_REGION:-us-west-2}"
    if ! aws sts get-caller-identity &>/dev/null; then
        echo "❌ No AWS credentials found. Configure a profile or set environment credentials." >&2
        exit 1
    fi
    echo "✅ AWS credentials found"
fi

if ! command -v npm &>/dev/null; then
    echo "❌ Node.js (npm) is required. Install Node.js 22 and try again." >&2
    exit 1
fi

cd "$APP_DIR"
if [ ! -d node_modules ]; then
    echo "📦 Installing frontend dependencies..."
    npm ci
fi

echo ""
echo "🚀 Starting chat frontend on http://localhost:3000 ..."
exec npm run dev -- --hostname localhost --port 3000
