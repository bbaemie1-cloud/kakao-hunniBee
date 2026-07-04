# Analysis & Design Report: KakaoTalk Webhook & API Implementation (Milestone I2)

## 1. Executive Summary

This report presents a read-only investigation and architectural design review of the KakaoTalk Webhook and API implementation for the KakaoTalk Admin Assistant mock application. It focuses on verification of API contracts (R1 and R3), server integration patterns, and resolutions for three critical issues identified in Milestone I1: **browser automation hangs during cancellation**, **promise leaks from double-pausing**, and **state pollution on terminal tasks**. 

By applying defensive state checks and clean promise management, we ensure 100% compliance with KakaoTalk's Bot protocol and prevent resource/memory leaks in production-like workloads.

---

## 2. API Contract Verification & Traces

### 2.1. KakaoTalk Bot Webhook (R1 Contract)
* **Endpoint**: `POST /api/kakao/webhook`
* **Trigger Utterance**: `"승인"`
* **Compliance Review**: 
  - Standard webhook format requires extracting `utterance`, `user.id` from `req.body.userRequest`.
  - When the utterance is not `"승인"`, the endpoint returns a `400 Bad Request` containing a valid KakaoTalk v2.0 schema response informing the user of the invalid input.
  - When a valid request is received, a unique Task ID (`task-<timestamp>-<rand>`) is generated, initial `formData` populated with default mock data mapped to the user, and re-approval cancellation is triggered for any running/paused tasks associated with the user's email.
  - The webhook immediately returns a `200 OK` JSON matching the KakaoTalk v2.0 Bot template:
    ```json
    {
      "version": "2.0",
      "template": {
        "outputs": [
          {
            "simpleText": {
              "text": "대출 자동 신청을 시작합니다. (작업 ID: task-12345). 보안 확인 단계가 발생하면 추가 안내를 드리겠습니다."
            }
          }
        ]
      }
    }
    ```
  - **Asynchronous Execution**: Playwright automation is run in the background (`runAutomation(taskId, serverPort).catch(...)`) immediately after triggering the task creation, preventing blocking of the Kakao webhook response.

### 2.2. Automation Resume API (R3 Contract)
* **Endpoint**: `POST /api/automation/resume`
* **Payload**: `{ "taskId": "task-123", "captchaCode": "123456" }`
* **Compliance Review**:
  - Validates inputs. Missing parameters trigger a `400 Bad Request` containing `{ success: false, error: 'Missing taskId or captchaCode' }`.
  - Missing task records return a `404 Not Found`.
  - Tasks that are not in the `PAUSED_SECURITY` status trigger a `400 Bad Request` with `Task is not paused`.
  - Incorrect captcha codes return a `400 Bad Request` with `Invalid captcha code`, leaving the task in the `PAUSED_SECURITY` status for user retry.
  - Correct captcha codes resolve the task's deferred promise, transition status to `RUNNING`, clear any pending timeout, and return a `200 OK` with:
    ```json
    {
      "success": true,
      "message": "Resume signal received. Processing captcha..."
    }
    ```

### 2.3. Task Status Monitoring Endpoint (Internal)
* **Endpoint**: `GET /api/automation/status/:taskId`
* **Compliance Review**:
  - Missing task records return `404 Not Found`.
  - Valid task records return `200 OK` with:
    ```json
    {
      "taskId": "task-123",
      "status": "RUNNING" | "PAUSED_SECURITY" | "COMPLETED" | "FAILED",
      "currentUrl": "http://localhost:3000/secure.html",
      "error": null
    }
    ```

---

## 3. Server Integration with `taskManager.js`

The in-memory `TaskManager` serves as the primary coordinator between the HTTP Server (Express) and the background automation flows (Playwright).

```
   [Kakao Bot]               [Express Server]                [TaskManager]             [Playwright (Browser)]
        |                           |                              |                             |
        |--- POST /webhook (승인) -->|                              |                             |
        |                           |--- createTask(taskId) ------>|                             |
        |<-- 200 OK (Task ID) ------|                              |                             |
        |                           |--- runAutomation(taskId) --------------------------------->|
        |                           |                              |                             | (Launches Chromium,
        |                           |                              |<-- updateTask(currentUrl) --|  fills loan form,
        |                           |                              |                             |  submits form)
        |                           |                              |                             |
        |                           |<-- Redirects /secure.html ---------------------------------|
        |                           |                              |                             |
        |                           |                              |<-- pauseTask(taskId) -------| (Pauses execution thread;
        |                           |                              |     (creates deferred)      |  creates deferred promise)
        |                           |                              |                             |
        |<-- GET /status (PAUSED) --|                              |                             |
        |                           |                              |                             |
        |--- POST /resume --------->|                              |                             |
        |    (with captchaCode)     |--- resumeTask(taskId, code) ->|                             |
        |                           |     (resolves deferred)      |                             |
        |<-- 200 OK (Processing...) -|                              |                             |
        |                           |                              |==== Resolves Promise =======| (Resumes execution thread;
        |                           |                              |                             |  fills captcha,
        |                           |                              |                             |  submits verify)
        |                           |<-- Redirects /success.html --------------------------------|
        |                           |                              |                             |
        |                           |                              |<-- completeTask(taskId) ----| (Sets status to COMPLETED;
        |                           |                              |                              |  closes browser)
```

---

## 4. Milestone I1 Issues: Investigation & Design Solutions

### 4.1. Task Cancellation and Playwright Hangs

