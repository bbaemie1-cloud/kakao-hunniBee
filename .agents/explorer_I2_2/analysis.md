# Analysis Report: KakaoTalk Webhook & API Implementation Design (Milestone I2)

## 1. Executive Summary
This report analyzes and designs the KakaoTalk Webhook and API implementation (Milestone I2) for the KakaoTalk Admin Assistant. It verifies compliance with the interface contracts specified in `PROJECT.md` (R1 and R3), outlines the integration between the Express server and the in-memory `taskManager.js`, and proposes concrete architectural and code fixes to resolve critical issues identified in Milestone I1 (including browser hangs on task cancellation, memory leaks on double-pausing, and state pollution on finished tasks).

---

## 2. Express Webhook Endpoint (`POST /api/kakao/webhook`)

### R1 Webhook Contract Verification
The webhook endpoint is exposed at `POST /api/kakao/webhook` and matches the R1 contract.
- **Request Body Contract**:
  ```json
  {
    "userRequest": {
      "utterance": "승인",
      "user": {
        "id": "mock-user-12345"
      }
    }
  }
  ```
- **Response Body Contract**:
  ```json
  {
    "version": "2.0",
    "template": {
      "outputs": [
        {
          "simpleText": {
            "text": "대출 자동 신청을 시작합니다. (작업 ID: task-123). 보안 확인 단계가 발생하면 추가 안내를 드리겠습니다."
          }
        }
      ]
    }
  }
  ```

### Current Implementation & Design Considerations
1. **Request Verification**:
   - The endpoint checks for the structure: `req.body.userRequest`, `userRequest.utterance`, `userRequest.user`, and `userRequest.user.id`.
   - If missing, it returns `400 Bad Request` with `{ error: 'Invalid webhook request structure' }`.
2. **Utterance Processing**:
   - The supported utterance is strictly `"승인"`.
   - **Alternative/Unsupported Utterances**: If the utterance is not `"승인"`, the endpoint returns a `400 Bad Request` with a JSON body explaining the error (e.g. `'지원하지 않는 발화입니다. "승인"을 입력해주세요.'`).
   - *Note on KakaoTalk Protocol*: Real-world KakaoTalk Bot webhooks require a `200 OK` status even when returning an error response template, to allow the bot client to render the error bubble rather than showing a generic connection failure. However, the E2E test suite `tests/tier1_coverage.test.js:85` explicitly asserts that unsupported utterances return a `400` status. Therefore, the implementation must maintain the `400` response code to satisfy the test specifications.
3. **Re-approval Cancellation**:
   - To prevent overlapping tasks, when a user issues a new `"승인"` request, the server identifies existing active tasks belonging to that user (mapped by email matching `${user.id}@example.com`) and cancels them:
     ```javascript
     const userEmail = `${user.id}@example.com`;
     for (const t of taskManager.tasks.values()) {
       if (t.formData && t.formData.email === userEmail && (t.status === 'RUNNING' || t.status === 'PAUSED_SECURITY')) {
         taskManager.cancelTask(t.taskId, 'Cancelled by new re-approval request');
       }
     }
     ```
   - This prevents resource contention and ensures only one active automation flow runs per user.
4. **Asynchronous Playwright Execution**:
   - Once the task is registered in `taskManager`, the webhook starts the automation flow asynchronously (`runAutomation(taskId, serverPort).catch(...)`) and immediately returns the initial response containing the `taskId` to the user, ensuring fast response times (< 1 second) as required by KakaoTalk's timeout constraints.

---

## 3. Automation Resume & Status APIs (R3 Contract)

### Resume API (`POST /api/automation/resume`)
- **Endpoint**: `POST /api/automation/resume`
- **Request Payload**:
  ```json
  {
    "taskId": "task-123",
    "captchaCode": "123456"
  }
  ```
- **Response Payload**:
  ```json
  {
    "success": true,
    "message": "Resume signal received. Processing captcha..."
  }
  ```
