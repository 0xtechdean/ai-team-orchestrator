# Agentic - Multi-Agent Orchestration Platform
# Includes Claude CLI for autonomous agent execution

FROM node:20-slim

# Install dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

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

# Create a directory for Claude CLI config
RUN mkdir -p /root/.claude

# Set environment variables
ENV NODE_ENV=production
ENV CI=true

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
