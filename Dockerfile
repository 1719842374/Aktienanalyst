FROM node:20-slim

WORKDIR /app

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
