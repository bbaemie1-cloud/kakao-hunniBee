# Milestone I2 Investigation & Design: KakaoTalk Webhook & API Implementation

## Summary of Core Findings
This report details the design and server-side logic for the KakaoTalk webhook endpoint, the automation resume/status APIs, and their integration with `taskManager.js` and Playwright browser orchestration. It specifically identifies root causes and proposes robust architectural and code-level fixes for the four critical issues (cancellation hang, double-pause promise leak, state pollution, and form validation browser hang) identified during Milestone I1 verification.

---

## 1. Webhook Endpoint (`POST /api/kakao/webhook`) Design & Verification
The KakaoTalk webhook endpoint serves as the primary entry point to trigger the youth loan automation flow. It conforms to the KakaoTalk chatbot R1 contract and supports robust input sanitization, error responses, duplicate task prevention, and asynchronous execution tracking.

### Webhook Protocol & Input Validation
- **Path**: `POST /api/kakao/webhook`
- **Request Validation**:
  - The server verifies that the payload contains `userRequest.utterance` and `userRequest.user.id`. Missing fields yield a `400 Bad Request` status with a descriptive JSON message.
  - If the utterance is anything other than `"승인"`, the server returns a `400 Bad Request` accompanied by a friendly error message formatted in KakaoTalk Bot template style.
- **Asynchronous Task Triggering**:
  - A unique `taskId` is generated using a timestamp and a random integer: ``task-${Date.now()}-${Math.floor(Math.random() * 1000)}``.
  - To prevent concurrent conflicting flows for the same user (re-approval cancellation), the server sweeps the in-memory tasks list and cancels any active task (`RUNNING` or `PAUSED_SECURITY`) associated with the same user ID (translated to the email `[userId]@example.com`).
  - The task is registered in `taskManager` via `taskManager.createTask(taskId, formData)` with preset parameters.
  - Playwright browser automation is invoked asynchronously: `runAutomation(taskId, serverPort).catch(...)` to prevent blocking the webhook's HTTP response.
- **Output JSON Structure**:
  - The endpoint returns a `200 OK` status with a standard KakaoTalk `version 2.0` response template featuring a `simpleText` block containing the generated `taskId`.

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

---

## 2. Automation Resume & Status API Contracts
The external management endpoints facilitate interacting with paused tasks and monitoring active execution progress.

### Automation Resume API (`POST /api/automation/resume`)
- **Path**: `POST /api/automation/resume`
- **Request Body**:
  ```json
  {
    "taskId": "task-123",
    "captchaCode": "123456"
  }
  ```
- **Error and Status Mapping**:
  - **400 Bad Request**: If `taskId` or `captchaCode` are missing, or if the task is not in `PAUSED_SECURITY` status, or if the provided captcha does not match the target task's generated `correctCaptcha`.
  - **404 Not Found**: If the `taskId` is not found in the `taskManager` registry.
  - **200 OK**: On successful captcha validation. Returns `{ success: true, message: "Resume signal received. Processing captcha..." }`.

### Task Status Monitoring API (`GET /api/automation/status/:taskId`)
- **Path**: `GET /api/automation/status/:taskId`
- **Response Format**:
  ```json
  {
    "taskId": "task-123",
    "status": "RUNNING" | "PAUSED_SECURITY" | "COMPLETED" | "FAILED",
    "currentUrl": "http://localhost:3000/secure.html",
    "error": null
  }
  ```
- **Verification & Safety**:
  - The route handles special characters safely using standard Express parameters routing. Since `taskManager.getTask` performs a hash map look-up and avoids disk IO, it is immune to directory traversal. Unknown IDs safely yield a `404 Not Found` response.

---

## 3. Server Integration with `taskManager.js` & Playwright
The flow diagram below demonstrates how the server integrates with the `TaskManager` class and the Playwright driver during execution.

