#!/bin/bash
# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

# Run the Streamlit frontend container locally

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configuration
IMAGE_NAME="streamlit-frontend"
PORT="${PORT:-8501}"
AWS_REGION="${AWS_REGION:-us-west-2}"

# Load .env file if it exists
ENV_FILE="$SCRIPT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    echo "Loading environment from $ENV_FILE"
    set -a
    source "$ENV_FILE"
    set +a
fi

# Show configuration
if [ -n "$LOCAL_AGENT_URL" ]; then
    echo "🔌 Local Agent URL: $LOCAL_AGENT_URL"
elif [ -n "$AGENTCORE_RUNTIME_ARN" ]; then
    echo "🤖 Runtime ARN: ${AGENTCORE_RUNTIME_ARN:0:50}..."
else
    echo "⚠️  No LOCAL_AGENT_URL or AGENTCORE_RUNTIME_ARN configured"
fi

echo ""
echo "Starting Streamlit frontend on port $PORT..."

# Note: Use host.docker.internal for LOCAL_AGENT_URL when connecting to agent on host
docker run -p "$PORT:8501" \
    -e LOCAL_AGENT_URL="$LOCAL_AGENT_URL" \
    -e AGENTCORE_RUNTIME_ARN="$AGENTCORE_RUNTIME_ARN" \
    -e AWS_REGION="$AWS_REGION" \
    -e COGNITO_AUTH_ENABLED="${COGNITO_AUTH_ENABLED:-false}" \
    -e AWS_ACCESS_KEY_ID \
    -e AWS_SECRET_ACCESS_KEY \
    -e AWS_SESSION_TOKEN \
    "$IMAGE_NAME"
