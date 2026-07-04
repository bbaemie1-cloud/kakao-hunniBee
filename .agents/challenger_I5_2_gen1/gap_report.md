# Gap Report: Adversarial Hardening (Phase 2)

This report documents the findings from a white-box inspection of the KakaoTalk Admin Assistant codebase (`src/` and `tests/`) to identify vulnerabilities, memory leaks, brute-force exploits, and state pollution gaps.

---

## 1. Vulnerability Findings

### Finding 1.1: Unbounded Memory Growth in `TaskManager` (High Risk)
- **File**: `src/automation/taskManager.js`
- **Location**: Class property `this.tasks = new Map()`
- **Vulnerability**: 
  When a new task is initiated (e.g. through the KakaoTalk webhook endpoint `/api/kakao/webhook`), a task object is created via `taskManager.createTask(taskId, formData)` and stored in `this.tasks`. However, there is no corresponding logic to remove, evict, or clean up tasks from `this.tasks` when they reach a terminal state (`COMPLETED` or `FAILED`).
- **Consequences**:
  - In a long-running Node.js production process, task states (containing form data, correct captcha strings, URLs, and timing information) will accumulate indefinitely.
  - This leads to a linear memory growth relative to the number of requests, eventually triggering Out Of Memory (OOM) crashes and server instability.
- **Proof of Concept**:
  Creating multiple tasks and completing them leaves `taskManager.tasks.size` unchanged from the total number of tasks created.

### Finding 1.2: State Pollution on Terminal Tasks (Medium Risk)
- **File**: `src/automation/taskManager.js`
- **Location**: `updateTask(taskId, updates)` method (lines 28–40)
- **Vulnerability**:
  The `updateTask` function permits modifying properties (like `formData`, `captchaCode`, `correctCaptcha`, `currentUrl`) of tasks that have already transitioned to terminal states (`COMPLETED` or `FAILED`). It only filters out `status` and `error` properties:
  ```javascript
  if (task.status === 'FAILED' || task.status === 'COMPLETED') {
    const filteredUpdates = { ...updates };
    delete filteredUpdates.status;
    delete filteredUpdates.error;
    Object.assign(task, filteredUpdates);
  }
  ```
- **Consequences**:
  - Anyone can update task parameters (such as name, email, loan amount) on a task that has already finished.
  - This breaks auditability, pollutes system state, and allows post-approval data manipulation.
- **Proof of Concept**:
  Call `taskManager.updateTask(taskId, { formData: { name: 'Polluted Name' } })` on a completed task and verify that the name in `formData` changes.

### Finding 1.3: Captcha Brute-Force Vulnerability & Lack of Rate Limiting (High Risk)
- **File**: `src/automation/taskManager.js`
- **Location**: `resumeTask(taskId, captchaCode)` method (lines 85–111)
- **Vulnerability**:
  If the submitted `captchaCode` is incorrect, the function returns `{ success: false, error: 'Invalid captcha code' }` but does not increment any attempt count or fail the task. The correct captcha code remains static and valid.
- **Consequences**:
  - Since the captcha is a 6-digit number (900,000 combinations) and the timeout window is 5 minutes, an attacker can perform a rapid brute-force attack to guess the captcha.
  - With no lockout or attempt limit, a simple script can try thousands of codes per second to resume the paused automation task.
- **Proof of Concept**:
  Call `resumeTask` 20 times with incorrect codes; the task status remains `PAUSED_SECURITY` and a subsequent correct captcha code call still successfully resumes the task.

### Finding 1.4: Plain Text Captcha Leak via Public API (Critical Risk)
- **File**: `src/server.js`
- **Location**: `GET /api/automation/captcha/:taskId` (lines 131–138)
- **Vulnerability**:
  The server exposes a public, unauthenticated endpoint `/api/automation/captcha/:taskId` that returns `{ captcha: task.correctCaptcha }` in plain text.
- **Consequences**:
  - Any user or malicious bot that can guess or scan task IDs can fetch the correct captcha code directly, bypassing the security barrier entirely.
- **Proof of Concept**:
  Perform `GET /api/automation/captcha/task-xxx` and obtain the exact correct captcha value.

---

## 2. Proposed & Implemented Adversarial Test Cases (Tier 5)

We have written a new test suite file `tests/adversarial_hardening.test.js` containing Tier 5 adversarial tests that expose these four gaps:

```javascript
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const taskManager = require('../src/automation/taskManager');
const { startServer } = require('../src/server');

const PORT = 3009;
const BASE_URL = `http://localhost:${PORT}`;
let server;

