# Gap Report: White-Box Codebase Audit & Adversarial Hardening (Phase 2)

**Author:** `challenger_I5_1_gen1`  
**Milestone:** I5: Adversarial Hardening (Phase 2)  
**Date:** 2026-07-04  

This report details the findings from a white-box inspection of the KakaoTalk Admin Assistant codebase (`src/` and `tests/`) and provides a set of adversarial test cases along with a concrete remediation plan.

---

## 1. Findings & Vulnerabilities

### Finding 1: Memory Growth Risk (Task Leakage)
* **Location:** `src/automation/taskManager.js`
* **Vulnerability:** Unbounded growth of the in-memory `tasks` Map.
* **Details:** `TaskManager` initializes an in-memory Map (`this.tasks = new Map()`). When tasks are created, they are added using `this.tasks.set(taskId, task)`. However, there is no function that deletes or purges these tasks. Once tasks enter a terminal state (`COMPLETED` or `FAILED`), they remain in memory forever. Under high traffic, this will lead to continuous memory growth and eventually an Out of Memory (OOM) crash.
* **Evidence:** In `src/automation/taskManager.js`, `this.tasks` is never subjected to a `.delete(taskId)` or any form of expiration/TTL cleanup.

### Finding 2: State Pollution on Terminal Tasks
* **Location:** `src/automation/taskManager.js`
* **Vulnerability:** Unchecked status transitions and property updates on completed/failed tasks.
* **Details:**
  - **Updating Completed/Failed Tasks:** In `updateTask(taskId, updates)`, if a task's status is `FAILED` or `COMPLETED`, the method filters out updates to `status` and `error` but still performs `Object.assign(task, filteredUpdates)`. This allows external clients to overwrite fields like `currentUrl`, `formData`, `captchaCode`, `correctCaptcha`, etc., on completed tasks.
  - **Re-pausing Completed Tasks:** In `pauseTask(taskId, captchaText)`, the method checks if `task.status === 'FAILED'` and throws. However, it does **not** check if the status is `COMPLETED`. An attacker can call `pauseTask` on an already completed task, transitioning its status back to `PAUSED_SECURITY`, restarting the timeout, and creating a new deferred promise.
  - **Re-failing / Re-completing Tasks:** `failTask` does not check if the task is already `FAILED`, and `completeTask` does not check if it is already `COMPLETED`.
* **Evidence:**
  - `updateTask` line 31: `if (task.status === 'FAILED' || task.status === 'COMPLETED') { ... Object.assign(task, filteredUpdates); }`
  - `pauseTask` line 45: `if (task.status === 'FAILED') { throw new Error(...); }` (no check for `COMPLETED`).

### Finding 3: Lack of Captcha Brute-Force Rate-Limiting
* **Location:** `src/automation/taskManager.js`
* **Vulnerability:** Infinite captcha entry attempts allow brute-forcing.
* **Details:** In `resumeTask(taskId, captchaCode)`, if `captchaCode` does not match `task.correctCaptcha`, it returns `{ success: false, error: 'Invalid captcha code' }` without changing the task state. The task remains `PAUSED_SECURITY`. There is no limit on the number of attempts a user/attacker can make, nor is there any rate-limiting. Since the mock captcha is a 6-digit number (1,000,000 possibilities) checked instantly in memory, an attacker can easily brute-force the captcha code within the 5-minute timeout window.
* **Evidence:** `resumeTask` lines 93-95:
  ```javascript
  if (captchaCode !== task.correctCaptcha) {
    return { success: false, error: 'Invalid captcha code' };
  }
  ```

### Finding 4: Captcha Leakage via Unauthenticated Endpoint
* **Location:** `src/server.js`
* **Vulnerability:** Anyone with a task ID can retrieve the correct captcha code.
* **Details:** The backend exposes `GET /api/automation/captcha/:taskId` which returns `{ captcha: task.correctCaptcha }` in plain text. While designed for the mock secure page to show the captcha, this endpoint has no authentication, allowing any client that knows the `taskId` to query it, bypass the captcha entirely, and call the resume API.
* **Evidence:** `src/server.js` line 131:
  ```javascript
  app.get('/api/automation/captcha/:taskId', (req, res) => {
    ...
    return res.json({ captcha: task.correctCaptcha });
  });
  ```

