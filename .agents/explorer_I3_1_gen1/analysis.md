# Milestone I3 Analysis: Playwright Automation Flow

This report contains a read-only investigation and analysis of the Playwright automation flow implementation for Milestone I3 in the KakaoTalk Admin Assistant project.

---

## 1. Executive Summary
The Playwright automation flow (`src/automation/browser.js`), task manager (`src/automation/taskManager.js`), mock server (`src/server.js`), and mock web pages (`src/public/`) are implemented and function correctly under normal operating conditions and happy paths. However, several logic gaps, unnecessary timeout delays on error states, and hardcoded variables exist that limit the robustness and testability of the automation flow during edge cases and validation failures.

---

## 2. Compliance with PROJECT.md and SCOPE.md
The automation flow meets the structural contracts defined in the project files:
1. **Webhook Interface (R1)**: Correctly triggers background automation via `runAutomation(taskId, serverPort)` and responds to the KakaoTalk webhook format with the generated `taskId`.
2. **Automation Resume (R3)**: Exposes `/api/automation/resume` and resumes the blocked browser thread using the correct captcha code, transition to `COMPLETED` when navigation lands on `success.html`.
3. **Status Monitoring**: Exposes `/api/automation/status/:taskId`, reporting `RUNNING`, `PAUSED_SECURITY`, `COMPLETED`, and `FAILED` states dynamically.

---

## 3. Code Review & Findings

### A. `src/automation/browser.js`
- **Dynamic Input & Fallbacks**: The script successfully inputs data from `task.formData`. If properties are missing, it uses fallbacks (`name` -> 홍길동, `email` -> hong@example.com, `age` -> 950101-1234567, etc.) to ensure that HTML5 required attributes do not block submission during webhook-initiated flows.
- **Client-Side Form Validation**: Uses `page.evaluate(() => form.checkValidity())` to pre-validate form data before click events, preventing browser hangs. It also attempts to extract specific messages inside the catch block if navigation fails on the form page.
- **Pause/Resume Integration**: Calls `await taskManager.pauseTask(taskId)`, which blocks until the resume API resolves the Deferred Promise with the correct captcha code.
- **Resource Cleanup**: Browser context is closed correctly in a `finally` block, ensuring no zombie processes are left behind on completion or error.

### B. `src/automation/taskManager.js`
- **Deferred Promise Pattern**: Uses an elegant deferred promise implementation to manage `pauseTask` and `resumeTask`.
- **Timeout Management**: Includes a safety timeout (`timeoutMs = 300000`) when a task is paused, transitioning the task to `FAILED` and rejecting the deferred promise to prevent browser hangs.
- **State Guarding**: Restricts resuming to tasks in `PAUSED_SECURITY` status. Prevents state pollution by rejecting resume calls if a task has already completed or failed.
- **Duplicate Prevention**: Clears previous deferred promises/timeouts if `pauseTask` is called twice or if a task is cancelled, resolving them with `'CANCELLED'`.

### C. `src/server.js`
- **Duplicate Webhook Requests**: Successfully cancels active tasks (in `RUNNING` or `PAUSED_SECURITY` status) for the same user if a new webhook request is received, resolving potential concurrency issues.
- **Input Validation**: Validates fields like `name`, `email`, and `amount` during `/api/submit-form`, redirecting to `/secure.html` or returning `400 Bad Request`.
- **Completed Task Guarding**: Rejects form re-submissions if the task is already in a terminal state (`COMPLETED` or `FAILED`), preventing state pollution.

### D. Mock Pages (`form.html`, `secure.html`, `success.html`)
- **Structure**: Forms are well-structured with matching labels (`for="..."` matching `id="..."`) and validation attributes.
- **Inter-process Communications**: `secure.html` loads the captcha code dynamically via `fetch('/api/automation/captcha/' + taskId)`, enabling automated visual checks.

---

## 4. Identified Gaps and Logic Bugs

