# Technical Design & Implementation Strategy: Mock Web App & Task Manager (Milestone I1)

This document outlines the detailed design and implementation strategy for **Milestone I1: Mock Web App & Task Manager** of the KakaoTalk Admin Assistant project. 

---

## 1. Mock Web Application Flow Design

The mock web application simulates the target "청년 맞춤형 전월세 대출" (Youth Deposit Loan) application form. It is comprised of three static HTML pages hosted in the `/src/public` directory and served by the Express server.

### Page Flow Layout
1. **`form.html` (Application Form)**: Captures applicant details (Name, SSN, Phone, Loan Amount) and submission consent. Upon submission, it navigates to the security verification page.
2. **`secure.html` (CAPTCHA Security Gate)**: Generates and displays a random CAPTCHA code. It pauses browser automation, expecting a resume signal with the correct code. Once entered and validated by the page's script, it redirects to the success page.
3. **`success.html` (Application Confirmation)**: Displays a success confirmation along with the details submitted in the form, extracted dynamically from the URL query parameters.

### HTML Document Designs & Implementations

#### A. `/src/public/form.html`
Designed as a clean, realistic Korean banking/loan application form.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>청년 맞춤형 전월세 대출 신청</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; max-width: 500px; margin: 40px auto; background-color: #f9f9fc; color: #333; }
        .card { background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        h2 { margin-top: 0; color: #111; border-bottom: 2px solid #fee500; padding-bottom: 10px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 8px; font-weight: 600; font-size: 14px; }
        input[type="text"], input[type="number"], input[type="tel"] { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; font-size: 15px; }
        input[type="text"]:focus, input[type="number"]:focus, input[type="tel"]:focus { border-color: #fee500; outline: none; box-shadow: 0 0 0 3px rgba(254, 229, 0, 0.3); }
        .checkbox-group { display: flex; align-items: flex-start; margin-top: 15px; }
        .checkbox-group input { margin-right: 10px; margin-top: 3px; }
        .checkbox-group label { font-weight: normal; font-size: 13px; cursor: pointer; }
        button { padding: 12px 20px; background-color: #fee500; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; width: 100%; margin-top: 20px; transition: background-color 0.2s; }
        button:hover { background-color: #e6ce00; }
    </style>
</head>
<body>
    <div class="card">
        <h2>청년 맞춤형 전월세 대출 신청</h2>
        <form id="loanForm" action="/secure.html" method="GET">
            <div class="form-group">
                <label for="name">이름 (실명)</label>
                <input type="text" id="name" name="name" required placeholder="홍길동">
            </div>
            <div class="form-group">
                <label for="ssn">주민등록번호</label>
                <input type="text" id="ssn" name="ssn" required placeholder="000101-3012345">
            </div>
            <div class="form-group">
                <label for="phone">휴대폰 번호</label>
                <input type="tel" id="phone" name="phone" required placeholder="010-1234-5678">
            </div>
            <div class="form-group">
                <label for="amount">대출 신청 금액 (원)</label>
                <input type="number" id="amount" name="amount" required placeholder="100000000">
            </div>
            <div class="checkbox-group">
                <input type="checkbox" id="agree" name="agree" required>
                <label for="agree">[필수] 개인정보 수집·이용 동의 및 신용정보 조회 동의서에 동의합니다.</label>
            </div>
            <button type="submit" id="submitBtn">대출 신청하기</button>
        </form>
    </div>
</body>
</html>
```

#### B. `/src/public/secure.html`
This page serves as the security prompt. It uses client-side JavaScript to render a dynamic CAPTCHA.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>보안 확인 단계</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; max-width: 500px; margin: 40px auto; background-color: #f9f9fc; color: #333; text-align: center; }
        .card { background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        h2 { margin-top: 0; color: #ff3b30; }
        .captcha-container { background: #f2f2f7; padding: 15px; font-size: 28px; font-weight: bold; letter-spacing: 6px; margin: 20px 0; border: 2px dashed #aeaeae; border-radius: 8px; font-family: monospace; user-select: none; }
        .form-group { margin-bottom: 20px; text-align: left; }
        label { display: block; margin-bottom: 8px; font-weight: 600; font-size: 14px; }
        input[type="text"] { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; font-size: 18px; text-align: center; font-family: monospace; }
        input[type="text"]:focus { border-color: #fee500; outline: none; }
        button { padding: 12px 20px; background-color: #fee500; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; width: 100%; margin-top: 10px; }
        button:hover { background-color: #e6ce00; }
        .error { color: #ff3b30; font-size: 14px; margin-top: 12px; display: none; font-weight: bold; }
    </style>
</head>
<body>
    <div class="card">
        <h2>보안 확인</h2>
        <p>비정상 대출 신청 차단 및 사용자 인증을 위해 아래 보안 문자를 입력해 주세요.</p>
        
        <!-- Displayed captcha -->
        <div class="captcha-container" id="captcha-val">------</div>
        
        <form id="captchaForm">
            <div class="form-group">
                <label for="captcha-input">보안 문자 입력</label>
                <input type="text" id="captcha-input" name="captchaInput" required autocomplete="off" maxlength="6" placeholder="숫자 6자리">
            </div>
            <button type="submit" id="verifyBtn">확인 및 계속</button>
            <div id="error-msg" class="error">보안 문자가 일치하지 않습니다. 다시 입력해 주세요.</div>
        </form>
    </div>

    <script>
        // Check for specific mockCaptcha parameter to support deterministic testing
        const urlParams = new URLSearchParams(window.location.search);
        let captchaCode = urlParams.get('mockCaptcha');
        if (!captchaCode) {
            // Generate a random 6-digit number
            captchaCode = Math.floor(100000 + Math.random() * 900000).toString();
        }
        
        document.getElementById('captcha-val').textContent = captchaCode;

        document.getElementById('captchaForm').addEventListener('submit', function(e) {
            e.preventDefault();
            const inputVal = document.getElementById('captcha-input').value.trim();
            const errorMsg = document.getElementById('error-msg');
            
            if (inputVal === captchaCode) {
                errorMsg.style.display = 'none';
                
                // Carry forward the application query parameters to success page
                const query = window.location.search;
                window.location.href = '/success.html' + (query ? query : '');
            } else {
                errorMsg.style.display = 'block';
            }
        });
    </script>
</body>
</html>
```

#### C. `/src/public/success.html`
Confirms the application has succeeded.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>신청 완료</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; max-width: 500px; margin: 40px auto; background-color: #f9f9fc; color: #333; text-align: center; }
        .card { background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        .success-badge { width: 60px; height: 60px; line-height: 60px; background: #34c759; color: white; border-radius: 50%; font-size: 32px; margin: 0 auto 20px; font-weight: bold; }
        h2 { margin-top: 0; color: #111; }
        .info-box { background: #f2f2f7; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: left; font-size: 14px; }
        .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; }
        .info-row:last-child { margin-bottom: 0; }
        .info-label { color: #666; font-weight: 500; }
        .info-value { font-weight: 600; color: #111; }
    </style>
</head>
<body>
    <div class="card">
        <div class="success-badge">✓</div>
        <h2>대출 신청 완료</h2>
        <p>청년 맞춤형 전월세 대출 심사 신청서가 정상적으로 접수되었습니다.</p>
        
        <div class="info-box">
            <div class="info-row">
                <span class="info-label">이름:</span>
                <span class="info-value" id="display-name">-</span>
            </div>
            <div class="info-row">
                <span class="info-label">신청 금액:</span>
                <span class="info-value"><span id="display-amount">-</span>원</span>
            </div>
        </div>
    </div>

    <script>
        const urlParams = new URLSearchParams(window.location.search);
        document.getElementById('display-name').textContent = urlParams.get('name') || '홍길동';
        const amount = urlParams.get('amount');
        if (amount) {
            document.getElementById('display-amount').textContent = Number(amount).toLocaleString();
        }
    </script>
</body>
</html>
```

---

## 2. Task Manager & Deferred Promises Design

The `taskManager.js` component is responsible for orchestrating the lifecycle of background automation tasks. Headless web automation is inherently asynchronous and long-running. To allow these tasks to be paused mid-flight (e.g., when a CAPTCHA is encountered) and resumed later via an external REST API request, the Task Manager uses **Deferred Promises**.

### Deferred Promise Mechanism
A Deferred Promise exposes a promise's `resolve` and `reject` callbacks to an external context. By holding a reference to these callbacks in a memory store associated with a `taskId`, we can freeze an async execution block (`await deferred.promise`) and selectively resume or fail it from Express router controllers.

### Implementation Blueprint: `/src/automation/taskManager.js`

```javascript
/**
 * Simple Deferred Promise Utility Class
 */
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
        // Holds active tasks in memory keyed by taskId
        // Map<string, object>
        this.tasks = new Map();
    }

    /**
     * Initializes a new task in the registry
     * @param {string} taskId 
     * @returns {object} The initialized task structure
     */
    createTask(taskId) {
        const task = {
            taskId,
            status: 'RUNNING', // 'RUNNING' | 'PAUSED_SECURITY' | 'COMPLETED' | 'FAILED'
            currentUrl: null,
            error: null,
            deferred: null,
            captchaText: null,        // Stores the CAPTCHA string extracted from the secure page
            timeoutId: null           // reference to setTimeout for timeout management
        };
        this.tasks.set(taskId, task);
        return task;
    }

    /**
     * Retrieves a task by ID
     * @param {string} taskId 
     * @returns {object|undefined}
     */
    getTask(taskId) {
        return this.tasks.get(taskId);
    }

    /**
     * Updates a task's progress properties (e.g. currentUrl)
     * @param {string} taskId 
     * @param {object} updates 
     */
    updateTask(taskId, updates) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        Object.assign(task, updates);
    }

    /**
     * Pauses the automation task flow, creating a Deferred Promise.
     * @param {string} taskId 
     * @param {string} captchaText - The CAPTCHA code extracted from secure.html
     * @param {number} timeoutMs - Max duration to wait before auto-timeout (default: 5 minutes)
     * @returns {Promise<string>} A promise that resolves to the user-entered CAPTCHA code
     */
    pauseTask(taskId, captchaText, timeoutMs = 300000) {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        task.status = 'PAUSED_SECURITY';
        task.captchaText = captchaText;
        task.deferred = new Deferred();

        // Safety Timeout to prevent dangling browsers and resource leaks
        task.timeoutId = setTimeout(() => {
            this.failTask(taskId, 'Security verification timed out (no user response within 5 minutes)');
        }, timeoutMs);

        // Return the promise which the automation runner will 'await'
        return task.deferred.promise;
    }

    /**
     * Resumes a paused automation task by resolving its Deferred Promise with the user-submitted CAPTCHA code
     * @param {string} taskId 
     * @param {string} captchaCode 
     */
    resumeTask(taskId, captchaCode) {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        if (task.status !== 'PAUSED_SECURITY' || !task.deferred) {
            throw new Error(`Task ${taskId} is not in PAUSED_SECURITY status`);
        }

        // Clear safety timeout
        if (task.timeoutId) {
            clearTimeout(task.timeoutId);
            task.timeoutId = null;
        }

        task.status = 'RUNNING';
        
        // Resolve the promise which wakes up the browser automation script
        task.deferred.resolve(captchaCode);
        task.deferred = null;
    }

    /**
     * Marks a task as COMPLETED
     * @param {string} taskId 
     */
    completeTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        if (task.timeoutId) {
            clearTimeout(task.timeoutId);
            task.timeoutId = null;
        }

        task.status = 'COMPLETED';
        task.deferred = null;
    }

    /**
     * Marks a task as FAILED and rejects any pending Deferred Promise
     * @param {string} taskId 
     * @param {string} errorMessage 
     */
    failTask(taskId, errorMessage) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        if (task.timeoutId) {
            clearTimeout(task.timeoutId);
            task.timeoutId = null;
        }

        task.status = 'FAILED';
        task.error = errorMessage;

        if (task.deferred) {
            task.deferred.reject(new Error(errorMessage));
            task.deferred = null;
        }
    }
}

module.exports = new TaskManager(); // Export as a singleton
```

---

## 3. Automation Flow Integration Pattern

Here is the flow of control showing how the Express Webhook Router, the Playwright Automation Engine (`browser.js`), and the `taskManager.js` coordinate:

```
[User Chat]                [Express Webhook]               [taskManager]             [browser.js (Playwright)]      [Mock Web Page]
    |                              |                              |                              |                         |
    |--- Approve Policy Suggestion>|                              |                              |                         |
    |                            (Generates taskId)               |                              |                         |
    |                            (Launches runAutomation async)---|----------------------------->|                         |
    |<-- Returns Task ID Response  |                              |                              |                         |
    |                              |                              |                              |                         |
    |                              |                              |                              |                         |
    |                              |                              |--- 1. createTask------------>|                         |
    |                              |                              |                              |--- 2. Opens form.html-->|
    |                              |                              |                              |--- 3. Fills fields----->|
    |                              |                              |                              |--- 4. Submits form----->|
    |                              |                              |                              |                         |
    |                              |                              |                              |<-- 5. secure.html loaded|
    |                              |                              |                              |   (Extracts Captcha text)|
    |                              |                              |<-- 6. pauseTask--------------|                         |
    |                              |                              |    (Sets PAUSED_SECURITY)    |                         |
    |                              |                              |    (Awaits Deferred Promise) |                         |
    |                              |                              |                              |                         |
    |                              |                              |                              |                         |
    |--- Poll Status (Optional)--->|                              |                              |                         |
    |<-- Return "PAUSED_SECURITY"--|--- (Queries task status)---->|                              |                         |
    |    & Captcha Text            |                              |                              |                         |
    |                              |                              |                              |                         |
    |--- POST /resume (Captcha)--->|                              |                              |                         |
    |                              |--- 7. resumeTask------------>|                              |                         |
    |                              |    (Resolves Deferred)       |                              |                         |
    |                              |                              |=======> (Resolves!) =========>                         |
    |                              |                              |                              |--- 8. Types Captcha---->|
    |                              |                              |                              |--- 9. Clicks verify---->|
    |                              |                              |                              |                         |
    |                              |                              |                              |<-- 10. success.html loaded
    |                              |                              |<-- 11. completeTask----------|                         |
    |                              |                              |    (Sets COMPLETED)          |                         |
    |                              |                              |                              |                         |
    v                              v                              v                              v                         v
```

---

## 4. Key Security & Quality Considerations

1. **Safety Timers**: Background browser automation tasks represent valuable CPU and memory resources. To prevent zombie browsers in production/testing, every pause action MUST trigger a background timer (implemented via `setTimeout` inside `pauseTask`) that auto-terminates the browser process if the resume signal is not received within a set limit (e.g. 5 minutes).
2. **Deterministic Captcha Testing**: For testing automation and integration passes without human manual intervention, `secure.html` supports the `mockCaptcha` URL query parameter. This allows E2E test scripts to initialize the secure page with a predefined static captcha code (e.g. `?mockCaptcha=123456`), which allows the tester to verify both the happy path and correct-mismatch rejection boundaries deterministically.
3. **Task-Specific Captcha Extraction**: In production use-cases, the Playwright engine reads the generated captcha code directly from the page DOM (`#captcha-val`) and saves it into the `taskManager` registry. The status-monitoring API can expose this property as `captchaText` under the `PAUSED_SECURITY` state. This makes it trivial for an external agent, bot, or automated tester to retrieve the current CAPTCHA challenge programmatically.
4. **Standard Node.js Single-Threaded Registry**: Since Node.js runs on a single event-loop thread, using an in-memory `Map` inside the singleton `TaskManager` is thread-safe and immune to race conditions. This simplifies integration tremendously compared to multi-threaded environments where mutexes or database locks would be required.
