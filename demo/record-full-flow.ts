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
  // Clear and create fresh tasks
  const tasks = [
    { title: 'Design database schema', owner: 'backend', priority: 'P1', status: 'done' },
    { title: 'Set up CI/CD pipeline', owner: 'backend', priority: 'P2', status: 'done' },
    { title: 'Build user auth API', owner: 'backend', priority: 'P1', status: 'backlog' },
    { title: 'Create login form', owner: 'frontend', priority: 'P2', status: 'backlog' },
    { title: 'Write API docs', owner: 'pm', priority: 'P3', status: 'backlog' },
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

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1500,900', '--window-position=0,0']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 900 });

  const recorder = new PuppeteerScreenRecorder(page, {
    followNewTab: true,
    fps: 30,
    videoFrame: { width: 1500, height: 900 },
  });

  const videoPath = './demo/demo-full-flow.mp4';
  await recorder.start(videoPath);
  console.log('📹 Recording started...');

  try {
    // Scene 1: Show dashboard with tasks
    console.log('Scene 1: Dashboard with tasks');
    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle0' });
    await sleep(2000);

    // Add title
    await page.evaluate(() => {
      const title = document.createElement('div');
      title.id = 'demo-title';
      title.innerHTML = `<div style="position:fixed;top:15px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:white;padding:10px 20px;border-radius:8px;font-family:-apple-system,sans-serif;font-size:16px;font-weight:600;z-index:10000;">
        🤖 AI Team Orchestrator
      </div>`;
      document.body.appendChild(title);
    });
    await sleep(2500);

    // Scene 2: Highlight a task and move it to ready
    console.log('Scene 2: Move task to Ready');

    // Get tasks and find one to move
    const tasksRes = await fetch(`${API_URL}/projects/default/tasks`);
    const tasks = await tasksRes.json();
    const backlogTask = tasks.find((t: any) => t.status === 'backlog' && t.title.includes('auth'));

    // Add action indicator
    await page.evaluate(() => {
      const indicator = document.createElement('div');
      indicator.id = 'action-indicator';
      indicator.innerHTML = `<div style="position:fixed;bottom:20px;left:20px;background:#1e1e1e;border-radius:8px;padding:14px 18px;font-family:Monaco,monospace;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:10000;min-width:450px;">
        <div style="color:#fbbf24;">📋 Moving task to Ready...</div>
      </div>`;
      document.body.appendChild(indicator);
    });
    await sleep(1500);

    // Move task to ready
    if (backlogTask) {
      await fetch(`${API_URL}/tasks/${backlogTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ready' }),
      });
    }

    // Refresh to show updated board
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(1500);

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

    // Add Slack panel
    await page.evaluate((tid: string) => {
      // Remove old indicator
      document.getElementById('action-indicator')?.remove();

      const slack = document.createElement('div');
      slack.id = 'slack-panel';
      slack.innerHTML = `<div style="position:fixed;top:50px;right:15px;width:400px;background:#1a1d21;border-radius:8px;font-family:-apple-system,sans-serif;color:#fff;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:10000;overflow:hidden;">
        <div style="background:#350d36;padding:10px 14px;display:flex;align-items:center;gap:8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>
          <span style="font-weight:600;font-size:14px;">#task-backend-${tid}</span>
          <span style="margin-left:auto;background:#2eb67d;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">LIVE</span>
        </div>
        <div id="slack-msgs" style="padding:12px;min-height:280px;max-height:350px;overflow-y:auto;"></div>
        <div style="padding:10px 12px;border-top:1px solid #333;background:#222;">
          <div style="background:#333;border-radius:4px;padding:8px 10px;color:#666;font-size:13px;">Message #task-backend-${tid}</div>
        </div>
      </div>`;
      document.body.appendChild(slack);
    }, taskId);

    // Helper to add messages
    const addSlackMsg = async (user: string, text: string, isBot: boolean) => {
      await page.evaluate((u: string, t: string, bot: boolean) => {
        const msgs = document.getElementById('slack-msgs');
        if (msgs) {
          const msg = document.createElement('div');
          msg.style.cssText = 'display:flex;margin-bottom:12px;';
          msg.innerHTML = `
            <div style="width:32px;height:32px;background:${bot ? '#4a154b' : '#2eb67d'};border-radius:4px;display:flex;align-items:center;justify-content:center;margin-right:8px;flex-shrink:0;font-size:14px;">${bot ? '🤖' : '👤'}</div>
            <div style="flex:1;">
              <div style="font-weight:600;color:${bot ? '#1d9bd1' : '#fff'};font-size:13px;">${u} <span style="color:#616061;font-weight:400;font-size:11px;">now</span></div>
              <div style="color:#d1d2d3;font-size:13px;margin-top:2px;line-height:1.4;">${t}</div>
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

    // Scene 5: Final CTA
    console.log('Scene 5: GitHub CTA');
    await page.evaluate(() => {
      document.querySelectorAll('[style*="position:fixed"]').forEach(el => el.remove());

      const cta = document.createElement('div');
      cta.innerHTML = `<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;z-index:10000;">
        <div style="background:linear-gradient(135deg,#1e1e1e 0%,#2d2d2d 100%);border-radius:16px;padding:40px 56px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
          <div style="font-size:56px;margin-bottom:16px;">🤖</div>
          <div style="font-size:26px;font-weight:700;color:#fff;margin-bottom:10px;font-family:-apple-system,sans-serif;">AI Team Orchestrator</div>
          <div style="font-size:16px;color:#60a5fa;margin-bottom:16px;font-family:-apple-system,sans-serif;">github.com/0xtechdean/ai-team-orchestrator</div>
          <div style="font-size:13px;color:#888;font-family:-apple-system,sans-serif;">MIT Licensed • TypeScript • Real Slack Integration</div>
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

  // Convert to GIF
  console.log('🎨 Converting to GIF...');
  const { execSync } = await import('child_process');
  try {
    execSync(`ffmpeg -y -i ${videoPath} -vf "fps=12,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 ./demo/demo.gif`, {
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