describe('Adversarial Hardening (Phase 2) - Vulnerability Checks', () => {
  before(async () => {
    server = await startServer(PORT);
  });

  after(() => {
    if (server) {
      server.close();
    }
  });

  test('1. Verify memory growth risks (tasks Map does not clean up)', async () => {
    const initialSize = taskManager.tasks.size;
    const testTasksCount = 5;
    const createdIds = [];

    // Create tasks
    for (let i = 0; i < testTasksCount; i++) {
      const taskId = `mem-growth-${i}-${Date.now()}`;
      taskManager.createTask(taskId, { name: `Test ${i}` });
      createdIds.push(taskId);
    }

    // Move to terminal states
    taskManager.completeTask(createdIds[0]);
    taskManager.failTask(createdIds[1], 'Failed on purpose');
    taskManager.completeTask(createdIds[2]);
    taskManager.failTask(createdIds[3], 'Failed on purpose');
    taskManager.completeTask(createdIds[4]);

    // Check map size still includes all of them (leak verified)
    assert.strictEqual(taskManager.tasks.size, initialSize + testTasksCount);
  });

  test('2. Verify state pollution on completed/failed tasks', async () => {
    const completedTaskId = `pollution-completed-${Date.now()}`;
    taskManager.createTask(completedTaskId, { name: 'Original Name' });
    taskManager.completeTask(completedTaskId);

    // Attempt to pollute completed task
    taskManager.updateTask(completedTaskId, { formData: { name: 'Polluted Name' } });
    const completedTask = taskManager.getTask(completedTaskId);
    assert.strictEqual(completedTask.formData.name, 'Polluted Name', 'Completed task formData was polluted');
  });

  test('3. Verify lack of captcha brute-force rate-limiting and lockout', async () => {
    const taskId = `brute-force-${Date.now()}`;
    const task = taskManager.createTask(taskId);
    taskManager.pauseTask(taskId, 'CAPTCHA');

    // 20 failed attempts
    for (let i = 0; i < 20; i++) {
      const res = taskManager.resumeTask(taskId, `wrong-code-${i}`);
      assert.strictEqual(res.success, false);
    }

    // Verify task is still PAUSED_SECURITY
    assert.strictEqual(task.status, 'PAUSED_SECURITY');
  });

  test('4. Verify captcha exposure endpoint (unauthenticated)', async () => {
    const taskId = `captcha-exposure-${Date.now()}`;
    const task = taskManager.createTask(taskId);
    
    const response = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`);
    const data = await response.json();
    assert.strictEqual(data.captcha, task.correctCaptcha, 'Public API exposed the captcha');
  });
});
```

---

## 3. Remediation Plan

To harden the system, a worker agent should apply the following modifications:

### 3.1. Implement Task Cleanup & Memory Management
- **Action**: Add automated task eviction in `taskManager.js`.
- **Details**:
  - Keep a TTL (e.g. 10 minutes) for terminal tasks. When a task transitions to `COMPLETED` or `FAILED`, set a timeout to delete it from the `tasks` Map.
  - Ensure any associated timers (`timeoutId`) or callbacks are cleaned up properly to prevent memory leaks.

### 3.2. Prevent State Pollution on Terminal Tasks
- **Action**: Modify `updateTask(taskId, updates)` to throw an error or reject modifications when a task status is `COMPLETED` or `FAILED`.
- **Details**:
  ```javascript
  updateTask(taskId, updates) {
    const task = this.getTask(taskId);
    if (task) {
      if (task.status === 'FAILED' || task.status === 'COMPLETED') {
        throw new Error(`Cannot update task in terminal state: ${task.status}`);
      }
      Object.assign(task, updates);
    }
  }
  ```

### 3.3. Implement Captcha Attempt Tracking & Lockout
- **Action**: Track captcha verification attempts and fail the task after a threshold.
- **Details**:
  - Add `attempts` count (default `0`) on the task object in `createTask`.
  - In `resumeTask(taskId, captchaCode)`, increment the attempt count on mismatch.
  - If attempts reach `3`, call `this.failTask(taskId, 'Too many captcha verification attempts')` to move it to `FAILED` status, clean up Playwright browser instances, and reject the deferred promise.

### 3.4. Restrict or Remove Captcha Exposure API
- **Action**: Remove the `/api/automation/captcha/:taskId` endpoint or secure it.
- **Details**:
  - Since this is a test environment, if the frontend page needs to display the captcha, render it directly on the canvas as an image rather than returning the plain text over a JSON API.
  - If the endpoint must exist for automated testing purposes, protect it with a secret API key or restrict access only to requests originating from `localhost` / internal services.