#### Observation & Analysis
* **Location**: `src/automation/taskManager.js` (lines 129-146) and `src/automation/browser.js` (lines 34-45).
* **The Root Cause**: 
  When a task is cancelled via `cancelTask(taskId, reason)`, the deferred promise is resolved with the string `'CANCELLED'`:
  ```javascript
  if (task.deferred) {
    task.deferred.resolve('CANCELLED');
    task.deferred = null;
  }
  ```
  In `browser.js`, the code awaits this promise:
  ```javascript
  const captchaCode = await taskManager.pauseTask(taskId);
  await page.fill('#captcha', captchaCode); // inputs 'CANCELLED'
  await Promise.all([
    page.click('#verify-btn'),
    page.waitForNavigation()
  ]);
  ```
  Since `captchaCode` becomes `'CANCELLED'`, it is entered into the `#captcha` field, and the form is submitted to `/api/submit-captcha`. The server rejects `'CANCELLED'` because it does not match `task.correctCaptcha`, returning a `400 Bad Request` without redirecting.
  Because no navigation occurs, `page.waitForNavigation()` hangs indefinitely (or until the 30-second default Playwright timeout), leaking browser processes and consuming machine resources.

#### Design Recommendation
Since challenger tests explicitly assert that the promise resolves with `'CANCELLED'` (e.g. `tests/challenger_I1_4.test.js` line 41), changing `cancelTask` to reject the promise would break those assertions. Instead, we must update the background automation flow in `browser.js` to inspect the resolved value and early-abort if the task was cancelled.

* **Fix in `src/automation/browser.js`**:
  ```javascript
  const captchaCode = await taskManager.pauseTask(taskId);
  if (captchaCode === 'CANCELLED') {
    // Cleanly exit automation flow without attempting captcha submission
    return;
  }
  ```

---

### 4.2. Double-Pause and Promise Leaks

#### Observation & Analysis
* **Location**: `src/automation/taskManager.js` (lines 35-64).
* **The Root Cause**:
  `pauseTask(taskId, captchaText, timeoutMs)` initializes a new Promise and overwrites the `task.deferred` reference without checking if one already exists:
  ```javascript
  task.deferred = {
    promise,
    resolve: resolveFn,
    reject: rejectFn
  };
  ```
  If `pauseTask` is called twice on the same task, the original promise is orphaned in memory and stays pending indefinitely. No reference remains to resolve or reject it, causing a promise leak.

#### Design Recommendation
To resolve this memory leak, we should cleanly reject any pre-existing deferred promise associated with the task before overwriting it.

* **Fix in `src/automation/taskManager.js`**:
  ```javascript
  pauseTask(taskId, captchaText, timeoutMs = 300000) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    // Clean up previous deferred reference to prevent leaks
    if (task.deferred) {
      task.deferred.reject(new Error('Superceded by new pause request'));
      task.deferred = null;
    }

    task.status = 'PAUSED_SECURITY';
    task.captchaText = captchaText;
    // ... rest of the setup
  ```

* **Adversarial Test Modification**:
  If the previous promise is rejected instead of hanging, the adversarial test `tests/adversarial.test.js` (lines 161-183) must be adjusted to verify that the first promise rejects correctly rather than hanging:
  ```javascript
  // promise1 should reject due to being superceded
  await assert.rejects(promise1, /Superceded by new pause request/);
  ```

---

### 4.3. State Pollution on Terminal Tasks

#### Observation & Analysis
* **Location**: `src/server.js` (lines 141-171).
* **The Root Cause**:
  The form submission handler `/api/submit-form` processes submissions and updates `task.formData` directly without verifying the task's current status:
  ```javascript
  app.post('/api/submit-form', (req, res) => {
    ...
    const task = taskManager.getTask(taskId);
    ...
    // Update in-memory form data
    task.formData = { name, email, amount: amt };
    
    return res.redirect(`/secure.html?taskId=${taskId}`);
  });
  ```
  If a client submits a form with a `taskId` corresponding to an already `COMPLETED` or `FAILED` task, the task's form data is mutated, resulting in state corruption.

#### Design Recommendation
We should enforce state boundaries at the API controller level. Form submissions should only be permitted if the task is currently in the initial `RUNNING` status (indicating the form is being submitted as part of the active flow).

* **Fix in `src/server.js`**:
  ```javascript
  app.post('/api/submit-form', (req, res) => {
    const { taskId, name, email, amount } = req.body;
    if (!taskId) {
      return res.status(400).send('Missing taskId');
    }
    const task = taskManager.getTask(taskId);
    if (!task) {
      return res.status(404).send('Task not found');
    }

    // Prevent state pollution on completed, failed, or paused tasks
    if (task.status !== 'RUNNING') {
      return res.status(400).send(`Cannot submit form for a task in status: ${task.status}`);
    }
    // ... validate and update formData ...
  ```

* **Task Manager Guard (Defensive Programming)**:
  Additionally, prevent direct mutation of form data for terminal tasks in `taskManager.updateTask`:
  ```javascript
  updateTask(taskId, updates) {
    const task = this.getTask(taskId);
    if (task) {
      if ((task.status === 'COMPLETED' || task.status === 'FAILED') && updates.formData) {
        throw new Error(`Cannot update form data for task ${taskId} in terminal state: ${task.status}`);
      }
      Object.assign(task, updates);
    }
  }
  ```

---

## 5. Conclusion & Recommendations

The KakaoTalk webhook and API endpoint implementations are structurally conformant with the project's contracts. However, the identified Milestone I1 edge cases present critical availability and reliability risks:
1. **Playwright hangs** during task cancellation leak chromium browser processes.
2. **Double-pause operations** leak memory by leaving promises pending indefinitely in the event loop.
3. **Lack of state constraints** allows re-submission of form details on finalized tasks.

Implementing the defensive guards and early returns detailed in Section 4 will resolve these issues completely, enabling a robust transition to Milestone I3 (Playwright Automation Flow).