```
 KakaoTalk Webhook               Express Server                  TaskManager                     Playwright
        |                              |                              |                              |
        |--- POST /api/kakao/webhook ->|                              |                              |
        |    (Utterance: "승인")       |--- createTask(taskId) ------>|                              |
        |<-- 200 OK (w/ Task ID) ------|                              |                              |
        |                              |--- runAutomation() ---------------------------------------->|
        |                              |                              |                              | (Navigates to form.html)
        |                              |                              |                              | (Submits Form)
        |                              |                              |<-- pauseTask(taskId) --------| (Redirects to secure.html)
        |                              |                              |    (Status: PAUSED_SECURITY) |
        |                              |                              |                              | [Browser execution suspended]
        |                              |<-- GET /api/automation/status---|                           |
        |                              |    (Returns: PAUSED_SECURITY)|                              |
        |--- POST /resume ------------>|                              |                              |
        |    (w/ Captcha Code)         |--- resumeTask(taskId) ------>|                              |
        |                              |                              |--- [Resolves deferred] ----->|
        |                              |                              |                              | [Resumes execution]
        |                              |                              |                              | (Fills captcha & submits)
        |                              |                              |<-- completeTask(taskId) -----| (Redirects to success.html)
        |                              |                              |    (Status: COMPLETED)       |
        |                              |                              |                              | [Browser closes]
```

---

## 4. Resolving Milestone I1 Issues

The four critical implementation bugs identified during Milestone I1 are detailed below with their root causes and verified architectural fixes.

### Issue 1: Task Cancellation & Playwright Browser Hang
- **Root Cause**: `taskManager.cancelTask` resolves the task's deferred promise with the string `'CANCELLED'` to unblock the browser. However, `browser.js` does not check for this signal and proceeds to fill the captcha field with `'CANCELLED'`. Since `'CANCELLED'` is not the correct captcha, the mock verification handler returns a `400 Bad Request` instead of redirecting. Consequently, `page.waitForNavigation()` in `browser.js` hangs indefinitely.
- **Architectural Fix**:
  In `src/automation/browser.js`, explicitly check the resolved value from `pauseTask`. If it equals `'CANCELLED'`, throw a cancellation error immediately. This terminates the function and runs the `finally` block to close the browser safely.
  ```javascript
  const captchaCode = await taskManager.pauseTask(taskId);
  if (captchaCode === 'CANCELLED') {
    throw new Error('Task was cancelled');
  }
  ```

### Issue 2: Double-Pause Promise/Memory Leak
- **Root Cause**: Calling `taskManager.pauseTask` twice on the same active task overwrites `task.deferred` with a new deferred promise without resolving or rejecting the first one. The first promise hangs in memory indefinitely, causing a memory and resource leak.
- **Architectural Fix**:
  Modify `pauseTask` in `src/automation/taskManager.js` to inspect `task.deferred`. If it exists, resolve it with `'CANCELLED'` (or reject it) before overwriting it.
  ```javascript
  if (task.deferred) {
    task.deferred.resolve('CANCELLED');
  }
  ```
- **Test Adjustment Note**:
  The existing tests in `tests/challenger_I1_4.test.js` (Test 3) and `tests/adversarial.test.js` (Section 2, Test 4) explicitly assert that the first promise hangs indefinitely on double pause (`assert.strictEqual(raceRes, 'hang')`). When implementing the leak fix, these test assertions must be updated to expect the first promise to resolve to `'CANCELLED'` or reject.

### Issue 3: Task State Pollution
- **Root Cause**: The mock form submission endpoint `/api/submit-form` updates the task's `formData` values without checking if the task is in a terminal state (`COMPLETED` or `FAILED`), corrupting completed execution logs.
- **Architectural Fix**:
  Add status checks in the form submission handler in `src/server.js`:
  ```javascript
  if (task.status === 'COMPLETED' || task.status === 'FAILED') {
    return res.status(400).send(`Cannot submit form for task in terminal state: ${task.status}`);
  }
  ```

### Issue 4: Email Validation Mismatch & Playwright Form Submission Hang
- **Root Cause**: The Express server implements a loose validation check (`!email.includes('@')`) for the loan applicant's email address. The HTML5 form markup in `form.html`, however, enforces stricter browser-side `<input type="email">` validation. When the automation script attempts to submit an email that satisfies the server but fails the HTML5 criteria (e.g., `invalid-email@`), the browser validation tooltip blocks submission. Because the form never submits, `page.waitForNavigation()` in `browser.js` hangs until the Playwright timeout (30 seconds).
- **Architectural Fix**:
  1. **Align validation regexes**: Update server-side validation using a standard email regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` to fail early.
  2. **Browser Validation Pre-check**: In `src/automation/browser.js`, evaluate the HTML5 validity of the form programmatically prior to calling the click event. If the form is invalid, throw a browser validation error instantly to prevent page submission blocks.
     ```javascript
     const isValid = await page.evaluate(() => {
       const form = document.querySelector('#loan-form');
       return form ? form.checkValidity() : true;
     });
     if (!isValid) {
       throw new Error('Form validation failed in browser');
     }
     ```
