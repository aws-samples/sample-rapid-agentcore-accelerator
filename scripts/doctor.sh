#!/bin/bash
# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

# scripts/doctor.sh — Preflight check for RAPID (Rapid Agentic Prototyping & Infrastructure Deployment).
# Validates local prerequisites before a deploy. Run via `make doctor`.
# Exits 0 if all checks pass, 1 if any fail.

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$REPO_ROOT/config.yaml"

# --- Portable timeout command ---
# macOS ships without GNU timeout; prefer gtimeout (from coreutils) as fallback.
TIMEOUT_CMD=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout"
fi

run_with_timeout() {
  local seconds="$1"
  shift
  if [ -n "$TIMEOUT_CMD" ]; then
    "$TIMEOUT_CMD" "$seconds" "$@"
  else
    # Last resort: run without timeout (no coreutils available)
    "$@"
  fi
}

# --- Read config values ---
# Use yq if available, else fallback to grep/sed for simple scalar extraction.
read_config_value() {
  local key="$1"
  if command -v yq >/dev/null 2>&1; then
    yq -r ".$key // \"\"" "$CONFIG_FILE" 2>/dev/null
  else
    grep "^${key}:" "$CONFIG_FILE" 2>/dev/null | sed 's/^[^:]*:[[:space:]]*//' | sed 's/[[:space:]]*#.*//' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//'
  fi
}

REGION="$(read_config_value region)"
MODEL_ID="$(read_config_value modelId)"

# modelId is optional in config.yaml — default to the same value as the CDK config loader
if [ -z "$MODEL_ID" ]; then
  MODEL_ID="global.anthropic.claude-haiku-4-5-20251001-v1:0"
fi

# --- State ---
FAILURES=0

pass() {
  printf "  ✓ %s\n" "$1"
}

fail() {
  printf "  ✗ %s\n" "$1"
  printf "    → %s\n" "$2"
  FAILURES=$((FAILURES + 1))
}

echo ""
echo "Running preflight checks..."
echo ""

# --- 1. AWS credentials (10s timeout) ---
run_with_timeout 10 aws sts get-caller-identity >/dev/null 2>&1
AWS_EXIT=$?
if [ "$AWS_EXIT" -eq 0 ]; then
  pass "AWS credentials"
elif [ "$AWS_EXIT" -eq 124 ]; then
  fail "AWS credentials (timed out)" "Run \`aws configure\` or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars"
else
  fail "AWS credentials" "Run \`aws configure\` or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars"
fi

# --- 2. Bedrock model access (10s timeout) ---
if [ -z "$REGION" ] || [ -z "$MODEL_ID" ]; then
  fail "Bedrock model access" "Cannot check — region or modelId missing from config.yaml"
else
  # Strip cross-region routing prefix (e.g. "global." or "eu.") to get the base model id
  BASE_MODEL_ID="$(echo "$MODEL_ID" | sed 's/^[a-z]*\.//')"
  run_with_timeout 10 aws bedrock get-foundation-model \
      --model-identifier "$BASE_MODEL_ID" \
      --region "$REGION" >/dev/null 2>&1
  BEDROCK_EXIT=$?
  if [ "$BEDROCK_EXIT" -eq 0 ]; then
    pass "Bedrock model access ($MODEL_ID in $REGION)"
  elif [ "$BEDROCK_EXIT" -eq 124 ]; then
    fail "Bedrock model access (timed out)" "Enable model access in the Bedrock console for $REGION"
  else
    fail "Bedrock model access ($MODEL_ID)" "Enable model access in the Bedrock console for $REGION"
  fi
fi

# --- 3. Docker running (10s timeout) ---
run_with_timeout 10 docker info >/dev/null 2>&1
DOCKER_EXIT=$?
if [ "$DOCKER_EXIT" -eq 0 ]; then
  pass "Docker running"
elif [ "$DOCKER_EXIT" -eq 124 ]; then
  fail "Docker (timed out)" "Start Docker Desktop or dockerd"
else
  fail "Docker running" "Start Docker Desktop or dockerd"
fi

# --- 3b. ARM64 image build capability ---
# AgentCore Runtime only accepts ARM64 images, and `make deploy` builds them
# locally via the CDK asset pipeline. On a non-ARM host this is a cross-arch
# build that needs QEMU emulation (bundled with Docker Desktop; a one-time
# install on bare Docker Engine). Catch this before the first deploy fails.
if [ "$DOCKER_EXIT" -ne 0 ]; then
  : # Docker isn't running — the check above already reported it.
else
  HOST_ARCH="$(uname -m)"
  if [ "$HOST_ARCH" = "arm64" ] || [ "$HOST_ARCH" = "aarch64" ]; then
    pass "ARM64 build capability (native $HOST_ARCH host)"
  elif ! docker buildx version >/dev/null 2>&1; then
    fail "ARM64 build capability ($HOST_ARCH host, docker buildx not installed)" \
      "AgentCore needs ARM64 images; the legacy builder can't cross-build. Install buildx — Ubuntu/Debian: sudo apt install docker-buildx (Docker apt repo: docker-buildx-plugin) | Amazon Linux/RHEL: sudo dnf install docker-buildx-plugin | manual: https://github.com/docker/buildx#manual-download — then run \`docker buildx install\`"
  elif run_with_timeout 30 docker buildx inspect --bootstrap 2>/dev/null | grep -qi "linux/arm64"; then
    pass "ARM64 build capability (emulation available on $HOST_ARCH host)"
  else
    fail "ARM64 build capability ($HOST_ARCH host, arm64 emulation not detected)" \
      "buildx is installed but can't target arm64. Register QEMU emulators once: docker run --privileged --rm tonistiigi/binfmt:qemu-v9.2.2-53 --install arm64"
  fi
