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
#   2. Waits for the data source to be AVAILABLE
#   3. Starts a Bedrock ingestion job and waits for it to finish
#
# A failure in one knowledge base is recorded and the remaining ones are still
# processed. The script exits 1 at the end if any knowledge base failed.
# Files removed locally are not removed from the bucket (no --delete).
#
# Options:
#   --no-wait   Start ingestion jobs without polling their completion (also: NO_WAIT=1)
#
# Usage:
#   ./scripts/ingest-kb-assets.sh                 # Ingest all knowledge bases
#   ./scripts/ingest-kb-assets.sh it-docs         # Ingest a specific knowledge base
#   ./scripts/ingest-kb-assets.sh --no-wait       # Start jobs, don't wait for completion
#   ./scripts/ingest-kb-assets.sh it-docs --no-wait  # Target one KB, no wait
#   NO_WAIT=1 ./scripts/ingest-kb-assets.sh       # Environment variable form
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

# Polling (override the interval with KB_POLL_INTERVAL for offline testing)
POLL_INTERVAL="${KB_POLL_INTERVAL:-10}"
DATA_SOURCE_WAIT_MAX=300
INGESTION_JOB_WAIT_MAX=600

# Parse command-line options and environment
NO_WAIT_MODE=false
if [[ -n "${NO_WAIT:-}" && "$NO_WAIT" != "0" && "$NO_WAIT" != "false" ]]; then
  NO_WAIT_MODE=true
fi

