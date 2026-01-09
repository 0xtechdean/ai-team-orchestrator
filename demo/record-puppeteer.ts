import puppeteer, { Browser, Page } from 'puppeteer';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';

const DASHBOARD_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:3000/api';
const SLACK_WORKSPACE = 'https://app.slack.com'; // Update with your workspace

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createTestTasks() {
  // Create tasks in different statuses for the demo
  const tasks = [
    { title: 'Design database schema', owner: 'backend', priority: 'P1', status: 'done' },
    { title: 'Build user auth API', owner: 'backend', priority: 'P1', status: 'ready' },
    { title: 'Create login form', owner: 'frontend', priority: 'P2', status: 'backlog' },
    { title: 'Write API docs', owner: 'pm', priority: 'P3', status: 'backlog' },
  ];

  for (const task of tasks) {
    try {
      await fetch(`${API_URL}/projects/default/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task)
      });
    } catch (e) {
      // Task might already exist
    }
  }
}

async function recordDemo() {
  console.log('🎬 Starting demo recording with frontend + Slack...');

  // Create test tasks first
  await createTestTasks();

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--window-size=1400,900',
      '--window-position=0,0'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Start recording
  const recorder = new PuppeteerScreenRecorder(page, {
    followNewTab: true,
    fps: 30,
    videoFrame: { width: 1400, height: 900 },
  });

  const videoPath = './demo/demo-full.mp4';
  await recorder.start(videoPath);
  console.log('📹 Recording started...');

  try {
    // Scene 1: Dashboard with tasks in columns
    console.log('Scene 1: Dashboard overview');
    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle0' });
    await sleep(2500);

    // Add a title overlay
    await page.evaluate(() => {
      const title = document.createElement('div');
      title.id = 'demo-title';
      title.innerHTML = `
        <div style="
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0,0,0,0.8);
          color: white;
          padding: 12px 24px;
          border-radius: 8px;
          font-family: -apple-system, sans-serif;
          font-size: 18px;
          font-weight: 600;
          z-index: 10000;
        ">
          🤖 AI Team Orchestrator - Kanban Dashboard
        </div>
      `;
      document.body.appendChild(title);
    });
    await sleep(2000);

    // Remove title
    await page.evaluate(() => {
      document.getElementById('demo-title')?.remove();
    });

    // Scene 2: Highlight a task and show we're about to run an agent
    console.log('Scene 2: Select task for agent');
    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.id = 'action-overlay';
      overlay.innerHTML = `
        <div style="
          position: fixed;
          bottom: 20px;
          left: 20px;
          background: #1e1e1e;
          border-radius: 8px;
          padding: 16px 20px;
          font-family: 'Monaco', monospace;
          font-size: 14px;
          color: #4ade80;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          z-index: 10000;
          max-width: 600px;
        ">
          <div style="color: #888; margin-bottom: 8px;">$ Running backend agent on task...</div>
          <div style="color: #60a5fa;">curl -X POST /api/run-agent -d '{"agentName": "backend"}'</div>
        </div>
      `;
      document.body.appendChild(overlay);
    });
    await sleep(2000);

    // Scene 3: Make API call and show task moving
    console.log('Scene 3: Agent starts - task moves to In Progress');

    // Update a task to "in_progress" to simulate agent picking it up
    const tasksRes = await fetch(`${API_URL}/projects/default/tasks`);
    const tasks = await tasksRes.json();
    const readyTask = tasks.find((t: any) => t.status === 'ready');

    if (readyTask) {
      await fetch(`${API_URL}/tasks/${readyTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' })
      });
    }

    // Update overlay to show progress
    await page.evaluate(() => {
      const overlay = document.getElementById('action-overlay');
      if (overlay) {
        overlay.innerHTML = `
          <div style="
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: #1e1e1e;
            border-radius: 8px;
            padding: 16px 20px;
            font-family: 'Monaco', monospace;
            font-size: 14px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            max-width: 600px;
          ">
            <div style="color: #4ade80;">✓ Agent started</div>
            <div style="color: #fbbf24; margin-top: 4px;">[Slack] Creating channel #task-backend-abc123</div>
            <div style="color: #fbbf24;">[Agent] Task moved to In Progress</div>
          </div>
        `;
      }
    });

    // Refresh to show task moved
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(2500);

    // Scene 4: Show Slack channel simulation (side panel)
    console.log('Scene 4: Slack channel with conversation');
    await page.evaluate(() => {
      const overlay = document.getElementById('action-overlay');
      if (overlay) overlay.remove();

      const slack = document.createElement('div');
      slack.id = 'slack-panel';
      slack.innerHTML = `
        <div style="
          position: fixed;
          top: 60px;
          right: 20px;
          width: 380px;
          height: 500px;
          background: #1a1d21;
          border-radius: 8px;
          font-family: -apple-system, sans-serif;
          color: #fff;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          z-index: 10000;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        ">
          <!-- Slack Header -->
          <div style="background: #350d36; padding: 12px 16px; display: flex; align-items: center; gap: 8px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>
            <span style="font-weight: 600;"># task-backend-abc123</span>
          </div>

          <!-- Messages -->
          <div id="slack-messages" style="flex: 1; padding: 16px; overflow-y: auto;">
          </div>

          <!-- Input -->
          <div style="padding: 12px 16px; border-top: 1px solid #333;">
            <div id="slack-input" style="background: #222529; border-radius: 4px; padding: 10px 12px; color: #888; font-size: 14px;">
              Message #task-backend-abc123
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(slack);
    });
    await sleep(500);

    // Animate messages appearing
    const messages = [
      { user: 'backend', isBot: true, text: '🤖 Starting work on: Build user auth API', delay: 800 },
      { user: 'backend', isBot: true, text: 'Analyzing requirements...', delay: 1000 },
      { user: 'backend', isBot: true, text: 'Implementing JWT authentication', delay: 1200 },
      { user: 'dean', isBot: false, text: 'Can you add rate limiting?', delay: 1500 },
      { user: 'backend', isBot: true, text: '✅ Added rate limiting: 100 req/min', delay: 1000 },
      { user: 'backend', isBot: true, text: '✅ Task completed! PR ready for review.', delay: 1200 },
    ];

    for (const msg of messages) {
      await page.evaluate((m) => {
        const container = document.getElementById('slack-messages');
        if (!container) return;

        const msgEl = document.createElement('div');
        msgEl.style.cssText = 'display: flex; margin-bottom: 16px; animation: fadeIn 0.3s ease;';
        msgEl.innerHTML = `
          <div style="
            width: 36px;
            height: 36px;
            background: ${m.isBot ? '#4a154b' : '#2eb67d'};
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 10px;
            flex-shrink: 0;
          ">${m.isBot ? '🤖' : '👤'}</div>
          <div>
            <div style="font-weight: 600; color: ${m.isBot ? '#1d9bd1' : '#fff'}; font-size: 14px;">
              ${m.user}
              <span style="color: #616061; font-weight: 400; font-size: 12px;">now</span>
            </div>
            <div style="color: #d1d2d3; font-size: 14px; margin-top: 2px;">${m.text}</div>
          </div>
        `;
        container.appendChild(msgEl);
        container.scrollTop = container.scrollHeight;
      }, msg);
      await sleep(msg.delay);
    }

    await sleep(1500);

    // Scene 5: Task moves to Done
    console.log('Scene 5: Task completed - moves to Done');

    if (readyTask) {
      await fetch(`${API_URL}/tasks/${readyTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' })
      });
    }

    // Add completion badge
    await page.evaluate(() => {
      const slack = document.getElementById('slack-panel');
      if (slack) {
        const badge = document.createElement('div');
        badge.style.cssText = `
          position: absolute;
          top: 50px;
          right: 10px;
          background: #2eb67d;
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
        `;
        badge.textContent = '✓ COMPLETED';
        slack.appendChild(badge);
      }
    });

    // Refresh to show task in Done column
    await page.reload({ waitUntil: 'networkidle0' });

    // Re-add slack panel after refresh
    await page.evaluate(() => {
      const slack = document.createElement('div');
      slack.innerHTML = `
        <div style="
          position: fixed;
          top: 60px;
          right: 20px;
          width: 380px;
          background: #1a1d21;
          border-radius: 8px;
          font-family: -apple-system, sans-serif;
          color: #fff;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          z-index: 10000;
          overflow: hidden;
        ">
          <div style="background: #350d36; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: 600;"># task-backend-abc123</span>
            </div>
            <span style="background: #2eb67d; padding: 2px 8px; border-radius: 4px; font-size: 12px;">✓ Done</span>
          </div>
          <div style="padding: 16px; font-size: 14px; color: #aaa;">
            Task completed successfully.<br/>
            Channel archived.
          </div>
        </div>
      `;
      document.body.appendChild(slack);
    });
    await sleep(2500);

    // Scene 6: Self-improvement
    console.log('Scene 6: Self-improvement');
    await page.evaluate(() => {
      // Remove slack panel
      const panels = document.querySelectorAll('[style*="position: fixed"]');
      panels.forEach(p => p.remove());

      const improve = document.createElement('div');
      improve.innerHTML = `
        <div style="
          position: fixed;
          bottom: 20px;
          left: 20px;
          right: 20px;
          background: linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 100%);
          border-radius: 8px;
          padding: 20px;
          font-family: 'Monaco', monospace;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          z-index: 10000;
        ">
          <div style="color: #60a5fa; font-size: 16px; margin-bottom: 12px;">🧠 Self-Improvement System</div>
          <div style="color: #fbbf24; margin-bottom: 6px;">[Registry] Pattern detected: 'auth-endpoint' used 3 times</div>
          <div style="color: #fbbf24; margin-bottom: 6px;">[Registry] 💡 Creating reusable skill: 'jwt-auth-scaffold'</div>
          <div style="color: #4ade80; margin-top: 10px;">✅ Skill saved! Future auth tasks will be 3x faster.</div>
        </div>
      `;
      document.body.appendChild(improve);
    });
    await sleep(3500);

    // Scene 7: Final CTA
    console.log('Scene 7: GitHub CTA');
    await page.evaluate(() => {
      // Clear all overlays
      const overlays = document.querySelectorAll('[style*="position: fixed"]');
      overlays.forEach(o => o.remove());

      const cta = document.createElement('div');
      cta.innerHTML = `
        <div style="
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        ">
          <div style="
            background: linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 100%);
            border-radius: 16px;
            padding: 48px 64px;
            text-align: center;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          ">
            <div style="font-size: 64px; margin-bottom: 20px;">🤖</div>
            <div style="font-size: 28px; font-weight: 700; color: #fff; margin-bottom: 12px; font-family: -apple-system, sans-serif;">
              AI Team Orchestrator
            </div>
            <div style="font-size: 18px; color: #60a5fa; margin-bottom: 20px; font-family: -apple-system, sans-serif;">
              github.com/0xtechdean/ai-team-orchestrator
            </div>
            <div style="font-size: 14px; color: #888; font-family: -apple-system, sans-serif;">
              MIT Licensed • TypeScript • Self-Improving AI Teams
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(cta);
    });
    await sleep(3000);

  } catch (error) {
    console.error('Error during recording:', error);
  }

  // Stop recording
  await recorder.stop();
  console.log(`✅ Recording saved to: ${videoPath}`);

  await browser.close();

  // Convert to GIF with better quality
  console.log('🎨 Converting to GIF...');
  const { execSync } = await import('child_process');
  try {
    // Higher quality GIF with better colors
    execSync(`ffmpeg -y -i ${videoPath} -vf "fps=15,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=single[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" -loop 0 ./demo/demo.gif`, {
      stdio: 'inherit'
    });
    console.log('✅ GIF created: ./demo/demo.gif');

    // Show file size
    const { statSync } = await import('fs');
    const stats = statSync('./demo/demo.gif');
    console.log(`📦 GIF size: ${(stats.size / 1024).toFixed(0)}KB`);
  } catch (e) {
    console.log('⚠️ GIF conversion failed, MP4 available at:', videoPath);
  }
}

recordDemo().catch(console.error);
