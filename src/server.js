const express = require('express');
const path = require('path');
const taskManager = require('./automation/taskManager');
const { runAutomation } = require('./automation/browser');

const app = express();
app.use((req, res, next) => {
  if (req.path === '/messages') return next();
  express.json()(req, res, next);
});
app.use((req, res, next) => {
  if (req.path === '/messages') return next();
  express.urlencoded({ extended: true })(req, res, next);
});

// Serve static pages
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint for Kakao Cloud Load Balancer
app.get('/', (req, res) => {
  res.status(200).send('Honeybee MCP Server is running!');
});
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Store port
let serverPort = 3000;

// KakaoTalk Bot Webhook (R1)
app.post('/api/kakao/webhook', (req, res) => {
  const { userRequest } = req.body || {};
  if (!userRequest || !userRequest.utterance || !userRequest.user || !userRequest.user.id) {
    return res.status(400).json({ error: 'Invalid webhook request structure' });
  }

  const { utterance, user } = userRequest;
  if (utterance !== '승인') {
    return res.status(400).json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: {
              text: '지원하지 않는 발화입니다. "승인"을 입력해주세요.'
            }
          }
        ]
      }
    });
  }

  // Create a new automation task
  const taskId = `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const formData = {
    name: '홍길동',
    email: `${user.id}@example.com`,
    amount: 10000000
  };

  // Cancel any existing active tasks for the same user to handle re-approval cancellation
  const userEmail = `${user.id}@example.com`;
  for (const t of taskManager.tasks.values()) {
    if (t.formData && t.formData.email === userEmail && (t.status === 'RUNNING' || t.status === 'PAUSED_SECURITY')) {
      taskManager.cancelTask(t.taskId, 'Cancelled by new re-approval request');
    }
  }

  taskManager.createTask(taskId, formData);

  // Trigger automation asynchronously
  runAutomation(taskId, serverPort).catch(err => {
    console.error('Automation error:', err);
  });

  return res.json({
    version: '2.0',
    template: {
      outputs: [
        {
          simpleText: {
            text: `대출 자동 신청을 시작합니다. (작업 ID: ${taskId}). 보안 확인 단계가 발생하면 추가 안내를 드리겠습니다.`
          }
        }
      ]
    }
  });
});

// Automation Resume API (R3)
app.post('/api/automation/resume', (req, res) => {
  const { taskId, captchaCode } = req.body || {};
  if (!taskId || !captchaCode) {
    return res.status(400).json({ success: false, error: 'Missing taskId or captchaCode' });
  }

  const task = taskManager.getTask(taskId);
  if (!task) {
    return res.status(404).json({ success: false, error: `Task ${taskId} not found` });
  }

  if (task.status !== 'PAUSED_SECURITY') {
    return res.status(400).json({ success: false, error: `Task ${taskId} is not in PAUSED_SECURITY status (current status: ${task.status})` });
  }

  // Resume the task manager
  const result = taskManager.resumeTask(taskId, captchaCode);
  if (!result.success) {
    return res.status(400).json(result);
  }

  return res.json(result);
});

// Automation Cancel API (Internal/Test tool)
app.post('/api/automation/cancel', (req, res) => {
  const { taskId, reason } = req.body || {};
  if (!taskId) {
    return res.status(400).json({ success: false, error: 'Missing taskId' });
  }
  const result = taskManager.cancelTask(taskId, reason || 'Cancelled by client request');
  if (!result.success) {
    return res.status(result.error.includes('not found') ? 404 : 400).json(result);
  }
  return res.json(result);
});

// Task Status Monitoring Endpoint (Internal)
app.get('/api/automation/status/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = taskManager.getTask(taskId);
  if (!task) {
    return res.status(404).json({ error: `Task ${taskId} not found` });
  }

  return res.json({
    taskId: task.taskId,
    status: task.status,
    currentUrl: task.currentUrl,
    error: task.error
  });
});

// Captcha fetching endpoint for secure page
app.get('/api/automation/captcha/:taskId', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer mock-secret-token-123') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { taskId } = req.params;
  const task = taskManager.getTask(taskId);
  if (!task) {
    return res.status(404).json({ error: `Task ${taskId} not found` });
  }
  return res.json({ captcha: task.correctCaptcha });
});

// Form submission handler
app.post('/api/submit-form', (req, res) => {
  const { taskId, name, email, amount } = req.body;
  if (!taskId) {
    return res.status(400).send('Missing taskId');
  }
  const task = taskManager.getTask(taskId);
  if (!task) {
    return res.status(404).send('Task not found');
  }

  if (task.status === 'COMPLETED' || task.status === 'FAILED') {
    return res.status(400).send(`Cannot submit form for task in terminal state: ${task.status}`);
  }

  // Validate form fields for boundary testing
  if (!name || name.trim().length === 0) {
    taskManager.updateTask(taskId, { status: 'FAILED', error: 'Validation failed: Name is empty' });
    return res.status(400).send('Name is required');
  }
  if (!email || !email.includes('@')) {
    taskManager.updateTask(taskId, { status: 'FAILED', error: 'Validation failed: Invalid email' });
    return res.status(400).send('Invalid email');
  }
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) {
    taskManager.updateTask(taskId, { status: 'FAILED', error: 'Validation failed: Amount must be positive' });
    return res.status(400).send('Amount must be greater than zero');
  }

  // Update in-memory form data
  task.formData = { name, email, amount: amt };

  // Redirect to secure captcha page
  return res.redirect(`/secure.html?taskId=${taskId}`);
});

// Captcha verification handler
app.post('/api/submit-captcha', (req, res) => {
  const { taskId, captcha } = req.body;
  if (!taskId) {
    return res.status(400).send('Missing taskId');
  }
  const task = taskManager.getTask(taskId);
  if (!task) {
    return res.status(404).send('Task not found');
  }

  if (captcha !== task.correctCaptcha) {
    // Keep it paused but indicate failure in logs or response
    return res.status(400).send('Invalid captcha code');
  }

  return res.redirect(`/success.html?taskId=${taskId}`);
});

// Helper endpoint to register task for testing from test code
app.post('/api/test/create-task', (req, res) => {
  const { taskId, formData } = req.body;
  const task = taskManager.createTask(taskId, formData || {});
  return res.json(task);
});

// Start server function so we can export it or run directly
function startServer(port) {
  serverPort = port || 8080;
  return new Promise((resolve) => {
    // Bind to 0.0.0.0 to ensure it accepts external connections in Docker/Cloud
    const server = app.listen(serverPort, '0.0.0.0', () => {
      resolve(server);
    });
  });
}

if (require.main === module) {
  const port = process.env.PORT || 8080;
  startServer(port).then(() => {
    console.log(`Mock server running on port ${port} (0.0.0.0)`);
  });
}

module.exports = { app, startServer };
