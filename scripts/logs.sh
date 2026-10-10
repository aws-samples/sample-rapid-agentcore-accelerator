#!/bin/bash
# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

#
# logs.sh — Tail a deployed agent runtime's CloudWatch logs
#
# Reads the runtime ARN for the named agent from .rapid/outputs.json, derives
# the CloudWatch log group from the runtime ID, and tails it.
#
# Usage: scripts/logs.sh <agent>
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUTS_FILE="${REPO_ROOT}/.rapid/outputs.json"

usage() {
  echo "Usage: scripts/logs.sh <agent>"
  echo ""
  echo "  <agent>  Agent name as it appears in config.yaml (e.g. customer-support)"
  echo ""
  echo "Examples:"
  echo "  scripts/logs.sh it-helpdesk"
  echo "  make logs AGENT=it-helpdesk"
}

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 1
fi
if [[ "$1" == "--help" || "$1" == "-h" ]]; then
  usage
  exit 0
fi
AGENT_NAME="$1"

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required. Install jq and try again." >&2
  exit 1
fi

if [[ ! -r "${OUTPUTS_FILE}" ]]; then
  echo "ERROR: Outputs not found at ${OUTPUTS_FILE} — run 'make deploy' first." >&2
  exit 1
fi

AGENT_RUNTIME_ARN=$(jq -r --arg name "${AGENT_NAME}" \
  '.agents[$name].runtimeArn // empty' "${OUTPUTS_FILE}")

# No fallback to "the first agent": tailing a different agent's logs than the
# one asked for is worse than failing.
if [[ -z "${AGENT_RUNTIME_ARN}" ]]; then
  echo "ERROR: no deployed runtime for agent \"${AGENT_NAME}\" in .rapid/outputs.json." >&2
  echo "" >&2
  echo "Agents present in outputs:" >&2
  jq -r '.agents | keys[] | "  " + .' "${OUTPUTS_FILE}" >&2 2>/dev/null \
    || echo "  (none)" >&2
  exit 1
fi

# ARN format: arn:aws:bedrock-agentcore:<region>:<account>:runtime/<runtime-id>
RUNTIME_ID="${AGENT_RUNTIME_ARN##*/}"
RUNTIME_REGION=$(echo "${AGENT_RUNTIME_ARN}" | cut -d: -f4)
LOG_GROUP="/aws/bedrock-agentcore/runtimes/${RUNTIME_ID}-DEFAULT"

echo "Tailing logs for agent: ${AGENT_NAME} (${RUNTIME_ID})"
echo "Log group: ${LOG_GROUP}"
echo "---"

aws logs tail "${LOG_GROUP}" --follow --region "${RUNTIME_REGION}"
