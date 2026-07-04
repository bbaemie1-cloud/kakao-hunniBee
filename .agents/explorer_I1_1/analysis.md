# Milestone I1 Design Analysis: Mock Web App & Task Manager

This document outlines the architectural design and implementation strategy for **Milestone I1: Mock Web App & Task Manager** of the KakaoTalk Admin Assistant sub-project. 

---

## 1. Executive Summary

Milestone I1 provides the core foundational components for the headless browser automation and human-in-the-loop (HITL) flow. It establishes:
1. **Mock Web Application Pages** (`form.html`, `secure.html`, `success.html`) which simulate a Youth Loan application, including form fields and a security captcha check.
2. **Task Manager** (`taskManager.js`) which manages active automation tasks and utilizes the **Deferred Promise** pattern to suspend and resume the Playwright automation flow.

This design enables a clean partition of responsibilities: the browser automation script runs asynchronously, pauses upon hitting security barriers, and resumes instantly when the webhook / API signals that the user has verified the request.

---

## 2. Mock Web App Flow Simulation Design

The mock web application will be hosted as static assets served by Express from the `src/public/` folder. The application simulates the step-by-step flow of the "청년 맞춤형 전월세 대출" (Youth rent/deposit loan) application.

### A. Flow Progression Diagram
```
[Start Task]
     │
     ▼
┌──────────────┐
│  form.html   │ ──(Submit Applicant Details)──> [POST /api/form/submit]
└──────────────┘                                          │
                                                          ▼
┌──────────────┐                                   (HTTP Redirect)
│ secure.html  │ <──(Pause automation & wait)─────────────┘
└──────────────┘
     │
     │ (User Resume Signal / Solve Captcha)
     ▼
[POST /api/secure/submit]
     │
     ▼
┌──────────────┐
│ success.html │
└──────────────┘
```

### B. Interface Layout and Markup Design

To make Playwright selectors clean, reliable, and decoupled from styling changes, each page utilizes explicit HTML `id` attributes.

#### 1. `form.html` (Youth Loan Form)
- **Path**: `src/public/form.html`
- **Purpose**: Collects name, age, income, and requested loan amount.
- **Implementation**:
  ```html
  <!DOCTYPE html>
  <html lang="ko">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>청년 맞춤형 전월세 대출 신청</title>
      <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #f5f7fa; padding: 40px; }
          .container { max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          h1 { font-size: 24px; margin-bottom: 20px; color: #333; text-align: center; }
          .form-group { margin-bottom: 15px; }
          label { display: block; margin-bottom: 5px; font-weight: bold; color: #555; }
          input[type="text"], input[type="number"] { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
          button { width: 100%; padding: 12px; background-color: #fee500; border: none; border-radius: 4px; font-size: 16px; font-weight: bold; cursor: pointer; color: #191919; }
          button:hover { background-color: #f7e100; }
      </style>
  </head>
  <body>
      <div class="container">
          <h1>청년 맞춤형 전월세 대출 신청</h1>
          <form id="loanForm" action="/api/form/submit" method="POST">
              <input type="hidden" name="taskId" id="taskId">
              <div class="form-group">
                  <label for="name">이름 (Name)</label>
                  <input type="text" id="name" name="name" required placeholder="홍길동">
              </div>
              <div class="form-group">
                  <label for="age">만 나이 (Age)</label>
                  <input type="number" id="age" name="age" required placeholder="25">
              </div>
              <div class="form-group">
                  <label for="income">연소득 (Annual Income - 만원)</label>
                  <input type="number" id="income" name="income" required placeholder="3000">
              </div>
              <div class="form-group">
                  <label for="loanAmount">신청 대출 금액 (Loan Amount - 만원)</label>
                  <input type="number" id="loanAmount" name="loanAmount" required placeholder="10000">
              </div>
              <button type="submit" id="submit-btn">대출 신청하기</button>
          </form>
      </div>
      <script>
          // Extract taskId from URL parameters and inject into hidden form field
          const urlParams = new URLSearchParams(window.location.search);
          const taskId = urlParams.get('taskId');
          if (taskId) {
              document.getElementById('taskId').value = taskId;
          }
      </script>
  </body>
  </html>
  ```

