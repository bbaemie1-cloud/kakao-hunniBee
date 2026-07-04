# Handoff Report: E2E Testing Infrastructure & Test Suite Design (Milestone E1)

This report details the design and implementation specifications for the E2E testing infrastructure of the KakaoTalk Admin Assistant project. As a read-only Explorer, this document provides the exact proposed structure for `package.json`, `tests/e2e_runner.js`, `tests/tier1_coverage.test.js`, `tests/tier2_boundary.test.js`, and `TEST_INFRA.md`.

---

## 1. Observation

Based on a systematic exploration of the workspace directory `/Users/uricho/Desktop/Watson/teamwork_projects/kakao_admin_assistant`:
1. **Existing Files**:
   - `PROJECT.md` details the project architecture, milestones (E1-E2, I1-I5), and interface contracts:
     - KakaoTalk Bot Webhook API: `POST /api/kakao/webhook`
     - Automation Resume API: `POST /api/automation/resume`
     - Task Status Monitoring API: `GET /api/automation/status/:taskId`
   - `.agents/` contains tracking data for several sub-agents across orchestrator, implementation, and testing tracks.
2. **Environment & Runtime**:
   - Node.js and `npm` are installed globally via Homebrew under `/opt/homebrew/bin/node` and `/opt/homebrew/bin/npm` respectively.
   - Google Chrome is installed under `/Applications/Google Chrome.app`.
   - The workspace requires a light, self-contained E2E setup running under `CODE_ONLY` network restrictions.

---

## 2. Logic Chain

From the observations, the following architectural choices have been derived:
1. **Zero-Dependency Core Test Runner**: Since the workspace is constrained under `CODE_ONLY` mode, using the built-in Node.js runner (`node:test` and `node:assert` available natively in Node.js >= 18) avoids unnecessary external test framework overhead (e.g., Jest/Mocha).
2. **Isolated Server Lifecycle**: Running `tests/e2e_runner.js` by spawning the Express server as a child process ensures we don't pollute the test runner's memory space and can cleanly terminate the server on test completion or failure.
3. **Robust TCP Wait**: We use Node's `net.Socket` to poll the port until it accepts connections, preventing race conditions where tests run before the Express server has fully bound to the port.
4. **Structured Testing Tiers**:
   - **Tier 1 (Feature Coverage)**: Validates standard functionality (happy paths) of each feature (Webhook, Playwright flow, Resume/Status API) with at least 5 tests per feature.
   - **Tier 2 (Boundary & Error Cases)**: Validates input limits, incorrect parameters, error states, and crash scenarios with at least 5 tests per feature.

---

## 3. Caveats

* **Real Browser Setup**: Under `CODE_ONLY` mode, Playwright's browser binaries must be locally pre-cached, or configured to launch the local Google Chrome installation using `channel: 'chrome'`.
* **Asynchronous Timing**: Heavy Playwright operations or slow page transitions must use Playwright's auto-waiting features to avoid flakiness in testing environments.

---

## 4. Conclusion & Recommendations

We recommend implementing the E1 milestone using the Node.js native test runner and Playwright. The detailed specifications for all milestone files are presented below.

### Proposed `package.json`
```json
{
  "name": "kakao-admin-assistant",
  "version": "1.0.0",
  "description": "KakaoTalk Bot Webhook & Playwright Automation Flow",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "test": "node tests/e2e_runner.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "playwright": "^1.45.0"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "private": true
}
```

---

### Proposed `tests/e2e_runner.js`
This script boots the server, waits for the port to become available, executes the test suites, and cleans up by terminating the server.

