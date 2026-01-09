#!/bin/bash
# Setup script for recording the full demo with frontend + Slack

set -e

G='\033[0;32m'
B='\033[0;34m'
Y='\033[1;33m'
N='\033[0m'

echo -e "${B}╔══════════════════════════════════════════════════════════╗${N}"
echo -e "${B}║          AI Team Orchestrator - Demo Setup              ║${N}"
echo -e "${B}╚══════════════════════════════════════════════════════════╝${N}"
echo ""

# Check if server is running
if curl -s http://localhost:3000/api/agents > /dev/null 2>&1; then
    echo -e "${G}✓ Server is running${N}"
else
    echo -e "${Y}Starting server...${N}"
    cd "$(dirname "$0")/.."
    npm run dev &
    sleep 3
fi

echo ""
echo -e "${Y}Creating demo project and tasks...${N}"

# Create a demo project
curl -s -X POST http://localhost:3000/api/projects \
    -H "Content-Type: application/json" \
    -d '{"name": "Demo Project", "description": "Demo for recording"}' > /dev/null 2>&1 || true

# Create demo tasks
echo -e "${G}Creating tasks...${N}"

curl -s -X POST http://localhost:3000/api/projects/default/tasks \
    -H "Content-Type: application/json" \
    -d '{"title": "Build user authentication API", "owner": "backend", "priority": "P1", "status": "ready"}' | jq -r '.id // "exists"'

curl -s -X POST http://localhost:3000/api/projects/default/tasks \
    -H "Content-Type: application/json" \
    -d '{"title": "Create login form component", "owner": "frontend", "priority": "P2", "status": "backlog"}' | jq -r '.id // "exists"'

curl -s -X POST http://localhost:3000/api/projects/default/tasks \
    -H "Content-Type: application/json" \
    -d '{"title": "Write API documentation", "owner": "pm", "priority": "P3", "status": "backlog"}' | jq -r '.id // "exists"'

echo ""
echo -e "${B}╔══════════════════════════════════════════════════════════╗${N}"
echo -e "${B}║  Setup Complete! Ready to record.                       ║${N}"
echo -e "${B}╠══════════════════════════════════════════════════════════╣${N}"
echo -e "${B}║                                                          ║${N}"
echo -e "${B}║  1. Open browser: http://localhost:3000                 ║${N}"
echo -e "${B}║  2. Open Slack workspace                                ║${N}"
echo -e "${B}║  3. Start screen recording                              ║${N}"
echo -e "${B}║  4. Run the agent command below:                        ║${N}"
echo -e "${B}║                                                          ║${N}"
echo -e "${B}╚══════════════════════════════════════════════════════════╝${N}"
echo ""
echo -e "${Y}Run this to trigger an agent:${N}"
echo ""
echo -e "${G}curl -X POST http://localhost:3000/api/run-agent \\
  -H \"Content-Type: application/json\" \\
  -d '{\"agentName\": \"backend\", \"task\": \"Build user authentication API\"}'${N}"
echo ""