fi

# --- 4. jq installed ---
# jq is a hard requirement, not an optional convenience like yq (which
# read_config_value above falls back from). write_outputs.sh, chat.sh, logs.sh,
# ingest-kb-assets.sh, enable_cicd.sh and frontend/local/run_local.sh all parse
# JSON with jq and none has a fallback. write_outputs.sh runs as the second half
# of `make deploy`, so a missing jq surfaces only after the stack has been
# created — resources billing, .rapid/outputs.json never written, and every
# downstream command (`make chat`, `make ui`, the evals) broken.
if command -v jq >/dev/null 2>&1; then
  pass "jq installed"
else
  fail "jq not found" "Install jq — macOS: brew install jq | Ubuntu/Debian: sudo apt install jq | Amazon Linux/RHEL: sudo dnf install jq"
fi

# --- 5. uv installed ---
if command -v uv >/dev/null 2>&1; then
  pass "uv installed"
else
  fail "uv installed" "Install uv: https://docs.astral.sh/uv/"
fi

# --- 6. Node >= 18 ---
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version 2>/dev/null | sed 's/^v//')"
  NODE_MAJOR="$(echo "$NODE_VERSION" | cut -d. -f1)"
  if [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null; then
    pass "Node.js v$NODE_VERSION (>= 18)"
  else
    fail "Node.js v$NODE_VERSION" "Install Node 18+"
  fi
else
  fail "Node.js not found" "Install Node 18+"
fi

# --- 7. Python: the version each subproject pins is available to uv ---
#
# The requirement is not "some Python at or above 3.12". Every Python subproject
# pins an exact interpreter in its own .python-version, and the Dockerfiles build
# on the matching python:<ver>-slim-bookworm base, so the only version that
# matters is the pinned one.
#
# An earlier version of this check ran `uv run python --version` from the
# repository root. The root has no .python-version, so uv resolved an arbitrary
# interpreter and the result was compared against a >= 3.12 floor — which passed
# on a machine offering only a 3.14 alpha, while every subproject still needed
# 3.12. The floor comparison is gone: the pins are the source of truth, and this
# check reads them rather than restating a version of its own.
PYTHON_PINS="$(find "$REPO_ROOT" -name '.python-version' \
  -not -path '*/.venv/*' \
  -not -path '*/node_modules/*' \
  -not -path '*/cdk.out/*' \
  -not -path '*/.git/*' 2>/dev/null | sort)"

if [ -z "$PYTHON_PINS" ]; then
  fail "Python version pins" "No .python-version file found — each Python subproject should pin its interpreter"
elif ! command -v uv >/dev/null 2>&1; then
  # Deliberately not falling back to the system python3: subprojects are built by
  # uv against their pin, so a system interpreter's version says nothing useful.
  fail "Python (cannot verify without uv)" "Install uv: https://docs.astral.sh/uv/"
else
  PINNED_VERSIONS="$(while IFS= read -r pin_file; do
    [ -n "$pin_file" ] && tr -d '[:space:]' < "$pin_file" && echo
  done <<< "$PYTHON_PINS" | grep -v '^$' | sort -u)"

  PIN_COUNT="$(echo "$PINNED_VERSIONS" | wc -l | tr -d ' ')"
  if [ "$PIN_COUNT" -gt 1 ]; then
    # Subprojects disagreeing is a repository defect, not a local-environment
    # problem, so name the versions rather than suggesting an install.
    fail "Python pins disagree across subprojects ($(echo "$PINNED_VERSIONS" | tr '\n' ' '))" \
      "Every .python-version should hold the same version; reconcile them"
  else
    MISSING_PYTHON=""
    while IFS= read -r version; do
      [ -z "$version" ] && continue
      if ! uv python find "$version" >/dev/null 2>&1; then
        MISSING_PYTHON="$version"
      fi
    done <<< "$PINNED_VERSIONS"

    if [ -z "$MISSING_PYTHON" ]; then
      pass "Python $PINNED_VERSIONS available to uv (pinned by every subproject)"
    else
      fail "Python $MISSING_PYTHON not available to uv" "Run \`uv python install $MISSING_PYTHON\`"
    fi
  fi
fi

# --- 8. CDK bootstrap state (10s timeout) ---
run_with_timeout 10 aws cloudformation describe-stacks \
    --stack-name CDKToolkit --region "$REGION" >/dev/null 2>&1
CDK_BOOTSTRAP_EXIT=$?
if [ "$CDK_BOOTSTRAP_EXIT" -eq 0 ]; then
  pass "CDK bootstrapped in $REGION"
elif [ "$CDK_BOOTSTRAP_EXIT" -eq 124 ]; then
  fail "CDK bootstrap state (timed out)" "Run once per account/region: cd infra && npx cdk bootstrap"
else
  fail "CDK not bootstrapped in $REGION" "Run once per account/region: cd infra && npx cdk bootstrap"
fi

# --- Summary ---
echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All checks passed. Environment ready to deploy."
  exit 0
else
  echo "$FAILURES check(s) failed. Fix the issues above and re-run \`make doctor\`."
  exit 1
fi
