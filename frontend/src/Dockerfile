# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

# Streamlit Frontend for AgentCore

# --- Builder stage: install uv and all dependencies ---
FROM public.ecr.aws/docker/library/python:3.12-slim-bookworm AS builder

WORKDIR /app

ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./

RUN uv sync --frozen --no-install-project

COPY app.py ./
COPY core/ ./core/
COPY chatui/ ./chatui/

# --- Runtime stage: clean image without pip/uv build tooling ---
FROM public.ecr.aws/docker/library/python:3.12-slim-bookworm

WORKDIR /app

ENV PYTHONUNBUFFERED=1

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy application source
COPY app.py ./
COPY core/ ./core/
COPY chatui/ ./chatui/

# Create non-root user for security
RUN useradd -m -u 1000 streamlit
USER streamlit

EXPOSE 8501

# Streamlit server flags are configured via environment variables so they can be
# adjusted per deployment mode. STREAMLIT_SERVER_EXTRA_FLAGS is set by CDK when
# running behind CloudFront (disables XSRF/compression for proxy compatibility).
ENV STREAMLIT_SERVER_EXTRA_FLAGS=""

CMD ["sh", "-c", "streamlit run app.py --server.port=8501 --server.address=0.0.0.0 --server.enableCORS=false $STREAMLIT_SERVER_EXTRA_FLAGS"]
