# E2E Test Infrastructure Challenge Report (handoff.md)

## 1. Observations

### Observation 1: Task Resurrection / Cancellation Race Condition
- **File paths and line numbers**:
  - `src/server.js:47-53` (Webhook cancel logic)
  - `src/automation/taskManager.js:35-43` (`pauseTask` status transition)
  - `src/automation/taskManager.js:129-146` (`cancelTask` implementation)
  - `src/automation/browser.js:32-35` (Playwright flow pause call)
- **Verbatim code details**:
  - In `src/server.js`, a new re-approval request cancels existing active tasks for the user:
    ```javascript
    const userEmail = `${user.id}@example.com`;
    for (const t of taskManager.tasks.values()) {
      if (t.formData && t.formData.email === userEmail && (t.status === 'RUNNING' || t.status === 'PAUSED_SECURITY')) {
        taskManager.cancelTask(t.taskId, 'Cancelled by new re-approval request');
      }
    }
    ```
  - In `taskManager.js`, `cancelTask` updates the state to `FAILED`:
    ```javascript
    cancelTask(taskId, reason = 'Cancelled') {
      const task = this.getTask(taskId);
      ...
      task.status = 'FAILED';
      task.error = reason;
      ...
    ```
  - In `taskManager.js`, `pauseTask` sets the status to `PAUSED_SECURITY` without verifying if the task was already cancelled or failed:
    ```javascript
    pauseTask(taskId, captchaText, timeoutMs = 300000) {
      const task = this.getTask(taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);

      task.status = 'PAUSED_SECURITY';
      ...
    ```
  - In `taskManager.js`, if a task is cancelled while paused, `cancelTask` resolves the promise with `'CANCELLED'`:
    ```javascript
    if (task.deferred) {
      task.deferred.resolve('CANCELLED');
      task.deferred = null;
    }
    ```
  - In `browser.js`, there is no validation on the return value of `pauseTask` or checking if the task status changed:
    ```javascript
    const captchaCode = await taskManager.pauseTask(taskId);
    // Once resolved, type captcha code and submit
    await page.fill('#captcha', captchaCode);
    ```

### Observation 2: Form HTML5 Required Fields Mismatch
- **File paths and line numbers**:
  - `src/public/form.html:80-103` (Required elements in mock form)
  - `src/automation/browser.js:18-22` (Playwright input filling)
- **Verbatim HTML elements**:
  - `src/public/form.html` contains multiple required fields and checkbox:
    ```html
    <input type="text" id="age" name="age" required>
    <input type="tel" id="phone" name="phone" required>
    <input type="number" id="deposit" name="deposit" required>
    <input type="checkbox" id="agree" name="agree" required>
    ```
  - `browser.js` only fills name, email, and amount:
    ```javascript
    await page.fill('#name', task.formData.name || '홍길동');
    await page.fill('#email', task.formData.email || 'hong@example.com');
    await page.fill('#amount', String(task.formData.amount || 10000000));
    ```

### Observation 3: Port Binding Socket Wait Flaw
- **File paths and line numbers**:
  - `tests/e2e_runner.js:7-30` (`waitPort` logic)
  - `src/server.js:200-214` (Server start logic)
- **Verbatim socket wait**:
  ```javascript
  function waitPort(port, host, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      function tryConnect() {
        const socket = new net.Socket();
        socket.connect(port, host, () => {
          socket.end();
          resolve();
        });
        ...
  ```

### Observation 4: State Pollution on Terminated Tasks
- **File paths and line numbers**:
  - `src/server.js:141-171` (`/api/submit-form` endpoint)
- **Verbatim logic**:
  ```javascript
  app.post('/api/submit-form', (req, res) => {
    ...
    const task = taskManager.getTask(taskId);
    ...
    task.formData = { name, email, amount: amt };
    return res.redirect(`/secure.html?taskId=${taskId}`);
  });
  ```

### Observation 5: Double Pause Promise Memory Leak
- **File paths and line numbers**:
  - `src/automation/taskManager.js:50-61` (`pauseTask` deferred storage)
- **Verbatim logic**:
  ```javascript
  let resolveFn;
  let rejectFn;
  const promise = new Promise((resolve, reject) => { ... });
  task.deferred = { promise, resolve: resolveFn, reject: rejectFn };
  ```

---

## 2. Logic Chain

### Logic Chain 1: Task Resurrection & Zombie Processes
1. If a new request triggers a re-approval cancellation while the previous browser automation task is in the `RUNNING` state (navigating `form.html`), `taskManager.cancelTask` sets the status to `FAILED`.
2. The active browser process continues in the background, submits the form, and lands on `secure.html`.
3. The browser script invokes `taskManager.pauseTask(taskId)`.
4. `pauseTask` unconditionally sets `task.status = 'PAUSED_SECURITY'`, overwriting the `FAILED` status and resurrecting the task.
5. The browser process suspends indefinitely on the deferred promise, creating a zombie process and leaving the task in an inconsistent state (`PAUSED_SECURITY` instead of the cancelled `FAILED` state).

