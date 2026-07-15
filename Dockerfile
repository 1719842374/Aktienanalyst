FROM node:20-slim

WORKDIR /app

# Install build tools required by better-sqlite3 (node-gyp needs Python + gcc)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --production=false

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

CMD ["node", "dist/index.cjs"]
