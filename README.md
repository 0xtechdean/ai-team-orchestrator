# AI Team Orchestrator

A self-improving multi-agent system that coordinates AI agents to work on tasks collaboratively. Agents can create new agents, define reusable skills, and evolve based on performance metrics.

## Features

- **Multi-Agent Orchestration**: Coordinate multiple AI agents with different roles and capabilities
- **Self-Improvement System**: Agents can create new agents, skills, and evolve based on performance
- **Task Management**: Kanban-style task board with projects, priorities, and ownership
- **Shared Memory**: Agents share learnings via Mem0 for collective intelligence
- **Role-Based Permissions**: Manager, Specialist, and Support roles with different capabilities
- **Pattern Recognition**: Automatically identifies recurring patterns and suggests automations

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Team Orchestrator                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Manager   │  │  Specialist │  │   Support   │         │
│  │   Agents    │  │   Agents    │  │   Agents    │         │
│  │             │  │             │  │             │         │
│  │ - PM        │  │ - Backend   │  │ - Docs      │         │
│  │ - Eng Lead  │  │ - Frontend  │  │ - QA        │         │
│  │             │  │ - DevOps    │  │             │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          ▼                                  │
│              ┌───────────────────────┐                      │
│              │   Agent Orchestrator  │                      │
│              │   - Task Delegation   │                      │
│              │   - Memory Sharing    │                      │
│              │   - Self-Improvement  │                      │
│              └───────────┬───────────┘                      │
│                          │                                  │
│         ┌────────────────┼────────────────┐                 │
│         ▼                ▼                ▼                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Task DB   │  │   Memory    │  │   Agent     │         │
│  │   (Redis)   │  │   (Mem0)    │  │   Registry  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+ or Bun
- Redis (optional, uses in-memory storage if unavailable)
- Anthropic API key
- Mem0 API key (optional, for shared memory)

### Installation

```bash
# Clone the repository
git clone https://github.com/0xtechdean/ai-team-orchestrator.git
cd ai-team-orchestrator

# Install dependencies
npm install
# or
bun install

# Copy environment template
cp .env.example .env
# Edit .env with your API keys

# Build and run
npm run build
npm start
```

### Development

```bash
npm run dev
```

Open http://localhost:3000 to access the Kanban dashboard.

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for agent reasoning |
| `CLAUDE_MODEL` | No | Model to use (default: claude-sonnet-4-20250514) |
| `MEM0_API_KEY` | No | Mem0 API key for shared memory |
| `REDIS_URL` | No | Redis connection URL (uses in-memory if not set) |
| `REPO_PATH` | No | Path to load agent definitions from |
| `PORT` | No | Server port (default: 3000) |

### Agent Definitions

Create agent definitions in `.claude/agents/` as Markdown files:

```markdown
<!-- .claude/agents/backend.md -->
# Backend Engineer

You are a backend specialist focused on API development and database design.

## Capabilities
- API endpoint implementation
- Database schema design
- Performance optimization

## Tools
- Read, Write, Grep, Glob, Bash

## Guidelines
- Follow REST conventions
- Write comprehensive tests
- Document all endpoints
```

## API Reference

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create a new project |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/:id/tasks` | List tasks in project |
| POST | `/api/projects/:id/tasks` | Create a new task |
| GET | `/api/tasks/:id` | Get task details |
| PATCH | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |

### Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agents` | List all agents |
| GET | `/api/agents/:id` | Get agent details |
| POST | `/api/agents` | Create a new agent |
| GET | `/api/agents/:id/performance` | Get agent metrics |

### Orchestration

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/run-agent` | Run an agent on a task |
| POST | `/api/sprint-check` | Process next ready task |
| POST | `/api/daily-standup` | Run PM daily standup |

### Skills

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/skills` | List all skills |
| POST | `/api/skills` | Create a new skill |

## Self-Improvement System

### Agent Roles and Permissions

| Role | Can Create Agents | Can Create Skills | Can Modify Rules |
|------|-------------------|-------------------|------------------|
| Manager | Yes | Yes | Yes |
| Specialist | No | Yes | No |
| Support | No | No | No |

### Built-in Rules

1. **Documentation Rules** (Critical)
   - Read relevant docs before starting any task
   - Update status.md after completing any task

2. **Skill Creation Rule**
   - When a pattern is detected 3+ times, suggest creating a reusable skill

3. **Agent Creation Rule**
   - Manager agents can propose new agents for uncovered capabilities

### Pattern Tracking

The system automatically tracks task patterns and domains:

```typescript
// Patterns detected:
- "implement-endpoint" → API domain
- "create-component" → Frontend domain
- "fix-bug" → Debugging domain
- "write-tests" → Testing domain
```

When a pattern reaches the threshold, agents are prompted to create skills.

## Memory System

Agents share learnings through Mem0:

```typescript
// Memory is stored per agent and searchable by topic
await memory.addMemory(
  "API pagination should use cursor-based approach for large datasets",
  "backend",
  { type: "learning", domain: "api" }
);

// Other agents can search for relevant memories
const memories = await memory.searchMemories("pagination", undefined, 5);
```

## Task Workflow

1. Tasks start in **Backlog**
2. Move to **Ready** when unblocked
3. Agent picks up and moves to **In Progress**
4. Agent completes and moves to **Done**
5. PM evaluates and creates follow-up tasks

## Deployment

### Railway (Recommended)

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
CMD ["node", "dist/index.js"]
```

### Environment Setup for Production

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...
REDIS_URL=redis://...

# Optional but recommended
MEM0_API_KEY=m0-...
NODE_ENV=production
```

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built with [Claude](https://anthropic.com) by Anthropic
- Memory powered by [Mem0](https://mem0.ai)
- Inspired by multi-agent coordination research
