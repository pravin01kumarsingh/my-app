# Stage 1: Build/Prepare
FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (like better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy server package files and install dependencies
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm install --production

# Stage 2: Runtime
FROM node:22-slim

WORKDIR /app

# Copy built dependencies
COPY --from=builder /app/server/node_modules ./server/node_modules

# Copy application source
COPY public ./public
COPY server ./server

# Environment defaults
ENV PORT=3000
ENV NODE_ENV=production
ENV SESSION_SECRET=change-me-in-portainer-env

# Create data directories for volumes
RUN mkdir -p /app/server/uploads /app/server/data

# Expose port
EXPOSE 3000

# Start server
WORKDIR /app/server
CMD ["node", "server.js"]
