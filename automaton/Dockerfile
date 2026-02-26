# Automaton Dockerfile
# Multi-stage build for optimized production image

# Stage 1: Build
FROM node:20-bookworm-slim AS builder

# Install build dependencies for better-sqlite3
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ sqlite3 && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm build

# Stage 2: Production
FROM node:20-bookworm-slim AS runtime

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends sqlite3 wget curl && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm for production
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

WORKDIR /app

# Copy built files and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create data directories
RUN mkdir -p /root/.automaton/keys /root/.automaton/data

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:18790/health || exit 1

# Expose ports
# 18790 - HTTP API
# 18791 - WebSocket
EXPOSE 18790 18791

# Set production environment
ENV NODE_ENV=production
ENV INTERAGENT_ENABLED=true
ENV INTERAGENT_HTTP_PORT=18790
ENV INTERAGENT_WS_PORT=18791

# Run the application
CMD ["node", "dist/index.js", "--run"]
