# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

# Customer Support MCP Server for AgentCore Runtime

# --- Builder stage: install uv and all dependencies ---
FROM public.ecr.aws/docker/library/python:3.12-slim-bookworm AS builder

WORKDIR /app

ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1

# Install uv (pinned for reproducibility)
COPY --from=ghcr.io/astral-sh/uv:0.11.23 /uv /usr/local/bin/uv

# Install dependencies first (cached unless pyproject.toml changes)
COPY pyproject.toml .
RUN uv pip install --no-cache -r pyproject.toml

# Copy application source (changes here don't bust dep cache)
COPY main.py .
COPY __init__.py .

# --- Runtime stage: clean image without pip/uv build tooling ---
FROM public.ecr.aws/docker/library/python:3.12-slim-bookworm

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    DOCKER_CONTAINER=1

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application source
COPY main.py .
COPY __init__.py .

# Create non-root user for security
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8000

# Run the MCP server
CMD ["python", "-m", "main"]
