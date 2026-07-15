FROM node:20-slim

WORKDIR /app

# Install build tools (node-gyp needs Python + gcc; playwright needs chromium deps)
# CACHE-BUST: 2026-07-15b
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
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
    && ln -sf /usr/bin/python3 /usr/local/bin/python \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies
RUN npm ci --production=false

# Install Playwright Chromium browser
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