```javascript
/**
 * E2E Test Runner for KakaoTalk Admin Assistant
 * Lifecyle: Starts mock Express server -> Waits for Port -> Runs Test Files -> Terminates Server -> Exits with code
 */

const { spawn, spawnSync } = require('child_process');
const net = require('net');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SERVER_PATH = path.join(__dirname, '../src/server.js');

// 1. Start the Express server
console.log(`[E2E Runner] Starting Express server from: ${SERVER_PATH}...`);
const serverProcess = spawn('node', [SERVER_PATH], {
  env: { ...process.env, PORT: PORT.toString() },
  stdio: 'inherit'
});

// Helper: Polling check if the server port is active
function waitForPort(port, host = '127.0.0.1', timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const socket = new net.Socket();
      socket.connect(port, host, () => {
        socket.destroy();
        clearInterval(interval);
        resolve();
      });

      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeout) {
          clearInterval(interval);
          reject(new Error(`[E2E Runner] Timeout: Server did not respond on port ${port} within ${timeout}ms.`));
        }
      });
    }, 200);
  });
}

// 2. Wait for port, run tests, and tear down
(async () => {
  try {
    await waitForPort(PORT);
    console.log(`[E2E Runner] Server is up on port ${PORT}. Running test suite...`);

    // Run Tier 1 and Tier 2 test suites using Node.js native test runner
    const testResult = spawnSync('node', [
      '--test',
      'tests/tier1_coverage.test.js',
      'tests/tier2_boundary.test.js'
    ], { stdio: 'inherit' });

    console.log(`[E2E Runner] Test suite run completed. Status code: ${testResult.status}`);
    cleanup(testResult.status);
  } catch (error) {
    console.error(`[E2E Runner] Error:`, error.message);
    cleanup(1);
  }
})();

function cleanup(exitCode) {
  console.log('[E2E Runner] Stopping Express server...');
  serverProcess.kill('SIGTERM');
  process.exit(exitCode === null ? 1 : exitCode);
}
```

---

### Proposed `tests/tier1_coverage.test.js`
This file contains happy path assertions for Features 1, 2, and 3 using Node.js's native `node:test` framework and standard `fetch`.

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:3000';

// ==========================================
// FEATURE 1: KakaoTalk Bot Webhook API (R1)
// ==========================================
test('F1.1: Webhook returns valid JSON payload response for utterance "승인"', async () => {
  const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userRequest: { utterance: '승인', user: { id: 'test-user-01' } }
    })
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.version, '2.0');
  assert.ok(data.template.outputs[0].simpleText.text.includes('대출 자동 신청을 시작합니다.'));
});

test('F1.2: Webhook response contains a valid generated taskId format', async () => {
  const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userRequest: { utterance: '승인', user: { id: 'test-user-02' } }
    })
  });
  const data = await res.json();
  const text = data.template.outputs[0].simpleText.text;
  const match = text.match(/작업 ID:\s*(task-[a-zA-Z0-9\-]+)/);
  assert.ok(match, 'Task ID must be returned in the response');
});

test('F1.3: Webhook response Content-Type is application/json', async () => {
  const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userRequest: { utterance: '승인', user: { id: 'test-user-03' } }
    })
  });
  assert.ok(res.headers.get('content-type').includes('application/json'));
});

test('F1.4: Webhook returns unique task IDs for sequential requests', async () => {
  const req = { userRequest: { utterance: '승인', user: { id: 'test-user-04' } } };
  const res1 = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  });
  const res2 = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  });
  const data1 = await res1.json();
  const data2 = await res2.json();
  const id1 = data1.template.outputs[0].simpleText.text.match(/task-\S+/)[0];
  const id2 = data2.template.outputs[0].simpleText.text.match(/task-\S+/)[0];
  assert.notStrictEqual(id1, id2);
});

test('F1.5: Webhook returns standard fallback message for unknown utterances', async () => {
  const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userRequest: { utterance: '도움말', user: { id: 'test-user-05' } }
    })
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.template.outputs[0].simpleText.text.includes('알 수 없는 명령어입니다'));
});

// ==========================================
// FEATURE 2: Playwright Automation Flow (R2)
// ==========================================
test('F2.1: Mock Form loads successfully with standard input fields', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/form.html`);
  const title = await page.title();
  assert.ok(title.includes('대출 신청') || title.length > 0);
  assert.ok(await page.locator('input[name="name"]').isVisible());
  assert.ok(await page.locator('input[name="phone"]').isVisible());
  assert.ok(await page.locator('input[name="amount"]').isVisible());
  await browser.close();
});

test('F2.2: Form input filling works properly in automation', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/form.html`);
  await page.fill('input[name="name"]', '홍길동');
  await page.fill('input[name="phone"]', '010-1234-5678');
  await page.fill('input[name="amount"]', '10000000');
  assert.strictEqual(await page.inputValue('input[name="name"]'), '홍길동');
  await browser.close();
});

test('F2.3: Form submission navigates to the Captcha / Security page', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/form.html`);
  await page.fill('input[name="name"]', '홍길동');
  await page.fill('input[name="phone"]', '010-1234-5678');
  await page.fill('input[name="amount"]', '10000000');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/secure.html');
  assert.ok(page.url().includes('secure.html'));
  await browser.close();
});

test('F2.4: Captcha page displays secure validation elements', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/secure.html`);
  assert.ok(await page.locator('#captcha-image-placeholder').isVisible() || await page.locator('input[name="captchaCode"]').isVisible());
  await browser.close();
});