### Logic Chain 2: Post-Cancellation Overwrite & 30s Hang
1. If the task is already paused on `secure.html` when cancelled, `cancelTask` resolves the deferred promise with `'CANCELLED'`.
2. The browser resumes and populates the `#captcha` field with the literal text `'CANCELLED'`.
3. It clicks `#verify-btn` and awaits navigation using `page.waitForNavigation()`.
4. Since `'CANCELLED'` is invalid, the server responds with a 400 and does not redirect, meaning no navigation occurs.
5. The Playwright browser hangs for its default 30-second timeout.
6. When the timeout occurs, the catch block catches the error and updates the task status/error using `taskManager.updateTask(taskId, { status: 'FAILED', error: err.message })`.
7. This overwrites the original cancellation message with the generic timeout error, making troubleshooting impossible and leaking the browser process for 30 seconds.

### Logic Chain 3: HTML5 Form Validation Block
1. `form.html` specifies that fields `age`, `phone`, `deposit`, and checkbox `agree` are `required`.
2. `browser.js` does not fill these fields, only filling name, email, and amount.
3. When `browser.js` clicks `#submit-btn`, the browser's native form validator blocks submission.
4. Consequently, the page never redirects to `secure.html`.
5. Playwright's `page.waitForNavigation()` hangs for 30 seconds and rejects with a timeout, resulting in failed tasks and long test times.

### Logic Chain 4: Non-Hermetic Port Collision
1. The test runner uses a default port (3000) and starts the server as a child process.
2. If another process is already listening on port 3000, our mock server fails with `EADDRINUSE`.
3. `waitPort` connects to the other process's port, immediately resolves, and the runner incorrectly assumes our server is ready.
4. The tests run, making API calls to port 3000, which are processed by the unrelated app, leading to false negatives and environment contamination.

---

## 3. Caveats
- **Local Verification Restriction**: Empirical validation through zsh execution could not be executed directly during this run because the host's terminal command executor requires manual approval prompts, which timed out (as the user was away). We rely instead on rigorous, deterministic, static code-level tracing.
- **Alternative Interpretations**: While it's possible some test suites did not hang in the worker's manual review because they used a browser configuration that ignores HTML5 requirements, standard Playwright chromium instances strictly enforce HTML5 required fields and will block form submission.

---

## 4. Conclusion
The E2E test infrastructure suffers from multiple critical concurrency, race, and stability bugs:
1. **Re-approval Resurrection Race**: Cancelled tasks in the form-filling stage are resurrected when they reach the captcha page.
2. **Post-Cancellation Hangs**: Cancelled tasks that are already paused cause the browser to hang for 30s before failing with a timeout error, erasing the true cancellation reason.
3. **HTML5 Validation Mismatch**: The automation flow does not fill all required form fields, causing Playwright to hang and time out on form submission.
4. **Port Binding Vulnerability**: Collisions on port 3000 are not caught, causing the runner to target unrelated local processes.
5. **Memory Leak**: Re-calling `pauseTask` overwrites deferred promises, causing the previous promise to hang in memory forever.

---

## 5. Verification Method

To verify these challenges, run the custom verification tests or inspect the target source files using the following procedures:

### How to reproduce "HTML5 Validation Hang"
1. Edit `tests/tier1_coverage.test.js` or run `npm test` inside the workspace.
2. Observe that Playwright tests targeting the browser form submission wait for 30 seconds and throw navigation timeouts.
3. Inspect `src/public/form.html` to confirm that `age`, `phone`, `deposit`, and `agree` are marked `required`.

### How to reproduce "Task Resurrection Race Condition"
1. Start the mock server on port 3000:
   ```bash
   node src/server.js
   ```
2. Trigger a webhook request for User A:
   ```bash
   curl -X POST http://localhost:3000/api/kakao/webhook \
     -H "Content-Type: application/json" \
     -d '{"userRequest":{"utterance":"승인","user":{"id":"user-race-test"}}}'
   ```
   Note the generated `taskId`.
3. Immediately trigger a second webhook request for the same User A before the browser reaches `secure.html`.
4. Poll the status of the *first* `taskId`:
   ```bash
   curl http://localhost:3000/api/automation/status/<first-taskId>
   ```
5. Check if the status transitioned to `FAILED` (due to cancel) and then back to `PAUSED_SECURITY` (due to the browser completing form navigation). The status will incorrectly show `PAUSED_SECURITY` (resurrected).
