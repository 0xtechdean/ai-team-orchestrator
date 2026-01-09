# Recording the Full Demo

This guide helps you record a demo showing the frontend dashboard and Slack integration.

## What to Capture

1. **Kanban Dashboard** - Task board with projects and tasks
2. **Agent Execution** - Running an agent on a task
3. **Slack Channel** - Real-time channel creation and messages

## Setup Before Recording

### 1. Start the Server

```bash
cd /Users/deanrubin/ai-team-orchestrator
npm run dev
```

Server runs at http://localhost:3000

### 2. Create a Test Task

```bash
curl -X POST http://localhost:3000/api/projects/default/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Build user authentication API", "owner": "backend", "priority": "P1", "status": "ready"}'
```

### 3. Open Both Windows

- **Browser**: http://localhost:3000 (Kanban dashboard)
- **Slack**: Your workspace with the notification channel open

## Recording Steps

### Option A: Screen.studio (Mac - Recommended)

1. Download Screen.studio from https://screen.studio
2. Set up split view: Dashboard on left, Slack on right
3. Record the following flow:
   - Show the dashboard with tasks
   - Run an agent: `curl -X POST http://localhost:3000/api/run-agent -H "Content-Type: application/json" -d '{"agentName": "backend", "task": "Build user authentication API"}'`
   - Watch the task move to "In Progress"
   - Switch to Slack - show the new channel created
   - Show the agent posting updates
   - Task completes - show final state

### Option B: OBS Studio (Free, Cross-platform)

1. Install OBS from https://obsproject.com
2. Add scenes for Dashboard and Slack
3. Use scene transitions

### Option C: QuickTime + iMovie (Mac Built-in)

1. QuickTime Player → New Screen Recording
2. Select area to record
3. Edit in iMovie to add transitions

## Demo Script (What to Show)

```
Scene 1: Dashboard (5s)
- Show Kanban board with projects
- Highlight a task in "Ready" column

Scene 2: Run Agent (10s)
- Open terminal
- Run: curl -X POST localhost:3000/api/run-agent ...
- Show response

Scene 3: Dashboard Update (5s)
- Task moves to "In Progress"
- Status indicator changes

Scene 4: Slack Channel (10s)
- Switch to Slack
- Show new channel: #task-backend-xxx
- Show agent's initial message
- (Optional) Type a message to the agent

Scene 5: Completion (5s)
- Agent posts completion summary
- Task moves to "Done" in dashboard
```

## Converting to GIF

After recording MP4:

```bash
# Using ffmpeg
ffmpeg -i demo.mp4 -vf "fps=10,scale=800:-1:flags=lanczos" -c:v gif demo.gif

# Or use gifski for better quality
gifski --fps 10 --width 800 -o demo.gif demo.mp4
```

## Tips

- Keep it under 30 seconds for GIF
- Use 800px width for good quality + file size
- Speed up waiting periods (agent thinking time)
- Add captions/annotations in post