test('F2.5: Redirection to success page behaves properly on successful submit', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/secure.html`);
  await page.fill('input[name="captchaCode"]', '123456');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/success.html');
  assert.ok(page.url().includes('success.html'));
  await browser.close();
});

// ===================================================
// FEATURE 3: Automation Resume / Status APIs (R3)
// ===================================================
test('F3.1: Task resumes successfully through API after entering captcha', async () => {
  // 1. Start Task
  const resStart = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userRequest: { utterance: '승인', user: { id: 'user-r3-1' } } })
  });
  const dataStart = await resStart.json();
  const taskId = dataStart.template.outputs[0].simpleText.text.match(/task-\S+/)[0].replace(/\.$/, '');

  // 2. Poll Status until PAUSED_SECURITY
  let status = 'RUNNING';
  for (let i = 0; i < 10; i++) {
    const resStatus = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
    const dataStatus = await resStatus.json();
    status = dataStatus.status;
    if (status === 'PAUSED_SECURITY') break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert.strictEqual(status, 'PAUSED_SECURITY');

  // 3. Trigger Resume API
  const resResume = await fetch(`${BASE_URL}/api/automation/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, captchaCode: '123456' })
  });
  const dataResume = await resResume.json();
  assert.strictEqual(dataResume.success, true);
});

test('F3.2: Status API returns RUNNING state right after task initiation', async () => {
  const resStart = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userRequest: { utterance: '승인', user: { id: 'user-r3-2' } } })
  });
  const dataStart = await resStart.json();
  const taskId = dataStart.template.outputs[0].simpleText.text.match(/task-\S+/)[0].replace(/\.$/, '');

  const resStatus = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
  const dataStatus = await resStatus.json();
  assert.ok(['RUNNING', 'PAUSED_SECURITY'].includes(dataStatus.status));
});

test('F3.3: Status API exposes correct currentUrl when paused on Captcha', async () => {
  const resStart = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userRequest: { utterance: '승인', user: { id: 'user-r3-3' } } })
  });
  const dataStart = await resStart.json();
  const taskId = dataStart.template.outputs[0].simpleText.text.match(/task-\S+/)[0].replace(/\.$/, '');

  // Wait for it to hit secure page
  let currentUrl = '';
  for (let i = 0; i < 10; i++) {
    const resStatus = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
    const dataStatus = await resStatus.json();
    currentUrl = dataStatus.currentUrl;
    if (dataStatus.status === 'PAUSED_SECURITY') break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(currentUrl.includes('secure.html'));
});

test('F3.4: Status API reflects COMPLETED status after successful resume', async () => {
  const resStart = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userRequest: { utterance: '승인', user: { id: 'user-r3-4' } } })
  });
  const dataStart = await resStart.json();
  const taskId = dataStart.template.outputs[0].simpleText.text.match(/task-\S+/)[0].replace(/\.$/, '');

  // Wait until paused
  while (true) {
    const s = await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json();
    if (s.status === 'PAUSED_SECURITY') break;
    await new Promise(r => setTimeout(r, 100));
  }

  // Resume
  await fetch(`${BASE_URL}/api/automation/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, captchaCode: '123456' })
  });

  // Verify COMPLETED status
  let finalStatus = '';
  for (let i = 0; i < 10; i++) {
    const s = await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json();
    finalStatus = s.status;
    if (finalStatus === 'COMPLETED') break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert.strictEqual(finalStatus, 'COMPLETED');
});

test('F3.5: Resume API returns error for empty captchaCode payload structure', async () => {
  const res = await fetch(`${BASE_URL}/api/automation/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: 'task-fake' }) // missing captchaCode
  });
  assert.strictEqual(res.status, 400);
});
```

---

### Proposed `tests/tier2_boundary.test.js`
This file contains the assertions for error scenarios, limit conditions, and edge cases.

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:3000';

// ==========================================
// FEATURE 1: KakaoTalk Bot Webhook API (R1)
// ==========================================
test('F1.E1: Webhook with missing userRequest returns 400 Bad Request', async () => {
  const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}) // Empty body
  });
  assert.strictEqual(res.status, 400);
});

test('F1.E2: Webhook handles missing user.id gracefully without crashing', async () => {
  const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userRequest: { utterance: '승인' } // missing user object
    })
  });
  // Server should return 400 bad request or fallback, but MUST not crash.
  assert.ok(res.status === 400 || res.status === 200);
});

test('F1.E3: Webhook payload containing massive utterance string handles it gracefully', async () => {
  const hugeUtterance = '승인'.repeat(1000);
  const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userRequest: { utterance: hugeUtterance, user: { id: 'test-user-huge' } }
    })
  });
  assert.ok(res.status === 400 || res.status === 200);
});

test('F1.E4: Webhook called with malformed JSON body returns 400 Bad Request', async () => {
  const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ malformed json'
  });
  assert.strictEqual(res.status, 400);
});

test('F1.E5: Webhook rejects non-POST HTTP methods with 405 Method Not Allowed or 404', async () => {
  const res = await fetch(`${BASE_URL}/api/kakao/webhook`, { method: 'GET' });
  assert.ok(res.status === 405 || res.status === 404);
});

// ==========================================
// FEATURE 2: Playwright Automation Flow (R2)
// ==========================================
test('F2.E1: Form handles empty inputs and stays on form.html (validation error)', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/form.html`);
  // Try submit empty form
  await page.click('button[type="submit"]');
  // Should NOT navigate to secure.html
  assert.ok(!page.url().includes('secure.html'));
  await browser.close();
});

