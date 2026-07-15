FROM node:20-slim

WORKDIR /app

# Install build tools (node-gyp needs Python + gcc; playwright needs chromium deps)
# CACHE-BUST: bump this comment if apt layer gets stale -> 2026-07-15
RUN apt-get update && apt-get install -y \
    python3 \
    python3-is-python \
    make \
    g++ \
    # Playwright / Chromium runtime deps
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Copy package files AFTER apt layer so npm ci can use python3
COPY package.json package-lock.json ./

# Install all dependencies (including devDeps needed for build)
RUN npm ci --production=false

# Install Playwright browser (Chromium only, no extras)
RUN npx playwright install chromium --with-deps 2>/dev/null || true

# Copy source
COPY . .

# Build
RUN npm run build

# Production dependencies only
RUN npm prune --production

# Create cache directory
RUN mkdir -p .cache

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright

CMD ["node", "dist/index.cjs"]
