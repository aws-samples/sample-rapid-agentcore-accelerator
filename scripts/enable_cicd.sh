#!/usr/bin/env bash
# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

#
# enable_cicd.sh — Opt-in CI/CD graduation step
#
# Orchestrates: seed ECR → flip config → deploy (creates CodeCommit + pipelines)
#               → configure git remote → first push → report success
#
# Transactional: snapshots config before changes; restores on any failure.
#
set -uo pipefail

# --- Paths ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${REPO_ROOT}/config.yaml"
CDK_OUTPUTS_FILE="/tmp/cdk-outputs.json"

# Git remote name for CodeCommit
GIT_REMOTE_NAME="codecommit"

# --- Helpers ---
CONFIG_SNAPSHOT=""

snapshot_config() {
  if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "ERROR: Config file not found at ${CONFIG_FILE}" >&2
    exit 1
  fi
  CONFIG_SNAPSHOT="$(cat "${CONFIG_FILE}")"
}

restore_config() {
  if [[ -z "${CONFIG_SNAPSHOT}" ]]; then
    echo "ERROR: No config snapshot to restore (was never taken)." >&2
    return 1
  fi
  if ! echo "${CONFIG_SNAPSHOT}" > "${CONFIG_FILE}" 2>/dev/null; then
    echo "ERROR: Failed to restore config.yaml — config-write failure." >&2
    echo "       The config file may be in an inconsistent state." >&2
    return 1
  fi
  echo "Config restored to prior state (deploymentMode: local)."
}

fail_step() {
  local step_num="$1"
  local step_desc="$2"
  local detail="${3:-}"
  echo "" >&2
  echo "ERROR: Step ${step_num} failed: ${step_desc}" >&2
  if [[ -n "${detail}" ]]; then
    echo "       ${detail}" >&2
  fi
  echo "" >&2
  echo "Restoring config to prior state..." >&2
  if ! restore_config; then
    echo "CRITICAL: Could not restore config.yaml. File left as-is." >&2
    exit 1
  fi
  exit 1
}

get_aws_account_id() {
  aws sts get-caller-identity --query Account --output text 2>/dev/null
}

get_aws_region() {
  grep -E '^region:' "${CONFIG_FILE}" | sed 's/^region:[[:space:]]*//' | sed 's/[[:space:]]*#.*//' | tr -d '[:space:]'
}

# --- Main ---
echo "============================================"
echo " enable-cicd: Setting up CI/CD pipelines"
echo "============================================"
echo ""

REGION="$(get_aws_region)"
if [[ -z "${REGION}" ]]; then
  echo "ERROR: Could not read region from config.yaml" >&2
  exit 1
fi

ACCOUNT_ID="$(get_aws_account_id)"
if [[ -z "${ACCOUNT_ID}" ]]; then
  echo "ERROR: Could not determine AWS account ID. Are AWS credentials configured?" >&2
  exit 1
fi

ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# Read deployment prefix from config
DEPLOYMENT_PREFIX=$(grep -E '^deploymentPrefix:' "${CONFIG_FILE}" | sed 's/^deploymentPrefix:[[:space:]]*//' | sed 's/[[:space:]]*#.*//' | tr -d '[:space:]')
STACK_NAME="AgentCore-${DEPLOYMENT_PREFIX}"

# Discover agent and MCP directories from config.yaml
# Parse agent names and source dirs
if command -v yq >/dev/null 2>&1; then
  AGENT_NAMES=($(yq -r '.agents[]?.name // empty' "${CONFIG_FILE}" 2>/dev/null))
  AGENT_DIRS=($(yq -r '.agents[]?.sourceDir // empty' "${CONFIG_FILE}" 2>/dev/null))
  MCP_NAMES=($(yq -r '.mcpServers[]?.name // empty' "${CONFIG_FILE}" 2>/dev/null))
  MCP_DIRS=($(yq -r '.mcpServers[]?.sourceDir // empty' "${CONFIG_FILE}" 2>/dev/null))
else
  # Fallback: assume single agent/MCP from directory structure
  AGENT_NAMES=($(ls -d "${REPO_ROOT}"/agent/*/src 2>/dev/null | xargs -I{} dirname {} | xargs -I{} basename {}))
  AGENT_DIRS=()
  for name in "${AGENT_NAMES[@]}"; do AGENT_DIRS+=("agent/${name}/src"); done
  MCP_NAMES=($(ls -d "${REPO_ROOT}"/mcp/*/src 2>/dev/null | xargs -I{} dirname {} | xargs -I{} basename {}))
  MCP_DIRS=()
  for name in "${MCP_NAMES[@]}"; do MCP_DIRS+=("mcp/${name}/src"); done