# Per-knowledge-base failures: records "<kb>: <step>" and never exits.
FAILED_KBS=()
fail_kb() {
  local kb="$1" step="$2" detail="${3:-}"
  printf "${RED}✗${NC} KB '%s' failed at step '%s'%s\n" "$kb" "$step" "${detail:+ ($detail)}"
  FAILED_KBS+=("$kb: $step")
}

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
      in_list && /^[[:space:]]*#/ { next }
      in_list && /- name:/ {
        # Strip leading text up to and including "name:"
        gsub(/.*- name:[[:space:]]*/, "")
        # Strip trailing comment (# and everything after)
        gsub(/[[:space:]]*#.*$/, "")
        # Strip leading/trailing whitespace
        gsub(/^[[:space:]]*/, "")
        gsub(/[[:space:]]*$/, "")
        # Strip optional surrounding quotes
        gsub(/^["'\'']/, "")
        gsub(/["'\'']$/, "")
        # Print only if non-empty
        if (length($0) > 0) print $0
      }
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

# --- Helpers for AWS calls ---
list_data_sources_json() {
  aws bedrock-agent list-data-sources \
    --knowledge-base-id "$1" \
    --region "$REGION" \
    --no-cli-pager \
    --output json 2>&1
}

# Prints the ID of a running (STARTING or IN_PROGRESS) ingestion job, or nothing.
find_running_job_id() {
  local kb_id="$1" ds_id="$2" status out job_id
  for status in IN_PROGRESS STARTING; do
    if out=$(aws bedrock-agent list-ingestion-jobs \
      --knowledge-base-id "$kb_id" \
      --data-source-id "$ds_id" \
      --filters "attribute=STATUS,operator=EQ,values=$status" \
      --region "$REGION" \
      --no-cli-pager \
      --output json 2>&1); then
      job_id=$(printf '%s' "$out" | jq -r '.ingestionJobSummaries[0].ingestionJobId // empty' 2>/dev/null || true)
      if [[ -n "$job_id" ]]; then
        echo "$job_id"
        return 0
      fi
    fi
  done
  return 0
}

# --- Ingest a single knowledge base (always returns 0; failures go to FAILED_KBS) ---
ingest_kb() {
  local kb_name="$1"
  local out

  echo ""
  info "Processing knowledge base: $kb_name"

  # Get bucket name and KB ID from outputs
  local bucket_name kb_id
  bucket_name=$(jq -r ".knowledgeBases.\"$kb_name\".documentsBucketName // empty" "$OUTPUTS_FILE" 2>/dev/null || true)
  kb_id=$(jq -r ".knowledgeBases.\"$kb_name\".knowledgeBaseId // empty" "$OUTPUTS_FILE" 2>/dev/null || true)
  if [[ -z "$bucket_name" || -z "$kb_id" ]]; then
    fail_kb "$kb_name" "outputs" "bucket or knowledge base ID missing in outputs — has it been deployed?"
    return 0
  fi

  # Resolve local source directory
  local source_dir local_path
  source_dir=$(read_kb_source_dir "$kb_name")
  local_path="$REPO_ROOT/$source_dir"
  if [[ ! -d "$local_path" ]]; then
    fail_kb "$kb_name" "source-dir" "'$source_dir' does not exist"
    return 0
  fi

  # Count regular files (excluding hidden files like .gitkeep)
  local file_count
  file_count=$(find "$local_path" -type f ! -name '.*' | wc -l | tr -d ' ')
  if [[ "$file_count" -eq 0 ]]; then
    warn "KB '$kb_name': no documents found in '$source_dir' — skipping (no ingestion job started)"
    return 0
  fi

  # Step 1: Upload to S3
  info "Uploading $file_count file(s) from $source_dir → s3://$bucket_name/kb-source-docs/"
  if ! out=$(aws s3 sync "$local_path" "s3://$bucket_name/kb-source-docs/" \
    --exclude ".*" \
    --region "$REGION" \
    --no-cli-pager 2>&1); then
    echo "$out"
    fail_kb "$kb_name" "sync"
    return 0
  fi
  ok "Upload complete"

  # Step 2: Find the data source and wait until it is AVAILABLE
  local data_source_id ds_status
  if ! out=$(list_data_sources_json "$kb_id"); then
    echo "$out"
    fail_kb "$kb_name" "list-data-sources"
    return 0
  fi
  data_source_id=$(printf '%s' "$out" | jq -r '.dataSourceSummaries[0].dataSourceId // empty' 2>/dev/null || true)
  ds_status=$(printf '%s' "$out" | jq -r '.dataSourceSummaries[0].status // empty' 2>/dev/null || true)
  if [[ -z "$data_source_id" ]]; then
    fail_kb "$kb_name" "list-data-sources" "no data source found for knowledge base $kb_id"
    return 0
  fi

  local waited=0
  while [[ "$ds_status" != "AVAILABLE" ]]; do
    if [[ "$waited" -ge "$DATA_SOURCE_WAIT_MAX" ]]; then
      fail_kb "$kb_name" "data-source-wait" "last status: ${ds_status:-unknown}"
      return 0
    fi
    info "Data source $data_source_id is ${ds_status:-unknown}; waiting ${POLL_INTERVAL}s..."
    sleep "$POLL_INTERVAL"
    waited=$((waited + POLL_INTERVAL))
    if ! out=$(list_data_sources_json "$kb_id"); then
      echo "$out"
      fail_kb "$kb_name" "list-data-sources"
      return 0
    fi
    ds_status=$(printf '%s' "$out" | jq -r --arg id "$data_source_id" \
      '.dataSourceSummaries[] | select(.dataSourceId == $id) | .status' 2>/dev/null || true)
  done

  # Step 3: Start ingestion job
  info "Starting ingestion job (KB: $kb_id, DataSource: $data_source_id)..."
  if ! out=$(aws bedrock-agent start-ingestion-job \
    --knowledge-base-id "$kb_id" \
    --data-source-id "$data_source_id" \
    --region "$REGION" \
    --no-cli-pager \
    --output json 2>&1); then
    if [[ "$out" == *ConflictException* ]]; then
      local running_job_id
      running_job_id=$(find_running_job_id "$kb_id" "$data_source_id")
      if [[ -z "$running_job_id" ]]; then
        echo "$out"
        fail_kb "$kb_name" "start-ingestion" "conflict reported but no running job found"
        return 0
      fi
      warn "KB '$kb_name': ingestion job $running_job_id is already running; this run did not start a new job"
      return 0
    fi
    echo "$out"
    fail_kb "$kb_name" "start-ingestion"
    return 0
  fi

  local job_id
  job_id=$(printf '%s' "$out" | jq -r '.ingestionJob.ingestionJobId // empty' 2>/dev/null || true)
  if [[ -z "$job_id" ]]; then
    echo "$out"
    fail_kb "$kb_name" "start-ingestion" "no job ID in response"
    return 0
  fi

  # In no-wait mode, print the job ID and the command to check its status
  if [[ "$NO_WAIT_MODE" == "true" ]]; then
    ok "KB '$kb_name': ingestion job $job_id started (not waiting)"
    printf "${GRAY}   Check status: aws bedrock-agent get-ingestion-job --knowledge-base-id %s --data-source-id %s --ingestion-job-id %s --region %s --query 'ingestionJob.[status,statistics]'${NC}\n" \
      "$kb_id" "$data_source_id" "$job_id" "$REGION"
    printf "${GRAY}   Or view in console: Amazon Bedrock → Knowledge bases → %s → data source → sync history${NC}\n" "$kb_name"
    return 0
  fi

  ok "Ingestion job started: $job_id"

  # Step 4: Wait for the job to finish
  local job_status="" job_json="" waited_job=0
  while true; do
    if ! out=$(aws bedrock-agent get-ingestion-job \
      --knowledge-base-id "$kb_id" \
      --data-source-id "$data_source_id" \
      --ingestion-job-id "$job_id" \
      --region "$REGION" \
      --no-cli-pager \
      --output json 2>&1); then
      echo "$out"
      fail_kb "$kb_name" "ingestion-job" "job $job_id, could not read status"
      return 0
    fi
    job_json="$out"
    job_status=$(printf '%s' "$job_json" | jq -r '.ingestionJob.status // empty' 2>/dev/null || true)
    if [[ "$job_status" == "COMPLETE" || "$job_status" == "FAILED" ]]; then
      break
    fi
    if [[ "$waited_job" -ge "$INGESTION_JOB_WAIT_MAX" ]]; then
      fail_kb "$kb_name" "ingestion-job" "job $job_id, last status: ${job_status:-unknown}"
      return 0
    fi
    info "Ingestion job $job_id is ${job_status:-unknown}; waiting ${POLL_INTERVAL}s..."
    sleep "$POLL_INTERVAL"
    waited_job=$((waited_job + POLL_INTERVAL))
  done

  local stats
  stats=$(printf '%s' "$job_json" | jq -c '.ingestionJob.statistics // {}' 2>/dev/null || echo "{}")
  if [[ "$job_status" == "COMPLETE" ]]; then
    ok "KB '$kb_name': ingestion $job_status"
    printf "${GRAY}   Statistics: %s${NC}\n" "$stats"
  else
    printf "${GRAY}   Statistics: %s${NC}\n" "$stats"
    printf '%s' "$job_json" | jq -r '.ingestionJob.failureReasons[]? | "   Reason: " + .' 2>/dev/null || true
    fail_kb "$kb_name" "ingestion-job" "job $job_id, status $job_status"
  fi
  return 0
}

# --- Main ---
TARGET_KB=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-wait)
      NO_WAIT_MODE=true
      shift
      ;;
    --*)
      err "Unknown option: $1. Usage: $0 [--no-wait] [KB_NAME]"
      ;;
    *)
      if [[ -z "$TARGET_KB" ]]; then
        TARGET_KB="$1"
      else
        err "Too many arguments. Usage: $0 [--no-wait] [KB_NAME]"
      fi
      shift
      ;;
  esac
done

ALL_KB_NAMES=($(read_kb_names))

if [[ ${#ALL_KB_NAMES[@]} -eq 0 ]]; then
  echo ""
  info "No knowledge bases defined in config.yaml — nothing to ingest."
  exit 0
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
    ingest_kb "$name"
  done
fi

echo ""
if [[ ${#FAILED_KBS[@]} -gt 0 ]]; then
  printf "${RED}✗${NC} Failed knowledge bases (%d):\n" "${#FAILED_KBS[@]}"
  for entry in "${FAILED_KBS[@]}"; do
    printf "   - %s\n" "$entry"
  done
  echo ""
  exit 1
fi

ok "Done!"
echo ""
