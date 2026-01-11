# Agentic - Multi-Agent Orchestration Platform
# Includes Claude CLI for autonomous agent execution

FROM node:20-slim

# Install dependencies (expect provides unbuffer for pseudo-TTY, chromium for puppeteer)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    expect \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user (Claude CLI doesn't allow --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash appuser

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci

# Copy source files
COPY src ./src
COPY public ./public

# Build TypeScript
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Copy agent definitions
COPY .claude ./.claude

# Create Claude CLI config directory for appuser
RUN mkdir -p /home/appuser/.claude && chown -R appuser:appuser /home/appuser/.claude

# Change ownership of app directory to appuser
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Set environment variables
ENV NODE_ENV=production
ENV CI=true
ENV HOME=/home/appuser

# Claude CLI authentication:
# 1. Run 'claude setup-token' locally to get a long-lived token
# 2. Set CLAUDE_CODE_OAUTH_TOKEN on Railway
# 3. Also set USE_CLAUDE_CODE=true to enable CLI mode

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