fi

# Apply defaults if arrays are empty (no yq and no dirs found)
if [[ ${#AGENT_NAMES[@]} -eq 0 ]]; then
  AGENT_NAMES=("${DEPLOYMENT_PREFIX}")
  AGENT_DIRS=("agent/src")
fi
if [[ ${#MCP_NAMES[@]} -eq 0 ]]; then
  MCP_NAMES=("${DEPLOYMENT_PREFIX}")
  MCP_DIRS=("mcp/src")
fi

echo "  Region:       ${REGION}"
echo "  Account:      ${ACCOUNT_ID}"
echo "  ECR Registry: ${ECR_REGISTRY}"
echo "  Agents:       ${AGENT_NAMES[*]}"
echo "  MCP Servers:  ${MCP_NAMES[*]}"
echo ""

# ============================================================
# Step 0: Seed ECR — build ARM64 images and push as :latest
# ============================================================
echo "──────────────────────────────────────────────"
echo "Step 0: Seed ECR (ARM64 build + push agent & MCP :latest)"
echo "──────────────────────────────────────────────"

echo "  Authenticating Docker to ECR..."
if ! aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}" 2>/dev/null; then
  echo "ERROR: Failed to authenticate Docker to ECR" >&2
  exit 1
fi

# AgentCore Runtime requires ARM64 images. With BuildKit (Docker's default
# builder) plus QEMU emulation — bundled in Docker Desktop — `--platform
# linux/arm64` cross-builds correctly even on a non-ARM host. `make doctor`
# verifies this capability before you get here.

# Build and push agent images
for i in "${!AGENT_NAMES[@]}"; do
  name="${AGENT_NAMES[$i]}"
  dir="${AGENT_DIRS[$i]:-agent/${name}/src}"
  ecr_repo="${DEPLOYMENT_PREFIX}-agent-${name}"
  echo "  Building agent '${name}' image (ARM64) from ${dir}..."
  if ! docker build --platform linux/arm64 -t "${ECR_REGISTRY}/${ecr_repo}:latest" "${REPO_ROOT}/${dir}"; then
    echo "ERROR: Failed to build agent '${name}' Docker image" >&2
    exit 1
  fi
  echo "  Pushing agent '${name}' image to ECR..."
  if ! docker push "${ECR_REGISTRY}/${ecr_repo}:latest"; then
    echo "ERROR: Failed to push agent '${name}' image to ECR" >&2
    exit 1
  fi
done

# Build and push MCP server images
for i in "${!MCP_NAMES[@]}"; do
  name="${MCP_NAMES[$i]}"
  dir="${MCP_DIRS[$i]:-mcp/${name}/src}"
  ecr_repo="${DEPLOYMENT_PREFIX}-mcp-${name}"
  echo "  Building MCP server '${name}' image (ARM64) from ${dir}..."
  if ! docker build --platform linux/arm64 -t "${ECR_REGISTRY}/${ecr_repo}:latest" "${REPO_ROOT}/${dir}"; then
    echo "ERROR: Failed to build MCP server '${name}' Docker image" >&2
    exit 1
  fi
  echo "  Pushing MCP server '${name}' image to ECR..."
  if ! docker push "${ECR_REGISTRY}/${ecr_repo}:latest"; then
    echo "ERROR: Failed to push MCP server '${name}' image to ECR" >&2
    exit 1
  fi
done

echo "  ✓ ECR seeded with agent and MCP server images"
echo ""

# ============================================================
# Step 1: Flip config — set deploymentMode to "pipeline"
# ============================================================
echo "──────────────────────────────────────────────"
echo "Step 1: Flip deploymentMode to 'pipeline' in config.yaml"
echo "──────────────────────────────────────────────"

# Snapshot BEFORE making any config changes
snapshot_config

if ! sed -i.bak 's/^deploymentMode:[[:space:]].*$/deploymentMode: pipeline            # local | pipeline/' "${CONFIG_FILE}"; then
  fail_step 1 "Flip config" "sed failed to update deploymentMode in config.yaml"
fi
rm -f "${CONFIG_FILE}.bak"

# Verify the change took effect
if ! grep -q '^deploymentMode:[[:space:]]*pipeline' "${CONFIG_FILE}"; then
  fail_step 1 "Flip config" "config.yaml does not contain deploymentMode: pipeline after sed"
fi

echo "  ✓ deploymentMode set to 'pipeline'"
echo ""

# ============================================================
# Step 2: Deploy infra — npx cdk deploy
# ============================================================
echo "──────────────────────────────────────────────"
echo "Step 2: Deploy infra (npx cdk deploy ${STACK_NAME})"
echo "──────────────────────────────────────────────"
echo "  This creates the CodeCommit repo and wires up pipelines..."

if ! (cd "${REPO_ROOT}/infra" && npx cdk deploy "${STACK_NAME}" --require-approval never --outputs-file "${CDK_OUTPUTS_FILE}"); then
  fail_step 2 "Deploy infra" "npx cdk deploy ${STACK_NAME} failed"
fi

# Also write the normalized outputs file
if [[ -x "${REPO_ROOT}/scripts/write_outputs.sh" ]]; then
  "${REPO_ROOT}/scripts/write_outputs.sh" || true
fi

echo "  ✓ ${STACK_NAME} deployed (CodeCommit + pipelines created)"
echo ""

# ============================================================
# Step 3: Configure git remote from CDK outputs
# ============================================================
echo "──────────────────────────────────────────────"
echo "Step 3: Configure git remote (${GIT_REMOTE_NAME})"
echo "──────────────────────────────────────────────"

# Read the CodeCommit clone URL from CDK outputs
CLONE_URL=""
if command -v jq &>/dev/null && [[ -f "${CDK_OUTPUTS_FILE}" ]]; then
  STACK_KEY=$(jq -r 'keys[] | select(startswith("AgentCore"))' "${CDK_OUTPUTS_FILE}" | head -1)
  CLONE_URL=$(jq -r ".\"${STACK_KEY}\".MonorepoSourceRepoCloneUrlHttp // \"\"" "${CDK_OUTPUTS_FILE}")
fi

# Fallback: construct the URL from the known repo name
if [[ -z "${CLONE_URL}" ]]; then
  CLONE_URL="https://git-codecommit.${REGION}.amazonaws.com/v1/repos/${DEPLOYMENT_PREFIX}-rapid-monorepo"
  echo "  (Using constructed clone URL — CDK output not available)"
fi

echo "  Clone URL: ${CLONE_URL}"

# Remove existing remote if present (idempotent)
cd "${REPO_ROOT}"
if git remote get-url "${GIT_REMOTE_NAME}" &>/dev/null; then
  echo "  Removing existing '${GIT_REMOTE_NAME}' remote..."
  git remote remove "${GIT_REMOTE_NAME}"
fi

if ! git remote add "${GIT_REMOTE_NAME}" "${CLONE_URL}"; then
  fail_step 3 "Configure git remote" "Failed to add git remote '${GIT_REMOTE_NAME}'"
fi

echo "  ✓ Git remote '${GIT_REMOTE_NAME}' configured"
echo ""

# ============================================================
# Step 4: First push to main
# ============================================================
echo "──────────────────────────────────────────────"
echo "Step 4: First push to main"
echo "──────────────────────────────────────────────"

cd "${REPO_ROOT}"
if ! git push "${GIT_REMOTE_NAME}" main; then
  fail_step 4 "First push to main" "git push ${GIT_REMOTE_NAME} main failed"
fi

echo "  ✓ Pushed to ${GIT_REMOTE_NAME}/main (pipelines activated)"
echo ""

# ============================================================
# Step 5: Report success
# ============================================================
echo "──────────────────────────────────────────────"
echo "Step 5: Success!"
echo "──────────────────────────────────────────────"
echo ""
echo "  CI/CD is now enabled."
echo "  • deploymentMode is set to 'pipeline' in config.yaml"
echo "  • CodeCommit repo: ${DEPLOYMENT_PREFIX}-rapid-monorepo"
echo "  • Git remote '${GIT_REMOTE_NAME}' points to CodeCommit"
echo ""
echo "  Pipelines created:"
for name in "${AGENT_NAMES[@]}"; do
  echo "    • ${DEPLOYMENT_PREFIX}-rapid-agent-${name}-pipeline  (triggers on: agent/${name}/**)"
done
for name in "${MCP_NAMES[@]}"; do
  echo "    • ${DEPLOYMENT_PREFIX}-rapid-mcp-${name}-pipeline   (triggers on: mcp/${name}/**)"
done
echo "    • ${DEPLOYMENT_PREFIX}-rapid-infra-pipeline            (triggers on: infra/**, config.yaml)"
echo ""
echo "  To push changes:  git push ${GIT_REMOTE_NAME} main"
echo ""
echo "  ⚠️  NOTE: Pipelines may initially show 'Failed' status in the AWS Console."
echo "  This is expected — they will turn green once you make a commit to main"
echo "  that touches files in scope for each pipeline's trigger path."
echo ""
