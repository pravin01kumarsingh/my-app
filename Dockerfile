# Stage 1: Build/Prepare
FROM node:20-slim AS builder

WORKDIR /app

# Copy server package files and install dependencies
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm install --production

# Stage 2: Runtime
FROM node:20-slim

WORKDIR /app

# Install basic tools for SQLite if needed (better-sqlite3 comes with prebuilds usually)
# RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*

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
RUN mkdir -p /app/server/uploads

# Expose port
EXPOSE 3000

# Start server
WORKDIR /app/server
CMD ["node", "server.js"]