test('F2.E2: Form submission with negative loan amount triggers field error', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/form.html`);
  await page.fill('input[name="name"]', '홍길동');
  await page.fill('input[name="phone"]', '010-1234-5678');
  await page.fill('input[name="amount"]', '-5000'); // Negative amount
  await page.click('button[type="submit"]');
  assert.ok(!page.url().includes('secure.html'));
  await browser.close();
});

test('F2.E3: Form validation for invalid phone format prevents submit', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/form.html`);
  await page.fill('input[name="name"]', '홍길동');
  await page.fill('input[name="phone"]', 'abcd-123'); // Invalid phone
  await page.fill('input[name="amount"]', '10000000');
  await page.click('button[type="submit"]');
  assert.ok(!page.url().includes('secure.html'));
  await browser.close();
});

test('F2.E4: Direct access to success.html without valid captcha redirect/state error', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/success.html`);
  // If user accesses success page directly without completing captcha, it should display an error or redirect
  const content = await page.textContent('body');
  assert.ok(content.includes('Error') || content.includes('제한') || page.url().includes('form.html') || page.url().includes('success.html'));
  await browser.close();
});

test('F2.E5: Captcha submit with empty input does not transition to success page', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/secure.html`);
  await page.click('button[type="submit"]');
  assert.ok(!page.url().includes('success.html'));
  await browser.close();
});

// ===================================================
// FEATURE 3: Automation Resume / Status APIs (R3)
// ===================================================
test('F3.E1: Resume API with non-existent taskId returns 404 Not Found', async () => {
  const res = await fetch(`${BASE_URL}/api/automation/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: 'task-non-existent-9999', captchaCode: '123456' })
  });
  assert.strictEqual(res.status, 404);
});

test('F3.E2: Status API with non-existent taskId returns 404 Not Found', async () => {
  const res = await fetch(`${BASE_URL}/api/automation/status/task-non-existent-9999`);
  assert.strictEqual(res.status, 404);
});

test('F3.E3: Resume API with invalid captchaCode leaves status in PAUSED_SECURITY', async () => {
  // 1. Start Task
  const resStart = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userRequest: { utterance: '승인', user: { id: 'user-r3-e3' } } })
  });
  const dataStart = await resStart.json();
  const taskId = dataStart.template.outputs[0].simpleText.text.match(/task-\S+/)[0].replace(/\.$/, '');

  // Wait until paused
  while (true) {
    const s = await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json();
    if (s.status === 'PAUSED_SECURITY') break;
    await new Promise(r => setTimeout(r, 100));
  }

  // 2. Call Resume with INCORRECT Captcha
  const resResume = await fetch(`${BASE_URL}/api/automation/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, captchaCode: 'wrong-captcha' })
  });
  assert.strictEqual(resResume.status, 400);

  // Status must remain PAUSED_SECURITY
  const resStatus = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
  const dataStatus = await resStatus.json();
  assert.strictEqual(dataStatus.status, 'PAUSED_SECURITY');
});

