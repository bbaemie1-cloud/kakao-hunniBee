const { describe, test } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

describe('Feature 1: Webhook', () => {
  test('returns 200 OK and valid JSON response for valid "승인" utterance', async () => {
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: 'mock-user-12345' }
        }
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data);
  });

  test('response has version 2.0', async () => {
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: 'mock-user-12345' }
        }
      })
    });
    const data = await res.json();
    assert.strictEqual(data.version, '2.0');
  });

  test('response template structure matches Kakao Link format (outputs simpleText)', async () => {
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: 'mock-user-12345' }
        }
      })
    });
    const data = await res.json();
    assert.ok(data.template);
    assert.ok(Array.isArray(data.template.outputs));
    assert.ok(data.template.outputs[0].simpleText);
    assert.ok(data.template.outputs[0].simpleText.text);
  });

  test('response contains the generated Task ID in the text', async () => {
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: 'mock-user-12345' }
        }
      })
    });
    const data = await res.json();
    const text = data.template.outputs[0].simpleText.text;
    assert.ok(text.includes('작업 ID: task-'));
  });

  test('rejects unsupported utterance with 400 and a friendly message', async () => {
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '거절',
          user: { id: 'mock-user-12345' }
        }
      })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    const text = data.template.outputs[0].simpleText.text;
    assert.ok(text.includes('지원하지 않는 발화입니다'));
  });
});

describe('Feature 2: Playwright Flow', () => {
  test('navigating directly to form.html opens the page', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${BASE_URL}/form.html`);
      const heading = await page.textContent('h1');
      assert.strictEqual(heading, 'Youth Loan Application Form');
    } finally {
      await browser.close();
    }
  });

  test('filling out the form and clicking submit navigates to secure.html', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const taskId = `test-form-${Date.now()}`;
      await fetch(`${BASE_URL}/api/test/create-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, formData: {} })
      });

      await page.goto(`${BASE_URL}/form.html?taskId=${taskId}`);
      await page.fill('#name', 'Jane Doe');
      await page.fill('#email', 'jane@example.com');
      await page.fill('#amount', '5000000');
      
      await Promise.all([
        page.click('#submit-btn'),
        page.waitForNavigation()
      ]);

      const url = page.url();
      assert.ok(url.includes('secure.html'));
      assert.ok(url.includes(`taskId=${taskId}`));
    } finally {
      await browser.close();
    }
  });

  test('the page title and key elements exist on the form page', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${BASE_URL}/form.html`);
      
      const nameInput = await page.$('#name');
      const emailInput = await page.$('#email');
      const amountInput = await page.$('#amount');
      const submitBtn = await page.$('#submit-btn');

      assert.ok(nameInput);
      assert.ok(emailInput);
      assert.ok(amountInput);
      assert.ok(submitBtn);
    } finally {
      await browser.close();
    }
  });

  test('form input fields are required and validated by the browser', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${BASE_URL}/form.html`);

      const nameRequired = await page.getAttribute('#name', 'required');
      const emailRequired = await page.getAttribute('#email', 'required');
      const amountRequired = await page.getAttribute('#amount', 'required');

      assert.strictEqual(nameRequired, '');
      assert.strictEqual(emailRequired, '');
      assert.strictEqual(amountRequired, '');
    } finally {
      await browser.close();
    }
  });

  test('the automation flow correctly triggers and navigates through the pages', async () => {
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: 'mock-user-12345' }
        }
      })
    });
    const data = await res.json();
    const text = data.template.outputs[0].simpleText.text;
    const match = text.match(/작업 ID:\s*(task-[^\s)]+)/);
    assert.ok(match, 'Task ID should be present in response');
    const taskId = match[1];

    let status = 'RUNNING';
    let attempts = 0;
    while (status === 'RUNNING' && attempts < 20) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const statusRes = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
      const statusData = await statusRes.json();
      status = statusData.status;
      attempts++;
    }

    assert.strictEqual(status, 'PAUSED_SECURITY');
  });
});

describe('Feature 3: Pause/Resume', () => {
  test('status endpoint returns 404 for non-existent tasks', async () => {
    const res = await fetch(`${BASE_URL}/api/automation/status/invalid-task-id`);
    assert.strictEqual(res.status, 404);
  });

  test('an active task enters PAUSED_SECURITY when reaching secure.html', async () => {
    const taskId = `test-pause-${Date.now()}`;
    await fetch(`${BASE_URL}/api/test/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, formData: { name: 'Alice', email: 'alice@example.com', amount: 20000000 } })
    });

    const { runAutomation } = require('../src/automation/browser');
    runAutomation(taskId, PORT).catch(() => {});

    let status = 'RUNNING';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const res = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
      const data = await res.json();
      status = data.status;
      if (status === 'PAUSED_SECURITY') break;
    }
    assert.strictEqual(status, 'PAUSED_SECURITY');
  });

  test('status endpoint returns correct currentUrl while paused', async () => {
    const taskId = `test-status-${Date.now()}`;
    await fetch(`${BASE_URL}/api/test/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, formData: { name: 'Bob', email: 'bob@example.com', amount: 30000000 } })
    });

    const { runAutomation } = require('../src/automation/browser');
    runAutomation(taskId, PORT).catch(() => {});

    let data;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const res = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
      data = await res.json();
      if (data.status === 'PAUSED_SECURITY') break;
    }
    assert.strictEqual(data.status, 'PAUSED_SECURITY');
    assert.ok(data.currentUrl.includes('secure.html'));
  });

  test('resuming with the correct captcha code transitions the task to COMPLETED', async () => {
    const taskId = `test-resume-success-${Date.now()}`;
    await fetch(`${BASE_URL}/api/test/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, formData: { name: 'Charlie', email: 'charlie@example.com', amount: 40000000 } })
    });

    const { runAutomation } = require('../src/automation/browser');
    runAutomation(taskId, PORT).catch(() => {});

    // Wait until paused
    let captchaCode = '';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const res = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
      const data = await res.json();
      if (data.status === 'PAUSED_SECURITY') {
        const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`, {
          headers: {
            'Authorization': 'Bearer mock-secret-token-123'
          }
        });
        const capData = await capRes.json();
        captchaCode = capData.captcha;
        break;
      }
    }

    // Resume
    const resumeRes = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, captchaCode })
    });
    assert.strictEqual(resumeRes.status, 200);
    const resumeData = await resumeRes.json();
    assert.strictEqual(resumeData.success, true);

    // Wait until completed
    let finalStatus = 'RUNNING';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const res = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
      const data = await res.json();
      finalStatus = data.status;
      if (finalStatus === 'COMPLETED') break;
    }
    assert.strictEqual(finalStatus, 'COMPLETED');
  });

  test('resuming with wrong captcha code rejects the resume with 400', async () => {
    const taskId = `test-resume-wrong-${Date.now()}`;
    await fetch(`${BASE_URL}/api/test/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, formData: { name: 'David', email: 'david@example.com', amount: 50000000 } })
    });

    const { runAutomation } = require('../src/automation/browser');
    runAutomation(taskId, PORT).catch(() => {});

    // Wait until paused
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const res = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
      const data = await res.json();
      if (data.status === 'PAUSED_SECURITY') break;
    }

    // Resume with wrong captcha
    const resumeRes = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, captchaCode: 'wrong-code' })
    });
    assert.strictEqual(resumeRes.status, 400);
    const resumeData = await resumeRes.json();
    assert.strictEqual(resumeData.success, false);
    assert.ok(resumeData.error.includes('Invalid captcha'));
  });
});
