import puppeteer, { Browser, Page } from 'puppeteer';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';

const DASHBOARD_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:3000/api';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function clearData() {
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

  // Create tasks - more in progress to show monitoring
  const tasks = [
    // Done
    { title: 'Set up project structure', owner: 'engineering', priority: 'P1', status: 'done' },
    { title: 'Design database schema', owner: 'engineering', priority: 'P1', status: 'done' },

    // In Progress - multiple to show monitoring
    { title: 'Implement user authentication', owner: 'engineering', priority: 'P1', status: 'in_progress' },
    { title: 'Build analytics dashboard', owner: 'data', priority: 'P2', status: 'in_progress' },
    { title: 'Create marketing website', owner: 'marketing', priority: 'P1', status: 'in_progress' },

    // Ready
    { title: 'Write API documentation', owner: 'pm', priority: 'P2', status: 'ready' },
    { title: 'Set up CI/CD pipeline', owner: 'engineering', priority: 'P2', status: 'ready' },

    // Backlog
    { title: 'Implement payment integration', owner: 'engineering', priority: 'P1', status: 'backlog' },
    { title: 'Create onboarding flow', owner: 'growth', priority: 'P2', status: 'backlog' },
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

  // Add traces for in-progress and done tasks to show monitoring data
  for (const task of createdTasks.filter(t => t.status === 'in_progress' || t.status === 'done')) {
    try {
      await fetch(`${API_URL}/tasks/${task.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: task.owner,
          eventType: 'start',
          content: `Agent started: ${task.title}`
        })
      });
      await fetch(`${API_URL}/tasks/${task.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: task.owner,
          eventType: 'llm_call',
          content: 'Analyzing requirements and context',
          tokens: { input: 1850, output: 1240 },
          latencyMs: 3200
        })
      });
      await fetch(`${API_URL}/tasks/${task.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: task.owner,
          eventType: 'tool_use',
          content: 'Reading codebase files',
          latencyMs: 450
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

  await clearData();
  const tasks = await createDemoData();
  console.log(`✅ Created ${tasks.length} demo tasks with traces`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--window-size=1280,800',
      '--window-position=0,0',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const recorder = new PuppeteerScreenRecorder(page, {
    followNewTab: true,
    fps: 30,
    videoFrame: { width: 1280, height: 800 },
  });

  const videoPath = './demo/demo-new.mp4';
  await recorder.start(videoPath);
  console.log('📹 Recording started...');

  try {
    // ========== SCENE 1: Agents Registry - Meet the Team ==========
    console.log('Scene 1: Agents Registry - Meet the Team');
    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle0' });
    await sleep(500);

    // Go straight to Agents view
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.nav-btn');
      btns.forEach((btn: any) => { if (btn.textContent?.includes('AGENTS')) btn.click(); });
    });
    await sleep(1000);

    await page.evaluate(() => {
      const title = document.createElement('div');
      title.id = 'demo-title';
      title.innerHTML = `<div style="
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: #2563eb; color: white; padding: 12px 28px; border-radius: 8px;
        font-family: -apple-system, sans-serif; font-size: 18px; font-weight: 600;
        z-index: 10000; box-shadow: 0 4px 16px rgba(37,99,235,0.4);
      ">AI Agent Registry</div>`;
      document.body.appendChild(title);
    });
    await sleep(3000);

    // Click on first agent card to show details
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.agent-card');
      if (cards.length > 0) (cards[0] as HTMLElement).click();
    });
    await sleep(2000);
    await page.evaluate(() => document.getElementById('demo-title')?.remove());

    // ========== SCENE 2: Kanban Dashboard ==========
    console.log('Scene 2: Kanban Dashboard');
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.nav-btn');
      btns.forEach((btn: any) => { if (btn.textContent?.includes('TASKS')) btn.click(); });
    });
    await sleep(1000);

    await page.evaluate(() => {
      const title = document.createElement('div');
      title.id = 'demo-title';
      title.innerHTML = `<div style="
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: #2563eb; color: white; padding: 10px 24px; border-radius: 8px;
        font-family: -apple-system, sans-serif; font-size: 16px; font-weight: 600;
        z-index: 10000;
      ">Task Board</div>`;
      document.body.appendChild(title);
    });
    await sleep(2500);
    await page.evaluate(() => document.getElementById('demo-title')?.remove());

    // ========== SCENE 3: Move task from Backlog to Ready ==========
    console.log('Scene 3: Move task from Backlog to Ready');
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.nav-btn');
      btns.forEach((btn: any) => { if (btn.textContent?.includes('TASKS')) btn.click(); });
    });
    await sleep(1000);

    const backlogTask = tasks.find((t: any) => t.status === 'backlog');
    if (backlogTask) {
      // Show overlay indicating task is being moved to ready
      await page.evaluate(() => {
        const overlay = document.createElement('div');
        overlay.id = 'cmd-overlay';
        overlay.innerHTML = `<div style="
          position: fixed; bottom: 20px; left: 20px;
          background: #1e293b; border-radius: 8px; padding: 16px 20px;
          font-family: 'Monaco', monospace; font-size: 13px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 10000;
        ">
          <div style="color: #64748b; margin-bottom: 6px;">$ Moving task to ready...</div>
          <div style="color: #f59e0b;">PATCH /api/tasks/:id {"status": "ready"}</div>
        </div>`;
        document.body.appendChild(overlay);
      });
      await sleep(1200);

      // Move task from backlog to ready
      await fetch(`${API_URL}/tasks/${backlogTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ready' })
      });

      await page.reload({ waitUntil: 'networkidle0' });
      await page.evaluate(() => {
        const overlay = document.getElementById('cmd-overlay');
        if (overlay) {
          overlay.innerHTML = `<div style="
            position: fixed; bottom: 20px; left: 20px;
            background: #1e293b; border-radius: 8px; padding: 16px 20px;
            font-family: 'Monaco', monospace; font-size: 13px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 10000;
          ">
            <div style="color: #22c55e;">✓ Task moved to Ready</div>
          </div>`;
        }
      });
      await sleep(1500);
      await page.evaluate(() => document.getElementById('cmd-overlay')?.remove());

      // ========== SCENE 4: Agent picks up task from Ready ==========
      console.log('Scene 4: Agent picks up task from Ready');
      await page.evaluate(() => {
        const overlay = document.createElement('div');
        overlay.id = 'cmd-overlay';
        overlay.innerHTML = `<div style="
          position: fixed; bottom: 20px; left: 20px;
          background: #1e293b; border-radius: 8px; padding: 16px 20px;
          font-family: 'Monaco', monospace; font-size: 13px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 10000;
        ">
          <div style="color: #64748b; margin-bottom: 6px;">$ Agent picking up task...</div>
          <div style="color: #3b82f6;">POST /api/run-agent {"agent": "engineering"}</div>
        </div>`;
        document.body.appendChild(overlay);
      });
      await sleep(1200);

      // Agent picks up task - move to in_progress
      await fetch(`${API_URL}/tasks/${backlogTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' })
      });

      // Add trace events for the agent's work
      await fetch(`${API_URL}/tasks/${backlogTask.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'engineering',
          eventType: 'start',
          content: `Started: ${backlogTask.title}`
        })
      });

      await page.reload({ waitUntil: 'networkidle0' });
      await page.evaluate(() => {
        const overlay = document.getElementById('cmd-overlay');
        if (overlay) {
          overlay.innerHTML = `<div style="
            position: fixed; bottom: 20px; left: 20px;
            background: #1e293b; border-radius: 8px; padding: 16px 20px;
            font-family: 'Monaco', monospace; font-size: 13px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 10000;
          ">
            <div style="color: #22c55e;">✓ Agent started working</div>
            <div style="color: #fbbf24; margin-top: 4px;">[Slack] #task-engineering</div>
          </div>`;
        }
      });
      await sleep(1500);
      await page.evaluate(() => document.getElementById('cmd-overlay')?.remove());

      // Add multiple trace events while still on Tasks view (build up logs)
      await fetch(`${API_URL}/tasks/${backlogTask.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'engineering',
          eventType: 'llm_call',
          content: 'Analyzing payment integration requirements',
          tokens: { input: 2100, output: 1580 },
          latencyMs: 2800
        })
      });
      await sleep(800);

      await fetch(`${API_URL}/tasks/${backlogTask.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'engineering',
          eventType: 'tool_use',
          content: 'Reading Stripe API documentation',
          latencyMs: 450
        })
      });
      await sleep(600);

      await fetch(`${API_URL}/tasks/${backlogTask.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'engineering',
          eventType: 'llm_call',
          content: 'Designing payment flow architecture',
          tokens: { input: 1850, output: 2100 },
          latencyMs: 3500
        })
      });
      await sleep(600);

      await fetch(`${API_URL}/tasks/${backlogTask.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'engineering',
          eventType: 'tool_use',
          content: 'Creating Stripe integration module',
          latencyMs: 650
        })
      });
      await sleep(500);

      // ========== SCENE 5: Show Traces - Agent work in progress ==========
      console.log('Scene 5: Traces - Agent work live');
      await page.evaluate(() => {
        const title = document.createElement('div');
        title.id = 'demo-title';
        title.innerHTML = `<div style="
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          background: #2563eb; color: white; padding: 10px 24px; border-radius: 8px;
          font-family: -apple-system, sans-serif; font-size: 16px; font-weight: 600;
          z-index: 10000;
        ">Live Agent Traces</div>`;
        document.body.appendChild(title);
      });
      await page.evaluate(() => {
        const btns = document.querySelectorAll('.nav-btn');
        btns.forEach((btn: any) => { if (btn.textContent?.includes('TRACES')) btn.click(); });
      });
      await sleep(1500);

      // Expand the payment task group to show all traces
      await page.evaluate(() => {
        const groups = document.querySelectorAll('.trace-group-header');
        // Find the one with "payment" in it
        groups.forEach((g: any) => {
          if (g.textContent?.toLowerCase().includes('payment')) g.click();
        });
      });
      await sleep(3000);

      // Add one more trace event in real-time
      await fetch(`${API_URL}/tasks/${backlogTask.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'engineering',
          eventType: 'tool_use',
          content: 'Writing unit tests for payment flow',
          latencyMs: 890
        })
      });
      await page.reload({ waitUntil: 'networkidle0' });
      await page.evaluate(() => {
        const btns = document.querySelectorAll('.nav-btn');
        btns.forEach((btn: any) => { if (btn.textContent?.includes('TRACES')) btn.click(); });
      });
      await sleep(1000);

      // Re-expand the payment task group
      await page.evaluate(() => {
        const groups = document.querySelectorAll('.trace-group-header');
        groups.forEach((g: any) => {
          if (g.textContent?.toLowerCase().includes('payment')) g.click();
        });
      });
      await sleep(2500);
      await page.evaluate(() => document.getElementById('demo-title')?.remove());
    }

    // ========== SCENE 6: Slack conversation ==========
    console.log('Scene 6: Slack conversation');
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.nav-btn');
      btns.forEach((btn: any) => { if (btn.textContent?.includes('TASKS')) btn.click(); });
    });
    await sleep(500);

    await page.evaluate(() => {
      const slack = document.createElement('div');
      slack.id = 'slack-panel';
      slack.innerHTML = `<div style="
        position: fixed; top: 80px; right: 20px; width: 360px;
        background: #1a1d21; border-radius: 8px;
        font-family: -apple-system, sans-serif; color: #fff;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4); z-index: 10000; overflow: hidden;
      ">
        <div style="background: #350d36; padding: 12px 16px; display: flex; align-items: center; gap: 10px;">
          <span style="font-weight: 600; font-size: 14px;"># task-engineering</span>
          <span style="margin-left: auto; background: #22c55e; padding: 2px 8px; border-radius: 4px; font-size: 11px;">LIVE</span>
        </div>
        <div id="slack-messages" style="padding: 14px; min-height: 200px;"></div>
      </div>`;
      document.body.appendChild(slack);
    });
    await sleep(400);

    const messages = [
      { user: 'engineering', isBot: true, text: '🤖 Working on: Payment integration', delay: 700 },
      { user: 'engineering', isBot: true, text: 'Setting up Stripe SDK...', delay: 900 },
      { user: 'dean', isBot: false, text: 'Use the test keys first', delay: 1000 },
      { user: 'engineering', isBot: true, text: '✓ Using test environment', delay: 800 },
      { user: 'engineering', isBot: true, text: '✅ Payment flow complete!', delay: 700 },
    ];

    for (const msg of messages) {
      await page.evaluate((m: any) => {
        const container = document.getElementById('slack-messages');
        if (!container) return;
        const msgEl = document.createElement('div');
        msgEl.style.cssText = 'display: flex; margin-bottom: 14px;';
        msgEl.innerHTML = `
          <div style="width: 34px; height: 34px; background: ${m.isBot ? '#4a154b' : '#2eb67d'};
            border-radius: 4px; display: flex; align-items: center; justify-content: center;
            margin-right: 10px; flex-shrink: 0; font-size: 15px;">${m.isBot ? '🤖' : '👤'}</div>
          <div>
            <div style="font-weight: 600; color: ${m.isBot ? '#1d9bd1' : '#fff'}; font-size: 13px;">
              ${m.user} <span style="color: #616061; font-weight: 400; font-size: 11px;">now</span>
            </div>
            <div style="color: #d1d2d3; font-size: 13px; margin-top: 3px;">${m.text}</div>
          </div>`;
        container.appendChild(msgEl);
        container.scrollTop = container.scrollHeight;
      }, msg);
      await sleep(msg.delay);
    }
    await sleep(1000);

    if (backlogTask) {
      await fetch(`${API_URL}/tasks/${backlogTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' })
      });
      await fetch(`${API_URL}/tasks/${backlogTask.id}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'engineering',
          eventType: 'complete',
          content: 'Payment integration completed'
        })
      });
    }

    await page.evaluate(() => document.getElementById('slack-panel')?.remove());
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(1000);

    // ========== SCENE 7: Final CTA - Light Theme ==========
    console.log('Scene 7: GitHub CTA');
    await page.evaluate(() => {
      const cta = document.createElement('div');
      cta.innerHTML = `<div style="
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(255,255,255,0.97);
        display: flex; align-items: center; justify-content: center;
        z-index: 10000;
      ">
        <div style="
          background: white; border: 1px solid #e0e0e0;
          border-radius: 16px; padding: 48px 72px; text-align: center;
          box-shadow: 0 8px 40px rgba(0,0,0,0.1);
        ">
          <div style="font-size: 60px; margin-bottom: 16px;">🤖</div>
          <div style="font-size: 32px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px; font-family: -apple-system, sans-serif;">
            Agentic
          </div>
          <div style="font-size: 16px; color: #666; margin-bottom: 20px; font-family: -apple-system, sans-serif;">
            Self-improving multi-agent orchestration
          </div>
          <div style="font-size: 20px; color: #2563eb; margin-bottom: 20px; font-family: -apple-system, sans-serif; font-weight: 600;">
            github.com/0xtechdean/agentic
          </div>
          <div style="font-size: 13px; color: #999; font-family: -apple-system, sans-serif;">
            MIT Licensed • TypeScript • Claude AI
          </div>
        </div>
      </div>`;
      document.body.appendChild(cta);
    });
    await sleep(3500);

  } catch (error) {
    console.error('Error during recording:', error);
  }

  await recorder.stop();
  console.log(`✅ Recording saved to: ${videoPath}`);

  await browser.close();

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
