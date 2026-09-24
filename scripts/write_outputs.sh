#!/usr/bin/env bash
# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

#
# write_outputs.sh — Normalize CDK deploy outputs to .rapid/outputs.json
#
# Reads the CDK --outputs-file JSON + config.yaml, and produces a structured
# outputs file keyed by the actual agent/mcp/kb names from config.
#
# Output schema:
# {
#   "frontendUrl": "...",
#   "agents": { "<name>": { "runtimeArn": "...", "runtimeId": "..." } },
#   "mcpServers": { "<name>": { "runtimeArn": "...", "runtimeId": "..." } },
#   "knowledgeBases": { "<name>": { "knowledgeBaseId": "...", "documentsBucketName": "..." } }
# }
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

CDK_OUTPUTS_FILE="/tmp/cdk-outputs.json"
CONFIG_FILE="${REPO_ROOT}/config.yaml"
OUTPUT_DIR="${REPO_ROOT}/.rapid"
OUTPUT_FILE="${OUTPUT_DIR}/outputs.json"

# --- Validate prerequisites ---
if [[ ! -f "${CDK_OUTPUTS_FILE}" ]]; then
  echo "ERROR: CDK outputs file not found at ${CDK_OUTPUTS_FILE}" >&2
  echo "       Ensure 'cdk deploy' was run with --outputs-file ${CDK_OUTPUTS_FILE}" >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required. Install jq and try again." >&2
  exit 1
fi

# --- Find the stack outputs ---
STACK_KEY=$(jq -r 'keys[] | select(startswith("AgentCore"))' "${CDK_OUTPUTS_FILE}" | head -1)
if [[ -z "${STACK_KEY}" ]]; then
  echo "ERROR: No AgentCore stack found in CDK outputs" >&2
  exit 1
fi

# --- Helper: kebab-case to PascalCase ---
to_pascal() {
  echo "$1" | awk -F'-' '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1' OFS=''
}

# --- Read config to get actual names ---
read_names() {
  local key="$1"
  if command -v yq >/dev/null 2>&1; then
    yq -r ".${key}[]?.name // empty" "${CONFIG_FILE}" 2>/dev/null
  else
    # macOS-compatible: extract 'name: value' lines under the given key.
    #
    # The inline comment has to be stripped. config.yaml documents the defaults
    # on the same line as the name:
    #   - name: customer-support   # sourceDir defaults to agent/{name}/src
    # Without the strip, that whole tail became part of the value, and because
    # the caller word-splits the result, every word turned into its own entry —
    # producing bogus "#", "sourceDir", "defaults", "to", "agent/{name}/src"
    # keys in outputs.json alongside the real agent.
    awk -v key="$key" '
      $0 ~ "^"key":" { in_list=1; next }
      in_list && /^[a-zA-Z]/ { exit }
      in_list && /-[[:space:]]*name:/ {
        sub(/.*-[[:space:]]*name:[[:space:]]*/, "")
        sub(/[[:space:]]*#.*$/, "")
        gsub(/^[[:space:]]*|[[:space:]]*$/, "")
        gsub(/^["'"'"']|["'"'"']$/, "")
        if (length($0)) print
      }
    ' "${CONFIG_FILE}"
  fi
}

# read_names emits one name per line; read them as lines so a stray space in the
# output can never split one entry into several.
AGENT_NAMES=()
MCP_NAMES=()
KB_NAMES=()
while IFS= read -r line; do [[ -n "$line" ]] && AGENT_NAMES+=("$line"); done < <(read_names "agents")
while IFS= read -r line; do [[ -n "$line" ]] && MCP_NAMES+=("$line"); done < <(read_names "mcpServers")
while IFS= read -r line; do [[ -n "$line" ]] && KB_NAMES+=("$line"); done < <(read_names "knowledgeBases")

# --- Extract from CDK outputs ---
get_output() {
  local key="$1"
  jq -r ".\"${STACK_KEY}\".\"${key}\" // \"\"" "${CDK_OUTPUTS_FILE}"
}

# --- Build agents map ---
AGENTS_JSON="{}"
for name in "${AGENT_NAMES[@]:-}"; do
  [[ -z "$name" ]] && continue
  pascal=$(to_pascal "$name")
  # Try multi-agent key first, then legacy single-agent key
  arn=$(get_output "${pascal}RuntimeArn")
  [[ -z "$arn" ]] && arn=$(get_output "AgentRuntimeArn")
  rid=$(get_output "${pascal}RuntimeId")
  [[ -z "$rid" ]] && rid=$(get_output "AgentRuntimeId")
  AGENTS_JSON=$(echo "$AGENTS_JSON" | jq --arg n "$name" --arg a "$arn" --arg r "$rid" '. + {($n): {runtimeArn: $a, runtimeId: $r}}')
done

# --- Build mcpServers map ---
MCP_JSON="{}"
for name in "${MCP_NAMES[@]:-}"; do
  [[ -z "$name" ]] && continue
  pascal=$(to_pascal "$name")
  arn=$(get_output "${pascal}McpRuntimeArn")
  [[ -z "$arn" ]] && arn=$(get_output "McpServerRuntimeArn")
  rid=$(get_output "${pascal}McpRuntimeId")
  [[ -z "$rid" ]] && rid=$(get_output "McpServerRuntimeId")
  MCP_JSON=$(echo "$MCP_JSON" | jq --arg n "$name" --arg a "$arn" --arg r "$rid" '. + {($n): {runtimeArn: $a, runtimeId: $r}}')
done

# --- Build knowledgeBases map ---
KB_JSON="{}"
for name in "${KB_NAMES[@]:-}"; do
  [[ -z "$name" ]] && continue
  pascal=$(to_pascal "$name")
  kbid=$(get_output "${pascal}KnowledgeBaseId")
  bucket=$(get_output "${pascal}DocumentsBucketName")
  KB_JSON=$(echo "$KB_JSON" | jq --arg n "$name" --arg k "$kbid" --arg b "$bucket" '. + {($n): {knowledgeBaseId: $k, documentsBucketName: $b}}')
done

# --- Frontend URL ---
FRONTEND_URL=$(get_output "FrontendUrl")

# --- Assemble final JSON ---
NORMALIZED_JSON=$(jq -n \
  --arg frontendUrl "$FRONTEND_URL" \
  --argjson agents "$AGENTS_JSON" \
  --argjson mcpServers "$MCP_JSON" \
  --argjson knowledgeBases "$KB_JSON" \
  '{
    frontendUrl: $frontendUrl,
    agents: $agents,
    mcpServers: $mcpServers,
    knowledgeBases: $knowledgeBases
  }')

# --- Write atomically ---
mkdir -p "${OUTPUT_DIR}"
TEMP_FILE=$(mktemp "${OUTPUT_DIR}/outputs.XXXXXX.json")
echo "${NORMALIZED_JSON}" > "${TEMP_FILE}"
mv "${TEMP_FILE}" "${OUTPUT_FILE}"

echo "Deploy outputs written to ${OUTPUT_FILE}"