#### 2. `secure.html` (Captcha Gate)
- **Path**: `src/public/secure.html`
- **Purpose**: Displays a captcha code (`123456` as static simulation or dynamically generated value) requiring input verification.
- **Implementation**:
  ```html
  <!DOCTYPE html>
  <html lang="ko">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>보안 확인 (Captcha)</title>
      <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #f5f7fa; padding: 40px; }
          .container { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
          h1 { font-size: 22px; margin-bottom: 20px; color: #d9534f; }
          p { color: #666; font-size: 14px; margin-bottom: 20px; }
          .captcha-box { background-color: #eaeaea; font-size: 28px; font-weight: bold; letter-spacing: 5px; padding: 15px; border-radius: 4px; margin-bottom: 20px; font-family: monospace; user-select: none; }
          .form-group { margin-bottom: 15px; text-align: left; }
          label { display: block; margin-bottom: 5px; font-weight: bold; color: #555; }
          input[type="text"] { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; font-size: 18px; text-align: center; }
          button { width: 100%; padding: 12px; background-color: #fee500; border: none; border-radius: 4px; font-size: 16px; font-weight: bold; cursor: pointer; color: #191919; }
          button:hover { background-color: #f7e100; }
          .error { color: red; font-size: 13px; margin-bottom: 10px; }
      </style>
  </head>
  <body>
      <div class="container">
          <h1>보안 확인</h1>
          <p>안전한 진행을 위해 화면에 보이는 보안문자를 입력해주세요.</p>
          <div id="captcha-image" class="captcha-box">123456</div>
          <form id="captchaForm" action="/api/secure/submit" method="POST">
              <input type="hidden" name="taskId" id="taskId">
              <div class="error" id="errorMessage"></div>
              <div class="form-group">
                  <label for="captcha-input">보안문자 입력</label>
                  <input type="text" id="captcha-input" name="captchaCode" required autocomplete="off" placeholder="숫자 6자리">
              </div>
              <button type="submit" id="verify-btn">확인 및 완료</button>
          </form>
      </div>
      <script>
          const urlParams = new URLSearchParams(window.location.search);
          const taskId = urlParams.get('taskId');
          if (taskId) {
              document.getElementById('taskId').value = taskId;
          }
          const error = urlParams.get('error');
          if (error) {
              document.getElementById('errorMessage').innerText = decodeURIComponent(error);
          }
      </script>
  </body>
  </html>
  ```

#### 3. `success.html` (Success Confirmation)
- **Path**: `src/public/success.html`
- **Purpose**: Displays the confirmation message after submitting valid security credentials.
- **Implementation**:
  ```html
  <!DOCTYPE html>
  <html lang="ko">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>신청 완료</title>
      <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #f5f7fa; padding: 40px; }
          .container { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
          h1 { font-size: 24px; margin-bottom: 20px; color: #4cae4c; }
          p { color: #333; font-size: 16px; margin-bottom: 30px; }
          .success-icon { font-size: 60px; color: #5cb85c; margin-bottom: 20px; }
          .task-info { background-color: #f9f9f9; padding: 15px; border-radius: 4px; border: 1px solid #eee; font-size: 14px; color: #555; text-align: left; }
      </style>
  </head>
  <body>
      <div class="container">
          <div class="success-icon">✓</div>
          <h1>신청 완료</h1>
          <p>청년 맞춤형 전월세 대출 신청이 성공적으로 접수되었습니다.</p>
          <div class="task-info">
              <strong>작업 ID:</strong> <span id="display-task-id">-</span><br>
              <strong>상태:</strong> 신청 완료 (COMPLETED)
          </div>
      </div>
      <script>
          const urlParams = new URLSearchParams(window.location.search);
          const taskId = urlParams.get('taskId');
          if (taskId) {
              document.getElementById('display-task-id').innerText = taskId;
          }
      </script>
  </body>
  </html>
  ```

---

## 3. Task Manager Architecture & Deferred Promise Mechanism

The headless browser automation must pause execution mid-flow when it encounters `secure.html`. In Node.js, we can suspend an asynchronous execution thread elegantly by awaiting a promise that is resolved out-of-context.

### A. The Deferred Promise Pattern

A Deferred Promise extracts the `resolve` and `reject` controls of a standard Javascript Promise, allowing it to be stored globally or in-memory, and called later by external event triggers (e.g. an incoming HTTP request).

```javascript
class Deferred {
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}
```

### B. Implementation of `taskManager.js`
- **Path**: `src/automation/taskManager.js`
- **Key Methods**:
  - `createTask(taskId)`: Initializes task state.
  - `getTask(taskId)`: Returns state representation (safe for API response).
  - `pauseTask(taskId, currentUrl, captchaCode)`: Transitions status to `PAUSED_SECURITY`, creates a `Deferred` instance, and returns the promise to suspend the browser script.
  - `resumeTask(taskId, captchaCode)`: Resolves the `Deferred` promise with the user-provided code, resuming browser execution.
  - `completeTask(taskId, currentUrl)`: Sets task to success.
  - `failTask(taskId, error)`: Rejects the deferred promise and flags task as failed.

Here is the proposed design for `taskManager.js`:

