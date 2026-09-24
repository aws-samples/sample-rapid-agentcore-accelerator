#!/bin/bash
# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

# Run the Streamlit frontend locally

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/../src"
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

# Fallback: when AGENTCORE_RUNTIME_ARN and LOCAL_AGENT_URL are both unset,
# read the ARN from .rapid/outputs.json (auto-wired deploy outputs).
if [ -z "$AGENTCORE_RUNTIME_ARN" ] && [ -z "$LOCAL_AGENT_URL" ]; then
    if [ ! -f "$OUTPUTS_FILE" ]; then
        echo "❌ Outputs not found — run \`make deploy\` first." >&2
        exit 1
    fi

    if ! command -v jq &>/dev/null; then
        echo "❌ jq is required. Install jq and try again." >&2
        exit 1
    fi

    ARN=$(jq -r '.agents | to_entries | first | .value.runtimeArn // empty' "$OUTPUTS_FILE" 2>/dev/null)
    if [ -z "$ARN" ]; then
        echo "❌ No agent runtime ARN found in outputs — run \`make deploy\` first." >&2
        exit 1
    fi
    export AGENTCORE_RUNTIME_ARN="$ARN"
    echo "✅ Loaded AGENTCORE_RUNTIME_ARN from $OUTPUTS_FILE"

    # Auto-detect region from the ARN (arn:aws:bedrock-agentcore:<region>:...)
    DETECTED_REGION=$(echo "$ARN" | cut -d: -f4)
    if [ -n "$DETECTED_REGION" ] && [ -z "$AWS_REGION" ]; then
        export AWS_REGION="$DETECTED_REGION"
        echo "✅ Auto-detected AWS_REGION=$AWS_REGION from ARN"
    fi
fi

# Show configuration
echo "📍 AWS Region: ${AWS_REGION:-us-west-2}"
echo "🔧 Local Mode: ${LOCAL_MODE:-false}"

if [ -n "$LOCAL_AGENT_URL" ]; then
    echo "🔌 Local Agent URL: $LOCAL_AGENT_URL"
    echo "   (Will connect to locally running agent)"
elif [ -n "$AGENTCORE_RUNTIME_ARN" ]; then
    echo "🤖 Runtime ARN: ${AGENTCORE_RUNTIME_ARN:0:50}..."
else
    echo "⚠️  No AGENTCORE_RUNTIME_ARN or LOCAL_AGENT_URL configured"
fi

# Check AWS credentials if not using local agent
if [ -z "$LOCAL_AGENT_URL" ] && [ "${LOCAL_MODE:-false}" = "true" ]; then
    if aws sts get-caller-identity &>/dev/null; then
        echo "✅ AWS credentials found"
    else
        echo "❌ No AWS credentials found. Please run 'aws configure' or set environment variables."
        exit 1
    fi
fi

echo ""
echo "🚀 Starting Streamlit frontend..."

cd "$SRC_DIR"
uv run streamlit run app.py --server.port 8501 --server.address localhost