- **Behavior & Guardrails**:
  - Returns `400 Bad Request` if `taskId` or `captchaCode` are missing.
  - Returns `404 Not Found` if the task does not exist.
  - Returns `400 Bad Request` if the task status is not `PAUSED_SECURITY`.
  - Checks if the submitted `captchaCode` matches the task's `correctCaptcha`. If mismatched, it returns `400 Bad Request` with `{ success: false, error: 'Invalid captcha code' }` and leaves the task in `PAUSED_SECURITY` (allowing retry).
  - On success, it calls `taskManager.resumeTask(taskId, captchaCode)` which clears the safety timeout, resolves the deferred promise, and returns `200 OK`.

### Task Status Monitoring API (`GET /api/automation/status/:taskId`)
- **Endpoint**: `GET /api/automation/status/:taskId`
- **Response Payload**:
  ```json
  {
    "taskId": "task-123",
    "status": "RUNNING" | "PAUSED_SECURITY" | "COMPLETED" | "FAILED",
    "currentUrl": "http://localhost:3000/secure.html",
    "error": null
  }
  ```
- **Behavior & Guardrails**:
  - Returns `404 Not Found` if the task is not found.
  - Returns `404 Not Found` safely if the `taskId` parameter contains path traversal or invalid characters (as verified by `tests/tier2_boundary.test.js` using `../../../etc/passwd`). Express route matching handles this naturally.

---

## 4. Server & Task Manager Integration Flow

The integration between the Express server, `taskManager.js`, and the Playwright browser runner follows a strict lifecycle:

```
[ KakaoTalk Webhook ] ──> Create Task ──> Trigger runAutomation() (Async)
                                                 │
                                                 ▼
[ Playwright Runner ] <── Navigate & Fill ── [ form.html ]
        │
        ▼ (Redirect)
[ secure.html ] ──> Call pauseTask() ──> Blocks automation (Await Deferred Promise)
                                                 │
                                                 ▼
[ Resume API ] ──> Resolve Promise ──> Playwright resumes ──> Enter Captcha
                                                                    │
                                                                    ▼ (Redirect)
                                                             [ success.html ]
                                                                    │
                                                                    ▼
                                                            Set COMPLETED & Close
```

### Critical Mismatch: Email Validation & Unfilled Form Fields
During the analysis, a critical gap in the form submission flow was identified:
1. **Form Layout Requirements**: The mock application form (`form.html`) requires multiple fields: `name`, `email`, `age`, `phone`, `amount`, `deposit`, and `agree` (checkbox), all marked with the HTML5 `required` attribute.
2. **Playwright script gaps**: The current `browser.js` only fills `#name`, `#email`, and `#amount`. It leaves `#age`, `#phone`, `#deposit`, and `#agree` blank.
3. **Email Validation Mismatch**: The server's validation check is weak (`email.includes('@')`), whereas the browser's native email validation requires a valid hostname (e.g. `user@example.com`). If an email like `user@` is passed, the server accepts it, but the browser blocks form submission.
4. **Resulting Hangs**: Because the browser blocks form submission due to empty required fields or invalid email formats, no page navigation occurs. Playwright awaits `page.waitForNavigation()`, which hangs indefinitely (or until standard 30-second timeouts occur), causing severe resource exhaustion.

#### Proposed Design Resolution:
- **`novalidate` attribute**: Add the `novalidate` attribute to the `<form>` tag in `form.html`. This disables browser native HTML5 validation and forces all submissions to go through the Express server.
- **Server Validation**: Elevate server-side validation using standard regex checks for emails, numbers, and inputs, and return `400 Bad Request` with appropriate messages.
- **Navigation Timeouts**: Add a short timeout to `page.waitForNavigation({ timeout: 5000 })` in `browser.js` so that if submission is blocked for any reason, the automation fails quickly and cleans up the browser context rather than hanging.

---

