#!/bin/bash
# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

#
# logs.sh — Tail the deployed agent runtime CloudWatch logs
#
# Reads the agent runtime ARN from .rapid/outputs.json, derives the
# CloudWatch log group name from the runtime identity, and tails the logs.
#
set -euo pipefail

# Determine repo root from the script's location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

OUTPUTS_FILE="${REPO_ROOT}/.rapid/outputs.json"

# --- Validate outputs file exists ---
if [[ ! -f "${OUTPUTS_FILE}" ]]; then
  echo "ERROR: Outputs file not found at ${OUTPUTS_FILE}" >&2
  echo "       Run 'make deploy' first to generate deploy outputs." >&2
  exit 1
fi

# --- Extract agent runtime ARN ---
AGENT_RUNTIME_ARN=$(jq -r '.agentRuntimeArn // ""' "${OUTPUTS_FILE}")

if [[ -z "${AGENT_RUNTIME_ARN}" ]]; then
  echo "ERROR: agentRuntimeArn is empty in ${OUTPUTS_FILE}" >&2
  echo "       Run 'make deploy' first to deploy the agent runtime." >&2
  exit 1
fi

# --- Derive runtime name from ARN ---
# ARN format: arn:aws:bedrock-agentcore:<region>:<account>:runtime/<runtime-name>
RUNTIME_NAME="${AGENT_RUNTIME_ARN##*/}"
RUNTIME_REGION=$(echo "$AGENT_RUNTIME_ARN" | cut -d: -f4)

if [[ -z "${RUNTIME_NAME}" ]]; then
  echo "ERROR: Could not extract runtime name from ARN: ${AGENT_RUNTIME_ARN}" >&2
  exit 1
fi

# --- Derive CloudWatch log group ---
LOG_GROUP="/aws/bedrock-agentcore/runtimes/${RUNTIME_NAME}-DEFAULT"

echo "Tailing logs for runtime: ${RUNTIME_NAME}"
echo "Log group: ${LOG_GROUP}"
echo "---"

# --- Tail the logs ---
aws logs tail "${LOG_GROUP}" --follow --region "${RUNTIME_REGION}"
