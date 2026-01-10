import puppeteer, { Browser, Page } from 'puppeteer';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';

const DASHBOARD_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:3000/api';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function clearData() {
  // Clear existing tasks
  try {
    const tasksRes = await fetch(`${API_URL}/projects/default/tasks`);
    const tasks = await tasksRes.json();
    for (const task of tasks) {
      await fetch(`${API_URL}/tasks/${task.id}`, { method: 'DELETE' });
    }
  } catch (e) {}
}

async function createDemoData() {
  // Create project
  try {
    await fetch(`${API_URL}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Demo Project', description: 'Multi-agent orchestration demo' })
    });
  } catch (e) {}

  // Create tasks with different statuses for a realistic board
  const tasks = [
    // Done tasks
    { title: 'Set up project structure', owner: 'engineering', priority: 'P1', status: 'done' },
    { title: 'Design database schema', owner: 'engineering', priority: 'P1', status: 'done' },
    { title: 'Create initial wireframes', owner: 'marketing', priority: 'P2', status: 'done' },

    // In Progress
    { title: 'Implement user authentication', owner: 'engineering', priority: 'P1', status: 'in_progress' },
    { title: 'Build analytics dashboard', owner: 'data', priority: 'P2', status: 'in_progress' },

    // Ready
    { title: 'Create landing page', owner: 'marketing', priority: 'P1', status: 'ready' },
    { title: 'Write API documentation', owner: 'pm', priority: 'P2', status: 'ready' },
    { title: 'Set up monitoring alerts', owner: 'engineering', priority: 'P2', status: 'ready' },

    // Backlog
    { title: 'Implement payment integration', owner: 'engineering', priority: 'P1', status: 'backlog' },
    { title: 'Create onboarding flow', owner: 'growth', priority: 'P2', status: 'backlog' },
    { title: 'Research competitor pricing', owner: 'researcher', priority: 'P3', status: 'backlog' },
    { title: 'Design email templates', owner: 'marketing', priority: 'P3', status: 'backlog' },
  ];

  const createdTasks: any[] = [];
  for (const task of tasks) {
    try {
      const res = await fetch(`${API_URL}/projects/default/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task)
      });
      const created = await res.json();
      createdTasks.push(created);
    } catch (e) {}
  }

  // Add some traces for the in-progress tasks
  for (const task of createdTasks.filter(t => t.status === 'in_progress' || t.status === 'done')) {
    try {
      await fetch(`${API_URL}/tasks/${task.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: task.owner,
          eventType: 'start',
          content: `Started working on: ${task.title}`
        })
      });
      await fetch(`${API_URL}/tasks/${task.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: task.owner,
          eventType: 'llm_call',
          content: 'Analyzing task requirements',
          tokens: { input: 1250, output: 890 },
          latencyMs: 2340
        })
      });
      if (task.status === 'done') {
        await fetch(`${API_URL}/tasks/${task.id}/traces`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentName: task.owner,
            eventType: 'complete',
            content: 'Task completed successfully'
          })
        });
      }
    } catch (e) {}
  }

  return createdTasks;
}