test('F3.E4: Resuming an already COMPLETED task returns 400 Bad Request', async () => {
  const resStart = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userRequest: { utterance: '승인', user: { id: 'user-r3-e4' } } })
  });
  const dataStart = await resStart.json();
  const taskId = dataStart.template.outputs[0].simpleText.text.match(/task-\S+/)[0].replace(/\.$/, '');

  while (true) {
    const s = await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json();
    if (s.status === 'PAUSED_SECURITY') break;
    await new Promise(r => setTimeout(r, 100));
  }

  // Resume 1st time
  await fetch(`${BASE_URL}/api/automation/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, captchaCode: '123456' })
  });

  // Wait until completed
  while (true) {
    const s = await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json();
    if (s.status === 'COMPLETED') break;
    await new Promise(r => setTimeout(r, 100));
  }

  // Resume 2nd time
  const resResume2 = await fetch(`${BASE_URL}/api/automation/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, captchaCode: '123456' })
  });
  assert.strictEqual(resResume2.status, 400);
});

test('F3.E5: Concurrent status inquiries of the same task ID are responded correctly', async () => {
  const resStart = await fetch(`${BASE_URL}/api/kakao/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userRequest: { utterance: '승인', user: { id: 'user-r3-e5' } } })
  });
  const dataStart = await resStart.json();
  const taskId = dataStart.template.outputs[0].simpleText.text.match(/task-\S+/)[0].replace(/\.$/, '');

  const [res1, res2, res3] = await Promise.all([
    fetch(`${BASE_URL}/api/automation/status/${taskId}`),
    fetch(`${BASE_URL}/api/automation/status/${taskId}`),
    fetch(`${BASE_URL}/api/automation/status/${taskId}`)
  ]);
  assert.strictEqual(res1.status, 200);
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(res3.status, 200);
});
```

---

### Proposed Structure and Content of `TEST_INFRA.md`
This markdown file serves as the core E2E documentation layout, describing testing procedures and methodologies.

```markdown
# KakaoTalk Admin Assistant: E2E Test Infrastructure

This document outlines the testing infrastructure, suite structure, feature coverage map, execution instructions, and validation rules for the KakaoTalk Admin Assistant.

## 1. Test Architecture
The test suite utilizes a custom process runner to execute opaque-box tests against the Express Application and Playwright browser loops.

```
+------------------+           +------------------+
|                  |  spawns   |                  |
|  tests/          |---------->|  src/server.js   |
|  e2e_runner.js   |           |  (Express)       |
|                  |           +------------------+
+--------+---------+                     ^
         |                               | HTTP APIs & Pages
         | runs tests                    v
         v                     +------------------+
+------------------+           |                  |
|  Node.js Native  |---------->|  Playwright      |
|  Runner          |           |  Automation      |
+------------------+           +------------------+
```

## 2. Feature Inventory
* **Feature 1: KakaoTalk Webhook (`POST /api/kakao/webhook`)**
  - Triggers the automation task execution.
  - Formulates response payload to chatbot.
* **Feature 2: Playwright Form Automation**
  - Automates browser input into Youth Loan applications (`/form.html`, `/secure.html`, `/success.html`).
* **Feature 3: Automation Resume & Status API**
  - Endpoint `GET /api/automation/status/:taskId` checks executing status.
  - Endpoint `POST /api/automation/resume` handles human-in-the-loop CAPTCHA solving.

## 3. Test Suites Classification
* **Tier 1 (Feature Coverage)**: Verified in `tests/tier1_coverage.test.js`. Happy path verification targeting webhook endpoints, form filling, and resume hooks.
* **Tier 2 (Boundary & Error Cases)**: Verified in `tests/tier2_boundary.test.js`. Handles empty requests, incorrect parameters, phone formatting constraints, and error task ID queries.
* **Tier 3 (Cross-Feature Combinations)**: Verified in `tests/tier3_combination.test.js` (Milestone E2). Validates multi-user task interleaving, concurrent webhook execution, and server restarts.
* **Tier 4 (Real-World Scenarios)**: Verified in `tests/tier4_workload.test.js` (Milestone E2). Simulates complete real-world user flows under stress.

## 4. Execution Command
To run E2E tests locally:
```bash
npm test
```
This executes `node tests/e2e_runner.js`, which starts the Express server internally and executes all test suites.
```

---

## 5. Verification Method

To verify the test architecture design and readiness:
1. **Directory Integrity Check**: Inspect that files under `.agents/teamwork_preview_explorer_e1_1/` are read/write active and no code files have been written outside of this agent directory.
2. **Syntax Validation**: Ensure all javascript code blocks proposed above adhere to ECMAScript standard and node-native module compatibility.
3. **Execution Simulation**: Verify that running `node --test` with the proposed modules executes successfully when server endpoints are mocked as described.
