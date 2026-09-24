#!/usr/bin/env bash
# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

#
# scripts/ingest-kb-assets.sh — Upload local KB documents to S3 and trigger ingestion.
#
# For each knowledge base defined in config.yaml:
#   1. Uploads files from knowledge-bases/{name}/ to the KB's S3 bucket (kb-source-docs/ prefix)
#   2. Starts a Bedrock ingestion job to sync the data source
#
# Usage:
#   ./scripts/ingest-kb-assets.sh          # Ingest all knowledge bases
#   ./scripts/ingest-kb-assets.sh it-docs  # Ingest a specific knowledge base
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CONFIG_FILE="$REPO_ROOT/config.yaml"
OUTPUTS_FILE="$REPO_ROOT/.rapid/outputs.json"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

info()  { printf "${BOLD}ℹ${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
err()   { printf "${RED}✗${NC} %s\n" "$1"; exit 1; }

# --- Validate prerequisites ---
if [[ ! -f "$OUTPUTS_FILE" ]]; then
  err "Outputs not found at $OUTPUTS_FILE — run 'make deploy' first."
fi

if ! command -v jq &>/dev/null; then
  err "jq is required. Install jq and try again."
fi

if ! command -v aws &>/dev/null; then
  err "AWS CLI is required."
fi

# --- Read region from config ---
read_config_value() {
  local key="$1"
  if command -v yq >/dev/null 2>&1; then
    yq -r ".$key // \"\"" "$CONFIG_FILE" 2>/dev/null
  else
    grep "^${key}:" "$CONFIG_FILE" 2>/dev/null \
      | sed 's/^[^:]*:[[:space:]]*//' \
      | sed 's/[[:space:]]*#.*//' \
      | sed 's/^[[:space:]]*//' \
      | sed 's/[[:space:]]*$//'
  fi
}

REGION="$(read_config_value region)"
if [[ -z "$REGION" ]]; then
  err "Could not read 'region' from config.yaml"
fi

# --- Read KB names from config ---
read_kb_names() {
  if command -v yq >/dev/null 2>&1; then
    yq -r '.knowledgeBases[]?.name // empty' "$CONFIG_FILE" 2>/dev/null
  else
    awk '
      $0 ~ /^knowledgeBases:/ { in_list=1; next }
      in_list && /^[a-zA-Z]/ { exit }
      in_list && /- name:/ { gsub(/.*- name:[[:space:]]*/, ""); gsub(/[[:space:]]*$/, ""); print }
    ' "$CONFIG_FILE"
  fi
}

# --- Read sourceDir for a KB (defaults to knowledge-bases/{name}) ---
read_kb_source_dir() {
  local kb_name="$1"
  # Try to read sourceDir from config; default to knowledge-bases/{name}
  local source_dir=""
  if command -v yq >/dev/null 2>&1; then
    source_dir=$(yq -r ".knowledgeBases[] | select(.name == \"$kb_name\") | .sourceDir // \"\"" "$CONFIG_FILE" 2>/dev/null)
  fi
  if [[ -z "$source_dir" ]]; then
    source_dir="knowledge-bases/$kb_name"
  fi
  echo "$source_dir"
}

# --- Ingest a single knowledge base ---
ingest_kb() {
  local kb_name="$1"

  echo ""
  info "Processing knowledge base: ${BOLD}$kb_name${NC}"

  # Get bucket name and KB ID from outputs
  local bucket_name
  bucket_name=$(jq -r ".knowledgeBases.\"$kb_name\".documentsBucketName // empty" "$OUTPUTS_FILE")
  if [[ -z "$bucket_name" ]]; then
    warn "No bucket found for KB '$kb_name' in outputs — skipping (has it been deployed?)"
    return 1
  fi

  local kb_id
  kb_id=$(jq -r ".knowledgeBases.\"$kb_name\".knowledgeBaseId // empty" "$OUTPUTS_FILE")
  if [[ -z "$kb_id" ]]; then
    warn "No knowledge base ID found for '$kb_name' in outputs — skipping"
    return 1
  fi

  # Resolve local source directory
  local source_dir
  source_dir=$(read_kb_source_dir "$kb_name")
  local local_path="$REPO_ROOT/$source_dir"

  if [[ ! -d "$local_path" ]]; then
    warn "Source directory '$source_dir' does not exist — skipping"
    return 1
  fi

  # Count files (excluding hidden files like .gitkeep)
  local file_count
  file_count=$(find "$local_path" -type f ! -name '.*' | wc -l | tr -d ' ')
  if [[ "$file_count" -eq 0 ]]; then
    warn "No documents found in '$source_dir' — skipping"
    return 1
  fi

  # Step 1: Upload to S3
  info "Uploading $file_count file(s) from $source_dir → s3://$bucket_name/kb-source-docs/"
  aws s3 sync "$local_path" "s3://$bucket_name/kb-source-docs/" \
    --exclude ".*" \
    --region "$REGION" \
    --no-cli-pager
  ok "Upload complete"

  # Step 2: Find the data source ID
  local data_source_id
  data_source_id=$(aws bedrock-agent list-data-sources \
    --knowledge-base-id "$kb_id" \
    --region "$REGION" \
    --no-cli-pager \
    --query 'dataSourceSummaries[0].dataSourceId' \
    --output text 2>/dev/null || echo "")

  if [[ -z "$data_source_id" || "$data_source_id" == "None" ]]; then
    warn "Could not find data source for KB '$kb_name' — upload done but ingestion skipped"
    echo "    You can manually trigger: aws bedrock-agent start-ingestion-job --knowledge-base-id $kb_id --data-source-id <ID> --region $REGION"
    return 0
  fi

  # Step 3: Start ingestion job
  info "Starting ingestion job (KB: $kb_id, DataSource: $data_source_id)..."
  local ingestion_result
  ingestion_result=$(aws bedrock-agent start-ingestion-job \
    --knowledge-base-id "$kb_id" \
    --data-source-id "$data_source_id" \
    --region "$REGION" \
    --no-cli-pager \
    --output json 2>&1) || true

  local job_id
  job_id=$(echo "$ingestion_result" | jq -r '.ingestionJob.ingestionJobId // empty' 2>/dev/null || echo "")

  if [[ -n "$job_id" ]]; then
    ok "Ingestion job started: $job_id"
    printf "${GRAY}   Monitor: aws bedrock-agent get-ingestion-job --knowledge-base-id %s --data-source-id %s --ingestion-job-id %s --region %s${NC}\n" \
      "$kb_id" "$data_source_id" "$job_id" "$REGION"
  else
    warn "Ingestion job may have failed to start. Response:"
    echo "    $ingestion_result"
  fi
}

# --- Main ---
TARGET_KB="${1:-}"
ALL_KB_NAMES=($(read_kb_names))

if [[ ${#ALL_KB_NAMES[@]} -eq 0 ]]; then
  err "No knowledge bases defined in config.yaml"
fi

echo ""
printf "${BOLD}═══ Knowledge Base Ingestion ═══${NC}\n"

if [[ -n "$TARGET_KB" ]]; then
  # Ingest a specific KB
  found=false
  for name in "${ALL_KB_NAMES[@]}"; do
    if [[ "$name" == "$TARGET_KB" ]]; then
      found=true
      break
    fi
  done
  if [[ "$found" == "false" ]]; then
    err "Knowledge base '$TARGET_KB' not found in config.yaml. Available: ${ALL_KB_NAMES[*]}"
  fi
  ingest_kb "$TARGET_KB"
else
  # Ingest all KBs
  info "Ingesting ${#ALL_KB_NAMES[@]} knowledge base(s): ${ALL_KB_NAMES[*]}"
  for name in "${ALL_KB_NAMES[@]}"; do
    ingest_kb "$name" || true
  done
fi

echo ""
ok "Done!"
echo ""
