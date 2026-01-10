import 'dotenv/config';
import puppeteer from 'puppeteer';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';

const DASHBOARD_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:3000/api';
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN!;
const DEAN_USER_ID = 'U04MBJNGFTR';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createSlackChannel(taskId: string): Promise<string | null> {
  const channelName = `task-backend-${taskId}`;
  const res = await fetch('https://slack.com/api/conversations.create', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SLACK_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: channelName, is_private: false }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error('Channel creation failed:', data.error);
    return null;
  }

  // Invite user
  await fetch('https://slack.com/api/conversations.invite', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SLACK_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: data.channel.id, users: DEAN_USER_ID }),
  });

  return data.channel.id;
}

async function postToSlack(channelId: string, text: string) {
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SLACK_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: channelId, text }),
  });
}

async function setupTasks() {
  // Delete all existing tasks first
  try {
    const existingRes = await fetch(`${API_URL}/projects/default/tasks`);
    const existingTasks = await existingRes.json();
    for (const task of existingTasks) {
      await fetch(`${API_URL}/tasks/${task.id}`, { method: 'DELETE' });
    }
  } catch (e) {}

  // Create fresh demo tasks
  const tasks = [
    { title: 'Design database schema', owner: 'backend', priority: 'P1', status: 'backlog' },
    { title: 'Set up CI/CD pipeline', owner: 'devops', priority: 'P2', status: 'backlog' },
    { title: 'Build user auth API', owner: 'backend', priority: 'P1', status: 'backlog' },
    { title: 'Create login form', owner: 'frontend', priority: 'P2', status: 'done' },
    { title: 'Write API docs', owner: 'pm', priority: 'P3', status: 'done' },
  ];

  for (const task of tasks) {
    try {
      await fetch(`${API_URL}/projects/default/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });
    } catch (e) {}
  }
}

async function recordDemo() {
  console.log('🎬 Recording full flow demo...\n');

  // Setup tasks
  await setupTasks();

  const taskId = Math.random().toString(36).substring(2, 8);

  // Smaller, friendlier size
  const WIDTH = 1280;
  const HEIGHT = 720;

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [`--window-size=${WIDTH},${HEIGHT}`, '--window-position=0,0']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  // Load page and prepare UI BEFORE recording
  console.log('Preparing scene...');
  await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle0' });
  await sleep(500);

  // Add title overlay before recording starts
  await page.evaluate(() => {
    const title = document.createElement('div');
    title.id = 'demo-title';
    title.innerHTML = `<div style="position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#ffffff;border:1px solid #e2e8f0;color:#0f172a;padding:10px 20px;border-radius:10px;font-family:-apple-system,sans-serif;font-size:14px;font-weight:600;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.08);display:flex;align-items:center;gap:8px;">
      <svg viewBox="0 0 32 32" style="width:20px;height:20px;">
        <circle cx="16" cy="16" r="5" fill="#3b82f6"/>
        <circle cx="6" cy="10" r="3" fill="#0891b2"/>
        <circle cx="26" cy="10" r="3" fill="#0891b2"/>
        <circle cx="6" cy="24" r="3" fill="#10b981"/>
        <circle cx="26" cy="24" r="3" fill="#10b981"/>
        <path d="M9 11L12 14" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M23 11L20 14" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M9 23L12 19" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M23 23L20 19" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="16" cy="16" r="2" fill="white"/>
      </svg>
      Agentic
    </div>`;
    document.body.appendChild(title);
  });
  await sleep(300);

  // NOW start recording with clean slate
  const recorder = new PuppeteerScreenRecorder(page, {
    followNewTab: true,
    fps: 30,
    videoFrame: { width: WIDTH, height: HEIGHT },
  });

  const videoPath = './demo/demo-full-flow.mp4';
  await recorder.start(videoPath);
  console.log('📹 Recording started...');

  try {
    // Scene 1: Show dashboard with tasks (already loaded and ready)
    console.log('Scene 1: Dashboard with tasks');
    await sleep(1500);

    // Scene 1.5: Click on backend agent to show details
    console.log('Scene 1.5: Show agent details');

    // Highlight the backend agent in sidebar
    await page.evaluate(() => {
      const agents = document.querySelectorAll('.agent-item');
      agents.forEach((agent) => {
        if (agent.textContent?.includes('backend')) {
          (agent as HTMLElement).style.boxShadow = '0 0 0 2px #3b82f6';
          (agent as HTMLElement).style.background = 'rgba(59, 130, 246, 0.1)';
        }
      });
    });
    await sleep(800);

    // Click to open agent modal
    await page.evaluate(() => {
      // @ts-ignore
      if (typeof openAgentModal === 'function') openAgentModal('backend');
    });
    await sleep(2500);

    // Close agent modal
    await page.evaluate(() => {
      // @ts-ignore
      if (typeof closeAgentModal === 'function') closeAgentModal();
    });
    await sleep(500);

    // Reset agent highlight
    await page.evaluate(() => {
      const agents = document.querySelectorAll('.agent-item');
      agents.forEach((agent) => {
        (agent as HTMLElement).style.boxShadow = '';
        (agent as HTMLElement).style.background = '';
      });
    });
    await sleep(500);

    // Scene 2: Highlight a task and move it to ready
    console.log('Scene 2: Move task to Ready');

    // Get tasks and find one to move
    const tasksRes = await fetch(`${API_URL}/projects/default/tasks`);
    const tasks = await tasksRes.json();
    const backlogTask = tasks.find((t: any) => t.status === 'backlog' && t.title.includes('auth'));

    // Highlight the task card in backlog before moving
    await page.evaluate(() => {
      // Find the auth task card in the backlog column
      const cards = document.querySelectorAll('[class*="card"], [class*="task"]');
      cards.forEach((card) => {
        if (card.textContent?.includes('auth')) {
          (card as HTMLElement).style.boxShadow = '0 0 0 3px #fbbf24, 0 8px 24px rgba(251,191,36,0.4)';
          (card as HTMLElement).style.transform = 'scale(1.02)';
          (card as HTMLElement).style.transition = 'all 0.3s ease';
        }
      });
    });
    await sleep(1500);

    // Add action indicator showing "dragging"
    await page.evaluate(() => {
      const indicator = document.createElement('div');
      indicator.id = 'action-indicator';
      indicator.innerHTML = `<div style="position:fixed;bottom:20px;left:20px;background:#1e1e1e;border-radius:8px;padding:14px 18px;font-family:Monaco,monospace;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:10000;min-width:450px;">
        <div style="color:#fbbf24;">📋 Moving "Build user auth API" to Ready...</div>
      </div>`;
      document.body.appendChild(indicator);
    });
    await sleep(1000);

    // Animate the card fading out
    await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="card"], [class*="task"]');
      cards.forEach((card) => {
        if (card.textContent?.includes('auth')) {
          (card as HTMLElement).style.opacity = '0.3';
          (card as HTMLElement).style.transform = 'scale(0.95) translateX(100px)';
        }
      });
    });
    await sleep(600);

    // Move task to ready via API
    if (backlogTask) {
      await fetch(`${API_URL}/tasks/${backlogTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ready' }),
      });
    }

    // Refresh to show updated board
    await page.reload({ waitUntil: 'networkidle0' });

    // Highlight the moved task in Ready column
    await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="card"], [class*="task"]');
      cards.forEach((card) => {
        if (card.textContent?.includes('auth')) {
          (card as HTMLElement).style.boxShadow = '0 0 0 3px #4ade80, 0 8px 24px rgba(74,222,128,0.4)';
          (card as HTMLElement).style.transition = 'all 0.3s ease';
        }
      });
    });

    // Update indicator to show success
    await page.evaluate(() => {
      const indicator = document.getElementById('action-indicator');
      if (indicator) {
        indicator.innerHTML = `<div style="position:fixed;bottom:20px;left:20px;background:#1e1e1e;border-radius:8px;padding:14px 18px;font-family:Monaco,monospace;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:10000;min-width:450px;">
          <div style="color:#4ade80;">✓ Task moved to Ready column</div>
        </div>`;
      }
    });
    await sleep(2000);

    // Scene 3: Agent picks up task
    console.log('Scene 3: Agent picks up task');

    await page.evaluate(() => {
      const indicator = document.getElementById('action-indicator') || document.createElement('div');
      indicator.id = 'action-indicator';
      indicator.innerHTML = `<div style="position:fixed;bottom:20px;left:20px;background:#1e1e1e;border-radius:8px;padding:14px 18px;font-family:Monaco,monospace;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:10000;min-width:450px;">
        <div style="color:#4ade80;">✓ Task moved to Ready</div>
        <div style="color:#60a5fa;margin-top:6px;">🤖 Backend agent picking up task...</div>
      </div>`;
      document.body.appendChild(indicator);
    });
    await sleep(1500);

    // Create real Slack channel
    console.log('Creating Slack channel...');
    const channelId = await createSlackChannel(taskId);
    if (!channelId) {
      console.error('Failed to create Slack channel');
      return;
    }
    console.log(`Channel created: ${channelId}`);

    // Post initial message to Slack
    await postToSlack(channelId, `Hey <@${DEAN_USER_ID}>! 👋

🤖 *Agent backend* is starting work on this task

*Task:* Build user auth API
*Task ID:* \`${taskId}\`
*Status:* In Progress
*Requested by:* <@${DEAN_USER_ID}>

---
I'll keep you updated on progress here!`);

    // Move task to in_progress
    if (backlogTask) {
      await fetch(`${API_URL}/tasks/${backlogTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      });
    }

    // Update indicator
    await page.evaluate((tid: string) => {
      const indicator = document.getElementById('action-indicator');
      if (indicator) {
        indicator.innerHTML = `<div style="position:fixed;bottom:20px;left:20px;background:#1e1e1e;border-radius:8px;padding:14px 18px;font-family:Monaco,monospace;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:10000;min-width:450px;">
          <div style="color:#4ade80;">✓ Agent started</div>
          <div style="color:#4ade80;">✓ Slack channel created: #task-backend-${tid}</div>
          <div style="color:#fbbf24;margin-top:6px;">📨 You've been tagged in Slack!</div>
        </div>`;
      }
    }, taskId);

    // Refresh to show task in progress
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(2000);

    // Scene 4: Show Slack conversation
    console.log('Scene 4: Slack conversation');

    // Add Slack panel (light theme)
    await page.evaluate((tid: string) => {
      // Remove old indicator
      document.getElementById('action-indicator')?.remove();

      const slack = document.createElement('div');
      slack.id = 'slack-panel';
      slack.innerHTML = `<div style="position:fixed;top:50px;right:15px;width:400px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;font-family:-apple-system,sans-serif;color:#0f172a;box-shadow:0 10px 40px rgba(0,0,0,0.12);z-index:10000;overflow:hidden;">
        <div style="background:#f8fafc;padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e2e8f0;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#E01E5A"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>
          <span style="font-weight:600;font-size:14px;color:#0f172a;">#task-backend-${tid}</span>
          <span style="margin-left:auto;background:#10b981;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:600;color:white;">LIVE</span>
        </div>
        <div id="slack-msgs" style="padding:14px;min-height:280px;max-height:350px;overflow-y:auto;background:#ffffff;"></div>
        <div style="padding:12px 14px;border-top:1px solid #e2e8f0;background:#f8fafc;">
          <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;color:#94a3b8;font-size:13px;">Message #task-backend-${tid}</div>
        </div>
      </div>`;
      document.body.appendChild(slack);
    }, taskId);

    // Helper to add messages (light theme)
    const addSlackMsg = async (user: string, text: string, isBot: boolean) => {
      await page.evaluate((u: string, t: string, bot: boolean) => {
        const msgs = document.getElementById('slack-msgs');
        if (msgs) {
          const msg = document.createElement('div');
          msg.style.cssText = 'display:flex;margin-bottom:14px;';
          msg.innerHTML = `
            <div style="width:36px;height:36px;background:${bot ? '#eff6ff' : '#ecfdf5'};border:1px solid ${bot ? '#bfdbfe' : '#a7f3d0'};border-radius:8px;display:flex;align-items:center;justify-content:center;margin-right:10px;flex-shrink:0;font-size:16px;">${bot ? '🤖' : '👤'}</div>
            <div style="flex:1;">
              <div style="font-weight:600;color:${bot ? '#3b82f6' : '#0f172a'};font-size:13px;">${u} <span style="color:#94a3b8;font-weight:400;font-size:11px;">now</span></div>
              <div style="color:#475569;font-size:13px;margin-top:3px;line-height:1.5;">${t}</div>
            </div>
          `;
          msgs.appendChild(msg);
          msgs.scrollTop = msgs.scrollHeight;
        }
      }, user, text, isBot);
    };

    // Animate conversation
    await addSlackMsg('backend', `Hey <span style="color:#1d9bd1;">@dean</span>! 👋 Starting work on: Build user auth API`, true);
    await sleep(1200);

    await postToSlack(channelId, '🔄 Analyzing requirements...');
    await addSlackMsg('backend', '🔄 Analyzing requirements...', true);
    await sleep(1000);

    await postToSlack(channelId, '🔄 Implementing JWT authentication...');
    await addSlackMsg('backend', '🔄 Implementing JWT authentication...', true);
    await sleep(1200);

    // User message
    await addSlackMsg('dean', 'Can you add rate limiting to prevent brute force?', false);
    await sleep(1500);

    await postToSlack(channelId, '✅ Good idea! Adding rate limiting: 100 requests/min per IP');
    await addSlackMsg('backend', '✅ Good idea! Adding rate limiting: 100 req/min per IP', true);
    await sleep(1200);

    await postToSlack(channelId, '🔄 Adding password hashing with bcrypt...');
    await addSlackMsg('backend', '🔄 Adding password hashing with bcrypt...', true);
    await sleep(1000);

    // Completion
    await postToSlack(channelId, `✅ *Task Completed!*

*Summary:*
• JWT token generation
• Password hashing (bcrypt)
• Rate limiting (100 req/min)
• User model with validation

*Files:* \`auth.ts\`, \`user.ts\`, \`middleware/auth.ts\``);

    await addSlackMsg('backend', '✅ Task completed! PR ready for review.', true);
    await sleep(1500);

    // Move task to done
    if (backlogTask) {
      await fetch(`${API_URL}/tasks/${backlogTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      });
    }

    // Update Slack panel to show completed
    await page.evaluate(() => {
      const badge = document.querySelector('[style*="background:#2eb67d"]');
      if (badge) (badge as HTMLElement).innerHTML = '✓ DONE';
    });

    // Refresh dashboard
    await page.reload({ waitUntil: 'networkidle0' });

    // Re-add completed slack panel
    await page.evaluate((tid: string) => {
      const slack = document.createElement('div');
      slack.innerHTML = `<div style="position:fixed;top:50px;right:15px;width:400px;background:#1a1d21;border-radius:8px;font-family:-apple-system,sans-serif;color:#fff;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:10000;overflow:hidden;">
        <div style="background:#350d36;padding:10px 14px;display:flex;align-items:center;gap:8px;">
          <span style="font-weight:600;font-size:14px;">#task-backend-${tid}</span>
          <span style="margin-left:auto;background:#2eb67d;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">✓ DONE</span>
        </div>
        <div style="padding:14px;color:#aaa;font-size:13px;">
          <div style="color:#4ade80;font-weight:600;margin-bottom:8px;">✅ Task completed successfully!</div>
          <div>• JWT authentication</div>
          <div>• Rate limiting added</div>
          <div>• PR ready for review</div>
        </div>
      </div>`;
      document.body.appendChild(slack);
    }, taskId);
    await sleep(2500);

    // Scene 5: Final CTA (light theme)
    console.log('Scene 5: GitHub CTA');
    await page.evaluate(() => {
      document.querySelectorAll('[style*="position:fixed"]').forEach(el => el.remove());

      const cta = document.createElement('div');
      cta.innerHTML = `<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:10000;">
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;padding:48px 64px;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.15);">
          <svg viewBox="0 0 32 32" style="width:48px;height:48px;margin-bottom:16px;">
            <circle cx="16" cy="16" r="5" fill="#3b82f6"/>
            <circle cx="6" cy="10" r="3" fill="#0891b2"/>
            <circle cx="26" cy="10" r="3" fill="#0891b2"/>
            <circle cx="6" cy="24" r="3" fill="#10b981"/>
            <circle cx="26" cy="24" r="3" fill="#10b981"/>
            <path d="M9 11L12 14" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M23 11L20 14" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M9 23L12 19" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M23 23L20 19" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="16" cy="16" r="2" fill="white"/>
          </svg>
          <div style="font-size:28px;font-weight:700;color:#0f172a;margin-bottom:8px;font-family:-apple-system,sans-serif;">Agentic</div>
          <div style="font-size:15px;color:#3b82f6;margin-bottom:16px;font-family:-apple-system,sans-serif;">github.com/0xtechdean/agentic</div>
          <div style="font-size:13px;color:#64748b;font-family:-apple-system,sans-serif;">MIT Licensed • TypeScript • Real Slack Integration</div>
        </div>
      </div>`;
      document.body.appendChild(cta);
    });
    await sleep(2500);

  } catch (error) {
    console.error('Error:', error);
  }

  await recorder.stop();
  console.log(`\n✅ Recording saved: ${videoPath}`);
  await browser.close();

  // Convert to GIF - friendlier 800px width
  console.log('🎨 Converting to GIF...');
  const { execSync } = await import('child_process');
  try {
    execSync(`ffmpeg -y -i ${videoPath} -vf "fps=10,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 ./demo/demo.gif`, {
      stdio: 'inherit'
    });
    const { statSync } = await import('fs');
    const stats = statSync('./demo/demo.gif');
    console.log(`✅ GIF created: ./demo/demo.gif (${(stats.size / 1024).toFixed(0)}KB)`);
  } catch (e) {
    console.log('GIF conversion failed, MP4 available');
  }

  console.log(`\n📢 Real Slack channel: #task-backend-${taskId}`);
}

recordDemo().catch(console.error);
