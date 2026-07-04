# Handoff Report — Challenger 1 (E2E Testing Track)

## 1. Observation

During our static and structural analysis of the KakaoTalk Admin Assistant project, we observed several files, endpoints, and test suites:

1. **Static Port Binding in Test Runner** (`tests/e2e_runner.js`):
   ```javascript
   const PORT = process.env.PORT || 3000;
   ...
   function waitPort(port, host, timeoutMs = 15000) { ... }
   ```
2. **Broken Boundary Tests** (`tests/tier2_boundary.test.js`):
   ```javascript
   test('form submission with empty name returns 400', async () => {
     const res = await fetch(`${BASE_URL}/api/submit-form`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
       body: new URLSearchParams({
         taskId: 'test-boundary-1',
         name: '',
         email: 'test@example.com',
         amount: '1000'
       })
     });
     assert.strictEqual(res.status, 400);
   });
   ```
   Note that `test-boundary-1` is never created in this test file or before hooks via the `/api/test/create-task` endpoint.
3. **Endpoint Validation Order** (`src/server.js`):
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

     // Validate form fields for boundary testing
     if (!name || name.trim().length === 0) { ... }
   ```
4. **Task Cancellation & Promise Resolution** (`src/automation/taskManager.js`):
   ```javascript
   cancelTask(taskId, reason = 'Cancelled') {
     const task = this.getTask(taskId);
     ...
     task.status = 'FAILED';
     task.error = reason;
     ...
     if (task.deferred) {
       task.deferred.resolve('CANCELLED');
       task.deferred = null;
     }
     return { success: true, ... };
   }
   ```
5. **No Status Guard on Pause** (`src/automation/taskManager.js`):
   ```javascript
   pauseTask(taskId, captchaText, timeoutMs = 300000) {
     const task = this.getTask(taskId);
     if (!task) throw new Error(`Task ${taskId} not found`);

     task.status = 'PAUSED_SECURITY';
     ...
   ```
6. **Browser Flow Continuation** (`src/automation/browser.js`):
   ```javascript
   const captchaCode = await taskManager.pauseTask(taskId);
   await page.fill('#captcha', captchaCode);
   await Promise.all([
     page.click('#verify-btn'),
     page.waitForNavigation()
   ]);
   const finalUrl = page.url();
   taskManager.updateTask(taskId, { currentUrl: finalUrl });
   if (finalUrl.includes('success.html')) {
     taskManager.updateTask(taskId, { status: 'COMPLETED' });
   } else {
     taskManager.updateTask(taskId, { status: 'FAILED', error: 'Did not reach success page after verification' });
   }
   ```

---

## 2. Logic Chain

From these observations, we reasoned the following specific failure modes and vulnerabilities:

* **Issue 1: Broken Boundary Tests (Failing Suite)**
  * **Observation**: `tier2_boundary.test.js` submits form data with `taskId: 'test-boundary-1'` which is never registered in `taskManager`.
  * **Logic**: In `server.js`, `/api/submit-form` validates `taskManager.getTask(taskId)` before it checks field constraints (e.g. empty name, invalid email). Because `'test-boundary-1'` is unregistered, the server returns `404 Task not found`.
  * **Result**: The test checks `assert.strictEqual(res.status, 400)` and fails when it receives `404`.

* **Issue 2: Task Cancellation State Corruption (Race Condition)**
  * **Observation**: When `cancelTask` is called for a paused task, it resolves the deferred promise with `'CANCELLED'`.
  * **Logic**: The browser script in `browser.js` resumes with `captchaCode = 'CANCELLED'`, fills the captcha with `'CANCELLED'`, and clicks `#verify-btn`. The server rejects the submit with `400`, but the browser script updates the task: `taskManager.updateTask(taskId, { status: 'FAILED', error: 'Did not reach success page after verification' })`.
  * **Result**: This overwrites the original precise cancellation reason (e.g. `'Cancelled by new re-approval request'`) with a generic browser failure message.

* **Issue 3: Stuck Browser Tasks / Resource Leak (Race Condition)**
  * **Observation**: `pauseTask` does not check if `task.status` is already `FAILED`.
  * **Logic**: If `cancelTask` is called while the task is in `RUNNING` status (e.g. during form filling before reaching captcha), the status is set to `FAILED`. The browser script continues, submits form, redirects to `/secure.html`, and calls `pauseTask`. `pauseTask` then overwrites `task.status` to `PAUSED_SECURITY`, registers a new deferred promise, and waits.
  * **Result**: The task becomes permanently stuck in `PAUSED_SECURITY` since no client will ever resume a cancelled task. The browser process remains open and orphaned for 5 minutes until the safety timeout fires.

* **Issue 4: Playwright Hang on Browser-Server Validation Mismatch**
  * **Observation**: The server checks email loosely with `email.includes('@')`, but the browser checks strictly using HTML5 `type="email"`.
  * **Logic**: An email like `user@` is accepted by the server. When Playwright fills the form and clicks submit, the HTML5 validation blocks form submission in the browser. The page does not navigate, so Playwright's `page.waitForNavigation()` hangs for the default 30 seconds.
  * **Result**: High resource utilization and task hang.

* **Issue 5: Leaked Deferred Promises on Double Pause**
  * **Observation**: Calling `pauseTask` twice replaces `task.deferred`.
  * **Logic**: The first promise is overwritten and lost without being resolved or rejected.
  * **Result**: The first promise and its corresponding browser run hang indefinitely, leading to memory leaks.

* **Issue 6: State Pollution on Terminal Tasks**
  * **Observation**: `updateTask` has no guard against terminal states.
  * **Logic**: A completed/failed task can have its `formData` modified via another POST to `/api/submit-form`.
  * **Result**: Lack of state immutability.

---

## 3. Caveats

* **Command Execution Timeout**: Terminal command execution (`run_command`) timed out on permission prompts in this non-interactive execution environment. We were unable to capture real terminal outputs of the test execution, but the correctness and validity of the failure modes are backed by static analysis and the presence of these tests in `challenger_I1_2.test.js` and `challenger_I1_4.test.js` (written by peer challenger agents).

---

## 4. Conclusion

The E2E test infrastructure contains critical correctness issues and race conditions:
1. **Broken Tests**: Boundary tests in Tier 2 will fail due to task validation ordering.
2. **Resource Leaks**: Cancelled tasks can get permanently stuck in `PAUSED_SECURITY` or leak promises due to missing status guards.
3. **Error Overwriting**: Precise cancellation reasons are overwritten when the browser automation resumes with `'CANCELLED'` and fails.
4. **Hangs**: Playwright hangs for 30 seconds under validation mismatches (e.g. trailing `@` in emails).

---

## 5. Verification Method

1. **Verify Boundary Test Failures**:
   - Run the E2E runner: `PORT=3000 npm test`
   - Observe failures in `Feature 2: Form Validation/Edges` tests inside `tier2_boundary.test.js`.
2. **Verify Leaks & Overwrites**:
   - Run `node tests/challenger_I1_4.test.js` to verify promise leaks and cancellation behaviors.
   - Run `node tests/challenger_I1_2.test.js` to verify validation mismatch hangs and state pollution.
