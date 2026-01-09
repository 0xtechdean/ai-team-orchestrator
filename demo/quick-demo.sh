#!/bin/bash
# Quick demo for GIF recording

# Colors
G='\033[0;32m'
B='\033[0;34m'
Y='\033[1;33m'
C='\033[0;36m'
N='\033[0m'

clear
echo -e "${B}╔══════════════════════════════════════════════════════════╗${N}"
echo -e "${B}║          🤖 AI Team Orchestrator                         ║${N}"
echo -e "${B}╚══════════════════════════════════════════════════════════╝${N}"
echo ""
sleep 1

echo -e "${Y}▶ Clone & Setup${N}"
echo -e "${G}$ git clone github.com/0xtechdean/ai-team-orchestrator${N}"
sleep 0.5
echo "Cloning... done."
echo -e "${G}$ npm install && npm start${N}"
sleep 0.5
echo ""
echo "╔══════════════════════════════════════╗"
echo "║  Server running on localhost:3000   ║"
echo "╚══════════════════════════════════════╝"
sleep 1

echo ""
echo -e "${Y}▶ Available Agents${N}"
echo -e "${G}$ curl /api/agents${N}"
sleep 0.3
echo -e "${C}[${N}"
echo -e "${C}  { name: \"pm\", role: \"manager\" },${N}"
echo -e "${C}  { name: \"backend\", role: \"specialist\" },${N}"
echo -e "${C}  { name: \"frontend\", role: \"specialist\" }${N}"
echo -e "${C}]${N}"
sleep 1

echo ""
echo -e "${Y}▶ Run Agent on Task${N}"
echo -e "${G}$ curl -X POST /api/run-agent -d '{agent: \"backend\", task: \"Build auth API\"}'${N}"
sleep 0.5
echo ""
echo -e "${B}[Orchestrator] Running backend agent...${N}"
sleep 0.3
echo -e "${B}[Slack] Created #task-backend-x7k2m${N}"
sleep 0.3
echo -e "${B}[Agent] Analyzing task...${N}"
sleep 0.5
echo -e "${B}[Agent] Implementing JWT auth...${N}"
sleep 0.5
echo -e "${B}[Agent] ✅ Task completed${N}"
sleep 1

echo ""
echo -e "${Y}▶ Self-Improvement${N}"
sleep 0.3
echo -e "${B}[Registry] Pattern detected: 'auth-endpoint' (3x)${N}"
sleep 0.3
echo -e "${B}[Registry] 💡 Creating skill: 'auth-scaffold'${N}"
sleep 0.3
echo -e "${B}[Registry] ✅ Skill saved for future use${N}"
sleep 1

echo ""
echo -e "${Y}▶ Slack Channel${N}"
echo "┌─────────────────────────────────────┐"
echo "│  #task-backend-x7k2m               │"
echo "├─────────────────────────────────────┤"
echo "│  🤖 backend: Starting auth API...  │"
echo "│  👤 dean: Add rate limiting?       │"
echo "│  🤖 backend: Added! 100 req/min    │"
echo "│  ✅ Task completed (45s)           │"
echo "└─────────────────────────────────────┘"
sleep 1.5

echo ""
echo -e "${B}╔══════════════════════════════════════════════════════════╗${N}"
echo -e "${B}║  github.com/0xtechdean/ai-team-orchestrator              ║${N}"
echo -e "${B}║  MIT Licensed • TypeScript • Self-Improving AI Teams    ║${N}"
echo -e "${B}╚══════════════════════════════════════════════════════════╝${N}"
sleep 2