### Gap 1: Unnecessary Timeout Delay & Raw TimeoutError on Server-Side Validation Errors
- **Observation**: In `browser.js` line 39:
  ```javascript
  await page.click('#submit-btn');
  await page.waitForURL('**/secure.html', { timeout: 3000 });
  ```
  If form submission fails on the server (e.g., negative loan amount `amount = -500`), the server returns `400 Bad Request` and the browser navigates to `http://localhost:3000/api/submit-form`.
  Since the URL is `/api/submit-form` rather than `/secure.html`, `page.waitForURL('**/secure.html')` waits for the full `3000ms` timeout before throwing.
  Then, inside the catch block (line 40-55):
  ```javascript
  } catch (e) {
    const url = page.url();
    if (url.includes('form.html')) {
       // Extract client-side validation message...
    }
    throw e;
  }
  ```
  Because the URL is `/api/submit-form` (not `form.html`), the block throws the raw `TimeoutError` rather than extracting the server's validation error message.
- **Impact**: Server validation errors cause a 3-second hang in the automation flow and result in a generic `TimeoutError: page.waitForURL: Timeout 3000ms exceeded` status update, obscuring the actual cause (e.g. "Amount must be greater than zero").

### Gap 2: Hardcoded Terms Agreement Check
- **Observation**: In `browser.js` line 25:
  ```javascript
  await page.check('#agree');
  ```
  This checkbox is unconditionally checked by the automation.
- **Impact**: It is impossible to test the validation pathway where the user does not agree to the terms, as the browser script will always force check it.

### Gap 3: Missing Timeout on Captcha Navigation
- **Observation**: In `browser.js` lines 70-73:
  ```javascript
  await Promise.all([
    page.click('#verify-btn'),
    page.waitForNavigation()
  ]);
  ```
  `page.waitForNavigation()` has no timeout specified, meaning it will use the default 30-second timeout.
- **Impact**: If the server experiences high load, crashes, or hangs on `/api/submit-captcha`, the automation will remain stuck for up to 30 seconds before timing out, wasting browser resources under load.

---

## 5. Propose Implementation / Fix Strategy

### Fix for Gap 1: Immediate Server-Side Error Detection and Reporting
Modify the form submission wait logic in `src/automation/browser.js` to wait for *either* `/secure.html` or `/api/submit-form`. If it lands on `/api/submit-form`, extract the error message text from the body and throw it immediately.

**Proposed Change in `src/automation/browser.js` (Lines 37-55):**
```javascript
    // Submit the form and wait for the redirect
    try {
      await page.click('#submit-btn');
      
      // Wait for either the secure page or the form submission API (which indicates an error response)
      await page.waitForFunction(() => {
        const url = window.location.href;
        return url.includes('secure.html') || url.includes('api/submit-form');
      }, { timeout: 3000 });

      const url = page.url();
      if (url.includes('api/submit-form')) {
        const serverError = await page.textContent('body');
        throw new Error(`Server-side validation failed: ${serverError.trim()}`);
      }
    } catch (e) {
      const url = page.url();
      if (url.includes('form.html')) {
        const validationMessage = await page.evaluate(() => {
          const nameEl = document.querySelector('#name');
          const emailEl = document.querySelector('#email');
          const amountEl = document.querySelector('#amount');
          if (nameEl && !nameEl.checkValidity()) return `Name validation: ${nameEl.validationMessage}`;
          if (emailEl && !emailEl.checkValidity()) return `Email validation: ${emailEl.validationMessage}`;
          if (amountEl && !amountEl.checkValidity()) return `Amount validation: ${amountEl.validationMessage}`;
          return 'Form validation failed';
        });
        throw new Error(`Client-side validation failed: ${validationMessage}`);
      }
      throw e;
    }
```

### Fix for Gap 2: Dynamic Checkbox Agreement
Make terms agreement configurable via the `task.formData` payload.

**Proposed Change in `src/automation/browser.js` (Line 25):**
```javascript
    if (task.formData.agree !== false) {
      await page.check('#agree');
    }
```

### Fix for Gap 3: Safe Navigation Timeout for Captcha Verification
Add a `5000ms` timeout to the verification navigation wait.

**Proposed Change in `src/automation/browser.js` (Lines 70-73):**
```javascript
      await Promise.all([
        page.click('#verify-btn'),
        page.waitForNavigation({ timeout: 5000 })
      ]);
```
