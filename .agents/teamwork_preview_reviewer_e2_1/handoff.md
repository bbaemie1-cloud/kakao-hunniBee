# E2E Testing Infrastructure Review & Adversarial Challenge Report

## 1. Observation

Direct observations made upon inspecting the codebase:

### File Paths and Details:
- **`package.json`**: Contains standard scripts and dependencies (`express` and `playwright`).
- **`tests/e2e_runner.js`**: Spawns mock server, waits for the TCP port to open using `net.Socket`, spawns native test runner (`node --test`), and kills the server on test completion.
- **Test Files**: Four files containing 38 tests total:
  - `tests/tier1_coverage.test.js` (15 tests)
  - `tests/tier2_boundary.test.js` (15 tests)
  - `tests/tier3_combination.test.js` (3 tests)
  - `tests/tier4_workload.test.js` (5 tests)
- **`TEST_INFRA.md` & `TEST_READY.md`**: Well-written documentation outlining feature inventories, execution paths, and readiness indicators.

### Re-approval Cancellation Patch Implementation:
- **`src/server.js` (lines 47-53)**:
  ```javascript
  // Cancel any existing active tasks for the same user to handle re-approval cancellation
  const userEmail = `${user.id}@example.com`;
  for (const t of taskManager.tasks.values()) {
    if (t.formData && t.formData.email === userEmail && (t.status === 'RUNNING' || t.status === 'PAUSED_SECURITY')) {
      taskManager.cancelTask(t.taskId, 'Cancelled by new re-approval request');
    }
  }
  ```
- **`src/automation/taskManager.js` (lines 129-146)**:
  ```javascript
  cancelTask(taskId, reason = 'Cancelled') {
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: 'Task not found' };
    if (task.status === 'COMPLETED' || task.status === 'FAILED') {
      return { success: false, error: `Task is already in terminal state: ${task.status}` };
    }
    task.status = 'FAILED';
    task.error = reason;
    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
      task.timeoutId = null;
    }
    if (task.deferred) {
      task.deferred.resolve('CANCELLED');
      task.deferred = null;
    }
    return { success: true, message: `Task ${taskId} cancelled successfully` };
  }
  ```
- **`src/automation/browser.js` (lines 33-42, 55-60)**:
  ```javascript
    if (currentUrl.includes('secure.html')) {
      // Pause task waiting for resume
      const captchaCode = await taskManager.pauseTask(taskId);

      // Once resolved, type captcha code and submit
      await page.fill('#captcha', captchaCode);
      
      await Promise.all([
        page.click('#verify-btn'),
        page.waitForNavigation()
      ]);
  ...
  } catch (err) {
    taskManager.updateTask(taskId, { status: 'FAILED', error: err.message });
  }
  ```
- **`src/public/secure.html` (lines 180-189)**:
  ```javascript
    // Also support form action fallback for verify-btn which is type="submit"
    document.getElementById('captcha-form').addEventListener('submit', (e) => {
      const val = document.getElementById('captcha').value.trim();
      const errorMsg = document.getElementById('error-msg');
      if (val !== targetCaptcha) {
        e.preventDefault();
        errorMsg.textContent = 'Captcha code mismatch';
        errorMsg.style.display = 'block';
      }
    });
  ```

---

## 2. Logic Chain

### Reasoning on Task Cancellation Race Condition (`RUNNING` status):
1. **Observation**: When a user triggers a re-approval, the webhook calls `taskManager.cancelTask` on any active task with a matching email. If that task is in the `RUNNING` status (has not reached the captcha page yet), its status in `taskManager` changes to `FAILED`.
2. **Observation**: `cancelTask` has no way to terminate the running Playwright thread, as there is no active `task.deferred` promise (it is `null` during form filling).
3. **Observation**: The browser thread continues execution, eventually loads `secure.html`, and executes `taskManager.pauseTask(taskId)`.
4. **Observation**: `taskManager.pauseTask` changes the task status to `'PAUSED_SECURITY'` unconditionally:
   ```javascript
   pauseTask(taskId, captchaText, timeoutMs = 300000) {
     const task = this.getTask(taskId);
     if (!task) throw new Error(`Task ${taskId} not found`);
     task.status = 'PAUSED_SECURITY';
     ...
   ```
5. **Deduction**: The status changes from `FAILED` (cancelled) back to `PAUSED_SECURITY`. The cancelled task now waits for a captcha resume, rendering the cancellation ineffective and leaking the task.

