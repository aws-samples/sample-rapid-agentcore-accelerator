# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

# Next.js chat frontend for AgentCore

# --- Builder stage: install dependencies and build the standalone server ---
FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# --- Runtime stage: only the standalone output, no build tooling ---
FROM public.ecr.aws/docker/library/node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# The base image ships a non-root "node" user
USER node

EXPOSE 3000

CMD ["node", "server.js"]
