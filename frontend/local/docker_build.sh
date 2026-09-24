#!/bin/bash
# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

# Build the Streamlit frontend Docker image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/../src"

echo "Building Streamlit frontend Docker image..."
docker build -t streamlit-frontend "$SRC_DIR"

echo "✓ Build complete: streamlit-frontend"