### Finding 5: Concurrency Resource Exhaustion (DoS)
* **Location:** `src/server.js` and `src/automation/browser.js`
* **Vulnerability:** Webhook handler spawns headless browsers concurrently without limits.
* **Details:** Every webhook request with the utterance `"승인"` triggers `runAutomation(taskId, serverPort)` asynchronously. Each call launches a new Chromium instance via Playwright (`chromium.launch({ headless: true })`). If a malicious user or bot sends hundreds of approval requests in a short period, the server will spawn hundreds of browser instances concurrently, leading to CPU and memory exhaustion.
* **Evidence:** `server.js` line 58: `runAutomation(taskId, serverPort).catch(...)` is called directly without concurrency throttling.

---

## 2. Proposed Adversarial Test Cases (Tier 5)

We have created the test file `tests/adversarial_gaps.test.js` containing the following tests targeting the identified gaps. These tests are written to verify security and stability guarantees, and will fail on the current implementation:

1. **`completed and failed tasks must be cleaned up from the in-memory Map`**:
   - Ensures that calling `completeTask` or `failTask` removes the task from the in-memory Map (or schedules a cleanup) to prevent memory leaks.
2. **`should prevent updating task properties (e.g. currentUrl, formData) on completed/failed tasks`**:
   - Asserts that `updateTask` rejects or ignores property modifications for tasks in terminal states.
3. **`should reject transitions to PAUSED_SECURITY if task is already COMPLETED`**:
   - Asserts that calling `pauseTask` on a completed task throws an error.
4. **`should automatically fail task after multiple invalid captcha attempts`**:
   - Asserts that a task is transitioned to `FAILED` status after exceeding a limit of failed captcha entry attempts (e.g. 5 attempts).
5. **`fetching captcha code directly from API should be prohibited or require auth`**:
   - Verifies that `GET /api/automation/captcha/:taskId` is secure and does not return the correct captcha code in plain text to public clients.

---

## 3. Remediation Plan

To address these vulnerabilities, a developer should modify the implementation as follows:

### Step 1: Implement TTL Task Cleanup
- In `taskManager.js`, add a periodic cleanup job (using `setInterval`) or check on task creation to delete tasks that have been completed or failed for more than a configured duration (e.g., 10 minutes).
- Alternatively, delete the task immediately upon termination if monitoring is done, or keep a limited-size LRU Cache for task status.

### Step 2: Prevent State Pollution
- In `taskManager.js` -> `updateTask(taskId, updates)`: If the task status is `FAILED` or `COMPLETED`, ignore the update entirely or throw an error. Do not call `Object.assign`.
- In `taskManager.js` -> `pauseTask(taskId, captchaText)`: Check if `task.status === 'COMPLETED' || task.status === 'FAILED'` and throw an error.
- In `taskManager.js` -> `completeTask(taskId)` and `failTask(taskId)`: Return early if the task is already in `COMPLETED` or `FAILED` state.

### Step 3: Implement Captcha Attempt Limits
- In `taskManager.js` -> `createTask`: Initialize `task.attempts = 0`.
- In `taskManager.js` -> `resumeTask(taskId, captchaCode)`:
  - If the captcha is incorrect, increment `task.attempts`.
  - If `task.attempts` reaches a maximum limit (e.g., 3 or 5), call `this.failTask(taskId, 'Too many invalid captcha attempts')` and return `{ success: false, error: 'Too many invalid captcha attempts. Task failed.' }`.

### Step 4: Secure the Captcha Endpoint
- Limit `GET /api/automation/captcha/:taskId` to local requests or use a secret token/signature that only the automation browser possesses.
- Alternatively, have the automation browser retrieve the captcha code by executing JavaScript in the page context instead of exposing a public JSON API, or add basic authentication headers.

### Step 5: Implement Browser Concurrency Limit
- Implement a semaphore or simple worker queue (e.g., using `p-limit` or a custom counter) in `taskManager.js` or `browser.js` to ensure the number of concurrent active Playwright browsers does not exceed a safe limit (e.g., 3 or 5). Excess requests should be queued or rejected with a high-load error.
