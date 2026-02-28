# Use Node.js 22 LTS on Alpine 3.21
FROM node:22-alpine3.21 AS base

# Install build dependencies: python3, pip, ffmpeg, and yt-dlp
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    && pip3 install --root-user-action=ignore --break-system-packages yt-dlp

WORKDIR /app

# Copy package files, prisma config, and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install Node dependencies
RUN npm ci

# Explicitly install prisma locally (so it's in node_modules/.bin)
RUN npm install prisma@6.3.1 --no-save

# Generate Prisma client
RUN npx prisma generate

# Copy the rest of the application
COPY . .

# Build Next.js app
RUN npm run build

# ----------------------------------------------------------------------
# Production stage
FROM node:22-alpine3.21

# Install runtime dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    && pip3 install --root-user-action=ignore --break-system-packages yt-dlp

WORKDIR /app

# Copy built artifacts and necessary files from base stage
COPY --from=base /app/.next ./.next
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/next.config.ts ./next.config.ts
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/public ./public
COPY --from=base /app/lib ./lib
COPY --from=base /app/components ./components

# Create non-root user and setup data directory
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 && \
    mkdir -p /app/data && \
    chown -R nextjs:nodejs /app && \
    chmod 777 /app/data

USER nextjs

EXPOSE 3000

# Run prisma migration then start app
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]