### Reasoning on Browser Thread Hang and Error Overwrite (`PAUSED_SECURITY` status):
1. **Observation**: When `cancelTask` is called on a task that is already `PAUSED_SECURITY`, it resolves the deferred promise with `'CANCELLED'`.
2. **Observation**: The browser thread resumes, receives `'CANCELLED'` as `captchaCode`, fills it into `#captcha`, and clicks `#verify-btn` while waiting for navigation (`page.waitForNavigation()`).
3. **Observation**: `secure.html` intercepts the form submission, detects that the captcha value (`'CANCELLED'`) does not match the correct captcha (a 6-digit random number), and calls `e.preventDefault()`, stopping navigation.
4. **Observation**: Because navigation is prevented, Playwright's `page.waitForNavigation()` hangs for its default timeout of 30 seconds, keeping Chromium open and leaking resources.
5. **Observation**: When the timeout expires, it throws an error which is caught in the `catch (err)` block of `browser.js`.
6. **Observation**: The catch block calls `taskManager.updateTask(taskId, { status: 'FAILED', error: err.message })`.
7. **Deduction**: The initial error reason (`'Cancelled by new re-approval request'`) is overwritten with a Playwright timeout error (e.g. `'page.waitForNavigation: Timeout 30000ms exceeded.'`). The user/system loses the information that the task was cancelled, and resource usage spikes.

---

## 3. Caveats

- **Test Execution**: The terminal command `npm test` timed out on permission validation (due to system configuration constraints). Independent verification of test executions was performed statically by tracing assertions and flow logic.
- **Other Files**: Challenger tests (`tests/challenger_I1_2.test.js`) and adversarial tests (`tests/adversarial.test.js`) are in the repository but not executed by `e2e_runner.js`. Our review concentrates on the 38 tests executed by `e2e_runner.js` and the main codebase.

---

## 4. Conclusion & Review Report

**Verdict**: **REQUEST_CHANGES**

### Quality Review Report

#### Findings:

##### [Major] Finding 1: Cancelled Task Status Reversion (Race Condition)
- **What**: A task cancelled while in the `RUNNING` state (prior to loading the captcha page) will revert to the `PAUSED_SECURITY` status once the browser reaches the captcha page.
- **Where**: `src/automation/taskManager.js` (lines 35–64) and `src/automation/browser.js`.
- **Why**: Allows cancelled tasks to reappear as active, violating state machine integrity.
- **Suggestion**: Check if `task.status === 'FAILED'` inside `pauseTask` and abort early. Also, check the task status in `browser.js` before calling `pauseTask`.

##### [Major] Finding 2: Browser Hang and Status Overwrite upon Cancellation
- **What**: Cancelling a task while it is paused resolves the promise with `'CANCELLED'`, causing Playwright to type it and trigger a form submission that is blocked. Playwright hangs for 30s and then overwrites the cancellation reason with a navigation timeout.
- **Where**: `src/automation/browser.js` (lines 34–60) and `src/public/secure.html` (lines 180–189).
- **Why**: Overwrites the audit log/reason of cancellation, and leaves headless browser processes running unnecessarily.
- **Suggestion**:
  - In `browser.js`, check if the resolved promise value from `pauseTask` is `'CANCELLED'` and abort immediately.
  - In the catch block of `browser.js`, do not overwrite the status/error if the task status is already `FAILED`.

##### [Minor] Finding 3: Lack of Terminal State Checks in Form Submission APIs
- **What**: `/api/submit-form` does not check if the task is already completed or failed, allowing form details of finished tasks to be overwritten.
- **Where**: `src/server.js` (lines 141-171).
- **Why**: State pollution vulnerability.
- **Suggestion**: Add checks to ensure tasks are in the correct state (`RUNNING` or `PAUSED_SECURITY`) before accepting form modifications.

---

### Adversarial Challenge Report

**Overall risk assessment**: **HIGH**

#### Challenges:

##### [High] Challenge 1: Resource Exhaustion under Frequent Re-approvals
- **Assumption challenged**: Browser processes exit cleanly and immediately when tasks are cancelled.
- **Attack scenario**: A user sends multiple webhook "승인" requests in rapid succession. This triggers multiple cancellations.
- **Blast radius**: Each cancelled task spawns a Chromium instance that hangs for 30 seconds before timing out and closing. A high frequency of requests will leak active Chromium instances, causing memory and CPU exhaustion.
- **Mitigation**: Resolve the deferred promise with a rejection or check for the `'CANCELLED'` sentinel value inside the browser automation runner to close the browser immediately.

##### [Medium] Challenge 2: State Integrity Bypass via Direct Post-Cancellation API Calls
- **Assumption challenged**: Once a task fails/cancels, its state transitions stop.
- **Attack scenario**: An external client calls `/api/automation/resume` or submits `/api/submit-form` targeting a task that has already been marked as `FAILED` (due to cancellation).
- **Blast radius**: The state transitions back to `RUNNING` or page redirection succeeds, polluting completed workflow datasets.
- **Mitigation**: Enforce strict status validation in all state-changing endpoints in `src/server.js`.

---

## 5. Verification Method

To verify the test suite and confirm fixes for the race conditions:
1. Run the test command:
   ```bash
   npm test
   ```
2. Inspect the output to ensure that all 38 tests pass.
3. Validate that after task cancellation, the task status remains `FAILED` with the message `'Cancelled by new re-approval request'` even after waiting 35 seconds (to allow any potential Playwright timeouts to occur).
4. Monitor active Node.js / Chromium processes to ensure they terminate immediately upon cancellation.