```javascript
class Deferred {
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}

class TaskManager {
    constructor() {
        this.tasks = new Map();
    }

    /**
     * Initializes a new task tracking instance.
     */
    createTask(taskId) {
        const task = {
            taskId,
            status: 'RUNNING',
            currentUrl: null,
            captchaCode: null,
            deferred: null,
            error: null
        };
        this.tasks.set(taskId, task);
        return task;
    }

    /**
     * Retrieves the status representation of a task.
     * Safe to be exposed over API (excludes the internal deferred promise).
     */
    getTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return null;
        return {
            taskId: task.taskId,
            status: task.status,
            currentUrl: task.currentUrl,
            captchaCode: task.captchaCode,
            error: task.error
        };
    }

    /**
     * Pauses the task and returns a promise that blocks the executing runner.
     */
    async pauseTask(taskId, currentUrl, captchaCode) {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        task.status = 'PAUSED_SECURITY';
        task.currentUrl = currentUrl;
        task.captchaCode = captchaCode; // Captures captcha text extracted from the mock UI page

        // Create new Deferred promise
        task.deferred = new Deferred();

        // Return the promise which the Playwright runner will await
        return task.deferred.promise;
    }

    /**
     * Resumes a paused task by resolving the deferred promise.
     */
    resumeTask(taskId, captchaCode) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return { success: false, message: `Task ${taskId} not found` };
        }
        if (task.status !== 'PAUSED_SECURITY' || !task.deferred) {
            return { success: false, message: `Task ${taskId} is not in a paused state` };
        }

        task.status = 'RUNNING';
        
        // Resolve the deferred promise with the captcha code.
        // This wakes up the Playwright script and supplies the input value.
        task.deferred.resolve(captchaCode);
        task.deferred = null;

        return { success: true, message: 'Resume signal received. Processing captcha...' };
    }

    /**
     * Completes the task.
     */
    completeTask(taskId, currentUrl) {
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'COMPLETED';
            task.currentUrl = currentUrl;
            task.captchaCode = null;
            if (task.deferred) {
                task.deferred.resolve();
                task.deferred = null;
            }
        }
    }

    /**
     * Fails the task and rejects any active deferred promise.
     */
    failTask(taskId, errorMsg) {
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'FAILED';
            task.error = errorMsg;
            if (task.deferred) {
                task.deferred.reject(new Error(errorMsg));
                task.deferred = null;
            }
        }
    }
}

module.exports = new TaskManager();
```

---

## 4. Playwright Coordination Flow & Error Paths

When implementation begins, the browser automation script (`src/automation/browser.js`) will integrate with the task manager as follows:

```javascript
const taskManager = require('./taskManager');

async function runAutomation(taskId, mockData) {
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // Step 1: Initialize
        taskManager.createTask(taskId);

        // Step 2: Form navigation & inputs
        await page.goto(`http://localhost:3000/form.html?taskId=${taskId}`);
        await page.fill('#name', mockData.name);
        await page.fill('#age', String(mockData.age));
        await page.fill('#income', String(mockData.income));
        await page.fill('#loanAmount', String(mockData.loanAmount));
        await page.click('#submit-btn');

        // Step 3: Wait for redirection to secure.html
        await page.waitForURL(url => url.pathname.includes('/secure.html'));

        // Step 4: Extract mock captcha display text
        const captchaCode = await page.innerText('#captcha-image');

        // Step 5: Pause and Wait for Resume API
        // This line awaits the deferred promise.
        const solvedCaptcha = await taskManager.pauseTask(taskId, page.url(), captchaCode);

        // Step 6: Resume execution using resolved captchaCode
        await page.fill('#captcha-input', solvedCaptcha);
        await page.click('#verify-btn');

        // Step 7: Wait for redirection to success.html
        await page.waitForURL(url => url.pathname.includes('/success.html'));

        // Step 8: Complete
        taskManager.completeTask(taskId, page.url());

    } catch (err) {
        // Step 9: Handle errors/crashes
        taskManager.failTask(taskId, err.message);
    } finally {
        await browser.close();
    }
}
```

### Critical Edge Cases Addressed:
1. **Resume API Request on Unpaused Task**: If a user submits a resume API request before the browser script registers as `PAUSED_SECURITY`, the `resumeTask()` function will immediately return a `400 Bad Request` styled error response instead of throwing a server crash.
2. **Playwright Timeout or Selector Failure**: If Playwright fails to load a page, fails to find selectors, or encounters a navigation timeout, the entire execution block drops to the `catch(err)` block. This calls `taskManager.failTask()`, which rejects the deferred promise (preventing leakages) and sets the task status to `FAILED`, exposing the error string on the status monitoring API.
3. **Memory Cleanup**: Active Deferred references are removed (`task.deferred = null`) on both success and failure, ensuring that the JavaScript garbage collector can clean up spent objects.

---

## 5. Verification Plan

To verify this architecture independently, the following methods are recommended:
1. **Unit Verification of taskManager**: Verify `taskManager.js` functions sequentially (Create -> Pause -> check state -> Resume with mock captcha -> verify state changes back to RUNNING -> Complete -> verify final status).
2. **Local Mock Page Tests**: Verify that the HTML pages function with standard browser navigations and correctly pass query string variables (`taskId`).
