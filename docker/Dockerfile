FROM node:20-slim

WORKDIR /app

# Playwright dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy built files
COPY dist/ ./dist/
COPY skills/ ./skills/
COPY .mcp.json ./

# Create user
RUN useradd -m mugiclaw
USER mugiclaw

CMD ["node", "dist/index.js"]