async function recordDemo() {
  console.log('🎬 Starting demo recording...');

  // Clear and create fresh data
  await clearData();
  const tasks = await createDemoData();
  console.log(`✅ Created ${tasks.length} demo tasks`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--window-size=1280,800',
      '--window-position=0,0'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Start recording
  const recorder = new PuppeteerScreenRecorder(page, {
    followNewTab: true,
    fps: 30,
    videoFrame: { width: 1280, height: 800 },
  });

  const videoPath = './demo/demo-new.mp4';
  await recorder.start(videoPath);
  console.log('📹 Recording started...');

  try {
    // ========== SCENE 1: Kanban Dashboard ==========
    console.log('Scene 1: Kanban Dashboard with tasks');
    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle0' });
    await sleep(1500);

    // Title overlay
    await page.evaluate(() => {
      const title = document.createElement('div');
      title.id = 'demo-title';
      title.innerHTML = `
        <div style="
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          background: #2563eb; color: white; padding: 12px 28px; border-radius: 8px;
          font-family: -apple-system, sans-serif; font-size: 18px; font-weight: 600;
          z-index: 10000; box-shadow: 0 4px 16px rgba(37,99,235,0.4);
        ">Kanban Task Board</div>
      `;
      document.body.appendChild(title);
    });
    await sleep(2500);
    await page.evaluate(() => document.getElementById('demo-title')?.remove());
    await sleep(500);

    // ========== SCENE 2: Agent picks up task ==========
    console.log('Scene 2: Agent picks up task');
    const readyTask = tasks.find((t: any) => t.status === 'ready');

    if (readyTask) {
      // Show command overlay
      await page.evaluate(() => {
        const overlay = document.createElement('div');
        overlay.id = 'cmd-overlay';
        overlay.innerHTML = `
          <div style="
            position: fixed; bottom: 20px; left: 20px;
            background: #1e293b; border-radius: 8px; padding: 16px 20px;
            font-family: 'Monaco', 'Menlo', monospace; font-size: 13px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 10000;
          ">
            <div style="color: #64748b; margin-bottom: 6px;">$ Agent picking up task...</div>
            <div style="color: #3b82f6;">POST /api/run-agent {"agent": "marketing"}</div>
          </div>
        `;
        document.body.appendChild(overlay);
      });
      await sleep(1500);

      // Move task to in_progress
      await fetch(`${API_URL}/tasks/${readyTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' })
      });

      // Add trace for this task
      await fetch(`${API_URL}/tasks/${readyTask.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'marketing',
          eventType: 'start',
          content: `Started: ${readyTask.title}`
        })
      });

      await page.reload({ waitUntil: 'networkidle0' });

      await page.evaluate(() => {
        const overlay = document.getElementById('cmd-overlay');
        if (overlay) {
          overlay.innerHTML = `
            <div style="
              position: fixed; bottom: 20px; left: 20px;
              background: #1e293b; border-radius: 8px; padding: 16px 20px;
              font-family: 'Monaco', 'Menlo', monospace; font-size: 13px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 10000;
            ">
              <div style="color: #22c55e;">✓ Agent started</div>
              <div style="color: #fbbf24; margin-top: 4px;">[Slack] Channel: #task-marketing-landing</div>
              <div style="color: #fbbf24;">[Agent] Working on task...</div>
            </div>
          `;
        }
      });
      await sleep(2500);
      await page.evaluate(() => document.getElementById('cmd-overlay')?.remove());
    }

    // ========== SCENE 3: Slack conversation ==========
    console.log('Scene 3: Slack real-time conversation');
    await page.evaluate(() => {
      const slack = document.createElement('div');
      slack.id = 'slack-panel';
      slack.innerHTML = `
        <div style="
          position: fixed; top: 80px; right: 20px; width: 360px;
          background: #1a1d21; border-radius: 8px;
          font-family: -apple-system, sans-serif; color: #fff;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4); z-index: 10000; overflow: hidden;
        ">
          <div style="background: #350d36; padding: 12px 16px; display: flex; align-items: center; gap: 10px;">
            <span style="font-weight: 600; font-size: 14px;"># task-marketing-landing</span>
            <span style="margin-left: auto; background: #22c55e; padding: 2px 8px; border-radius: 4px; font-size: 11px;">LIVE</span>
          </div>
          <div id="slack-messages" style="padding: 14px; min-height: 220px;"></div>
        </div>
      `;
      document.body.appendChild(slack);
    });
    await sleep(400);

    const messages = [
      { user: 'marketing', isBot: true, text: '🤖 Starting: Create landing page', delay: 700 },
      { user: 'marketing', isBot: true, text: 'Analyzing brand guidelines...', delay: 900 },
      { user: 'marketing', isBot: true, text: 'Generating hero section copy', delay: 800 },
      { user: 'dean', isBot: false, text: 'Add a pricing section please', delay: 1100 },
      { user: 'marketing', isBot: true, text: '✓ Added pricing with 3 tiers', delay: 900 },
      { user: 'marketing', isBot: true, text: '✅ Landing page complete!', delay: 700 },
    ];

    for (const msg of messages) {
      await page.evaluate((m: any) => {
        const container = document.getElementById('slack-messages');
        if (!container) return;
        const msgEl = document.createElement('div');
        msgEl.style.cssText = 'display: flex; margin-bottom: 14px;';
        msgEl.innerHTML = `
          <div style="
            width: 34px; height: 34px;
            background: ${m.isBot ? '#4a154b' : '#2eb67d'};
            border-radius: 4px;
            display: flex; align-items: center; justify-content: center;
            margin-right: 10px; flex-shrink: 0; font-size: 15px;
          ">${m.isBot ? '🤖' : '👤'}</div>
          <div>
            <div style="font-weight: 600; color: ${m.isBot ? '#1d9bd1' : '#fff'}; font-size: 13px;">
              ${m.user} <span style="color: #616061; font-weight: 400; font-size: 11px;">just now</span>
            </div>
            <div style="color: #d1d2d3; font-size: 13px; margin-top: 3px;">${m.text}</div>
          </div>
        `;
        container.appendChild(msgEl);
        container.scrollTop = container.scrollHeight;
      }, msg);
      await sleep(msg.delay);
    }
    await sleep(1200);

    // Complete the task
    if (readyTask) {
      await fetch(`${API_URL}/tasks/${readyTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' })
      });
      await fetch(`${API_URL}/tasks/${readyTask.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'marketing',
          eventType: 'complete',
          content: 'Landing page completed'
        })
      });
    }

    await page.evaluate(() => document.getElementById('slack-panel')?.remove());
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(1200);

    // ========== SCENE 4: GANTT Chart ==========
    console.log('Scene 4: Gantt Chart Timeline');
    await page.evaluate(() => {
      const title = document.createElement('div');
      title.id = 'demo-title';
      title.innerHTML = `
        <div style="
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          background: #2563eb; color: white; padding: 10px 24px; border-radius: 8px;
          font-family: -apple-system, sans-serif; font-size: 16px; font-weight: 600;
          z-index: 10000;
        ">Gantt Chart - Project Timeline</div>
      `;
      document.body.appendChild(title);
    });

    // Click GANTT button
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      btns.forEach((btn: any) => { if (btn.textContent?.includes('GANTT')) btn.click(); });
    });
    await sleep(3000);
    await page.evaluate(() => document.getElementById('demo-title')?.remove());
    await sleep(500);

    // ========== SCENE 5: TRACES View ==========
    console.log('Scene 5: Activity Traces by Task');
    await page.evaluate(() => {
      const title = document.createElement('div');
      title.id = 'demo-title';
      title.innerHTML = `
        <div style="
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          background: #2563eb; color: white; padding: 10px 24px; border-radius: 8px;
          font-family: -apple-system, sans-serif; font-size: 16px; font-weight: 600;
          z-index: 10000;
        ">Activity Traces - Token Usage & Timing</div>
      `;
      document.body.appendChild(title);
    });

    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      btns.forEach((btn: any) => { if (btn.textContent?.includes('TRACES')) btn.click(); });
    });
    await sleep(2500);

    // Click to expand a task group
    await page.evaluate(() => {
      const groups = document.querySelectorAll('.trace-group-header');
      if (groups.length > 0) (groups[0] as HTMLElement).click();
    });
    await sleep(2000);
    await page.evaluate(() => document.getElementById('demo-title')?.remove());
    await sleep(500);

    // ========== SCENE 6: AGENTS View ==========
    console.log('Scene 6: Agent Management');
    await page.evaluate(() => {
      const title = document.createElement('div');
      title.id = 'demo-title';
      title.innerHTML = `
        <div style="
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          background: #2563eb; color: white; padding: 10px 24px; border-radius: 8px;
          font-family: -apple-system, sans-serif; font-size: 16px; font-weight: 600;
          z-index: 10000;
        ">Agent Registry - Edit & Manage</div>
      `;
      document.body.appendChild(title);
    });

    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      btns.forEach((btn: any) => { if (btn.textContent?.includes('AGENTS')) btn.click(); });
    });
    await sleep(3000);
    await page.evaluate(() => document.getElementById('demo-title')?.remove());

    // ========== SCENE 7: Final CTA ==========
    console.log('Scene 7: GitHub CTA');
    await page.evaluate(() => {
      const cta = document.createElement('div');
      cta.innerHTML = `
        <div style="
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.92);
          display: flex; align-items: center; justify-content: center;
          z-index: 10000;
        ">
          <div style="
            background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
            border-radius: 16px; padding: 48px 72px; text-align: center;
            box-shadow: 0 8px 40px rgba(0,0,0,0.5);
          ">
            <div style="font-size: 60px; margin-bottom: 16px;">🤖</div>
            <div style="font-size: 32px; font-weight: 700; color: #fff; margin-bottom: 8px; font-family: -apple-system, sans-serif;">
              Agentic
            </div>
            <div style="font-size: 16px; color: #94a3b8; margin-bottom: 20px; font-family: -apple-system, sans-serif;">
              Self-improving multi-agent orchestration
            </div>
            <div style="font-size: 20px; color: #3b82f6; margin-bottom: 20px; font-family: -apple-system, sans-serif;">
              github.com/0xtechdean/agentic
            </div>
            <div style="font-size: 13px; color: #64748b; font-family: -apple-system, sans-serif;">
              MIT Licensed • TypeScript • Claude AI Powered
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(cta);
    });
    await sleep(3500);

  } catch (error) {
    console.error('Error during recording:', error);
  }

  // Stop recording
  await recorder.stop();
  console.log(`✅ Recording saved to: ${videoPath}`);

  await browser.close();

  // Convert to high-quality GIF
  console.log('🎨 Converting to GIF...');
  const { execSync } = await import('child_process');
  try {
    execSync(`ffmpeg -y -i ${videoPath} -vf "fps=15,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=sierra2_4a" -loop 0 ./demo/demo.gif`, {
      stdio: 'inherit'
    });
    console.log('✅ GIF created: ./demo/demo.gif');

    const { statSync } = await import('fs');
    const stats = statSync('./demo/demo.gif');
    console.log(`📦 GIF size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
  } catch (e) {
    console.log('⚠️ GIF conversion failed, MP4 available at:', videoPath);
  }
}

recordDemo().catch(console.error);