## 5. Milestone I1 Bug Fixes & Guardrails Design

To resolve the cancellation, double-pause, and state pollution issues identified in Milestone I1, the following design improvements are proposed:

### 1. Task Cancellation & Playwright Hang
- **Problem**: When a task is cancelled, `cancelTask` resolves the task's deferred promise with `'CANCELLED'`. Playwright receives this string and tries to enter it into the `#captcha` field of `secure.html` and click verify. The captcha form prevents submission because the code is incorrect, and Playwright hangs on `page.waitForNavigation()`.
- **Proposed Fix in `browser.js`**:
  Directly check the resolved value from `pauseTask`. If it is `'CANCELLED'`, immediately throw an error to trigger cleanup and abort.
  ```javascript
  const captchaCode = await taskManager.pauseTask(taskId);
  if (captchaCode === 'CANCELLED') {
    throw new Error('Task was cancelled');
  }
  ```
- **Proactive Cancellation Checkpoints**:
  Check `task.status` at checkpoints in `browser.js` (e.g., after loading `form.html`, before clicking submit, and before pausing) to stop the flow immediately if the task was cancelled in the background:
  ```javascript
  function checkCancellation(taskId) {
    const task = taskManager.getTask(taskId);
    if (!task || task.status === 'FAILED') {
      throw new Error(task?.error || 'Task was cancelled');
    }
  }
  ```

### 2. Double-Pause Memory Leak
- **Problem**: Sequential calls to `pauseTask` overwrite `task.deferred`, orphaning the first promise and leaking memory.
- **Proposed Fix in `taskManager.js`**:
  Add guards to `pauseTask` to reject the call if the task is already paused or in a terminal state:
  ```javascript
  pauseTask(taskId, captchaText, timeoutMs = 300000) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    if (task.status === 'PAUSED_SECURITY' || task.deferred) {
      throw new Error(`Task ${taskId} is already paused`);
    }

    if (task.status === 'COMPLETED' || task.status === 'FAILED') {
      throw new Error(`Task ${taskId} is already in terminal state: ${task.status}`);
    }
    
    // Proceed with pausing...
  }
  ```

### 3. State Pollution Guardrails
- **Problem**: Routes like `/api/submit-form` allow updating the `formData` of a task that is already `COMPLETED` or `FAILED`.
- **Proposed Fix in Server & TaskManager**:
  1. Add checks to all endpoints modifying state:
     - `/api/submit-form`:
       ```javascript
       if (task.status === 'COMPLETED' || task.status === 'FAILED') {
         return res.status(400).send('Task already finished');
       }
       ```
     - `/api/submit-captcha`:
       ```javascript
       if (task.status === 'COMPLETED' || task.status === 'FAILED') {
         return res.status(400).send('Task already finished');
       }
       if (task.status !== 'PAUSED_SECURITY') {
         return res.status(400).send('Task is not paused for verification');
       }
       ```
  2. Implement strict state immutability in `taskManager.updateTask(taskId, updates)`:
     ```javascript
     updateTask(taskId, updates) {
       const task = this.getTask(taskId);
       if (task) {
         if (task.status === 'COMPLETED' || task.status === 'FAILED') {
           // Do not allow updating state-modifying fields for terminal tasks
           const filtered = { ...updates };
           delete filtered.status;
           delete filtered.error;
           Object.assign(task, filtered);
           return;
         }
         Object.assign(task, updates);
       }
     }
     ```
  3. Ensure `completeTask(taskId)` and `failTask(taskId)` ignore terminal tasks:
     ```javascript
     completeTask(taskId) {
       const task = this.getTask(taskId);
       if (!task || task.status === 'COMPLETED' || task.status === 'FAILED') return;
       ...
     }

     failTask(taskId, errorMessage) {
       const task = this.getTask(taskId);
       if (!task || task.status === 'COMPLETED' || task.status === 'FAILED') return;
       ...
     }
     ```
