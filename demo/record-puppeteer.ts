import puppeteer, { Browser, Page } from 'puppeteer';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';

const DASHBOARD_URL = 'https://ai-team-production.up.railway.app';
const API_URL = 'https://ai-team-production.up.railway.app/api';

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

  // DON'T clear or create data on production - just record what's there
  // await clearData();
  // const tasks = await createDemoData();
  console.log('📹 Recording existing production data (no modifications)...');

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

    // ========== SCENE 3: Gantt Chart ==========
    console.log('Scene 3: Gantt Chart');
    await page.evaluate(() => {
      const title = document.createElement('div');
      title.id = 'demo-title';
      title.innerHTML = `<div style="
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: #2563eb; color: white; padding: 10px 24px; border-radius: 8px;
        font-family: -apple-system, sans-serif; font-size: 16px; font-weight: 600;
        z-index: 10000;
      ">Project Timeline</div>`;
      document.body.appendChild(title);
    });
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.nav-btn');
      btns.forEach((btn: any) => { if (btn.textContent?.includes('GANTT')) btn.click(); });
    });
    await sleep(3000);
    await page.evaluate(() => document.getElementById('demo-title')?.remove());

    // ========== SCENE 4: Activity Traces ==========
    console.log('Scene 4: Activity Traces');
    await page.evaluate(() => {
      const title = document.createElement('div');
      title.id = 'demo-title';
      title.innerHTML = `<div style="
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: #2563eb; color: white; padding: 10px 24px; border-radius: 8px;
        font-family: -apple-system, sans-serif; font-size: 16px; font-weight: 600;
        z-index: 10000;
      ">Agent Activity Traces</div>`;
      document.body.appendChild(title);
    });
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.nav-btn');
      btns.forEach((btn: any) => { if (btn.textContent?.includes('TRACES')) btn.click(); });
    });
    await sleep(2000);

    // Expand first task group to show traces
    await page.evaluate(() => {
      const groups = document.querySelectorAll('.trace-group-header');
      if (groups.length > 0) (groups[0] as HTMLElement).click();
    });
    await sleep(3000);
    await page.evaluate(() => document.getElementById('demo-title')?.remove());

    // ========== SCENE 5: Back to Tasks ==========
    console.log('Scene 5: Back to Tasks');
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.nav-btn');
      btns.forEach((btn: any) => { if (btn.textContent?.includes('TASKS')) btn.click(); });
    });
    await sleep(2000);

    // ========== SCENE 6: Final CTA - Light Theme ==========
    console.log('Scene 6: GitHub CTA');
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
