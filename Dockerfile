# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Install Chromium + Playwright system dependencies for the PJ scraper
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Tell Playwright to use the system Chromium instead of downloading its own
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist

# Default output and log directories
RUN mkdir -p output logs

ENV NODE_ENV=production \
    LOG_LEVEL=info \
    LOG_FORMAT=json \
    LOG_DIR=/app/logs

ENTRYPOINT ["node", "dist/index.js"]
CMD ["--site=oefa"]
