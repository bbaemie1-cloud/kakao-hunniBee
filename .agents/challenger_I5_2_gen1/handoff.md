# Handoff Report - Challenger I5 Phase 2 Hardening

## 1. Observation
We observed the following inside the KakaoTalk Admin Assistant codebase:
- **Task Map Unbounded Growth**: In `/Users/uricho/Desktop/Watson/teamwork_projects/kakao_admin_assistant/src/automation/taskManager.js` (lines 3, 20):
  ```javascript
  this.tasks = new Map();
  ...
  this.tasks.set(taskId, task);
  ```
  No code exists in `taskManager.js` to delete or evict entries from `this.tasks`.
- **State Pollution on Completed/Failed Tasks**: In `src/automation/taskManager.js` (lines 31–35):
  ```javascript
  if (task.status === 'FAILED' || task.status === 'COMPLETED') {
    const filteredUpdates = { ...updates };
    delete filteredUpdates.status;
    delete filteredUpdates.error;
    Object.assign(task, filteredUpdates);
  }
  ```
  Even for completed or failed tasks, properties other than `status` and `error` are overwritten.
- **No Captcha Lockout / Attempts Limitation**: In `src/automation/taskManager.js` (lines 93–95):
  ```javascript
  if (captchaCode !== task.correctCaptcha) {
    return { success: false, error: 'Invalid captcha code' };
  }
  ```
  No attempts counter is updated or verified; the captcha is static and remains active indefinitely.
- **Unauthenticated Plaintext Captcha Exposure**: In `/Users/uricho/Desktop/Watson/teamwork_projects/kakao_admin_assistant/src/server.js` (lines 131–138):
  ```javascript
  app.get('/api/automation/captcha/:taskId', (req, res) => {
    const { taskId } = req.params;
    const task = taskManager.getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: `Task ${taskId} not found` });
    }
    return res.json({ captcha: task.correctCaptcha });
  });
  ```
  This endpoint returns the exact `correctCaptcha` string to any requester without authentication.

## 2. Logic Chain
1. *Observation 1* shows that every task created persists indefinitely in the `tasks` Map. Since new tasks are added for every KakaoTalk Bot request, memory usage will grow unbounded, which causes resource exhaustion (OOM crashes) over time.
2. *Observation 2* indicates that the properties of completed or failed tasks can be modified via `updateTask`. Consequently, once an application completes, an attacker can modify sensitive data (e.g. loan amount, applicant name) inside the in-memory task log.
3. *Observation 3* establishes that an incorrect captcha submission does not increment any error counter or fail the task. Since the captcha code is a 6-digit integer and remains valid for the 5-minute timeout period, an attacker can brute-force the captcha code by calling the resume API repeatedly.
4. *Observation 4* demonstrates that the secret captcha code can be fetched using a simple HTTP GET request to `/api/automation/captcha/:taskId`. Anyone who knows or guesses the task ID can obtain the captcha and bypass the security gate.

## 3. Caveats
- Command executions in the workspace environment timed out waiting for manual approvals. Therefore, direct test verification output from `node --test` could not be fetched locally, but the test assertions have been verified by analyzing the JS execution path.
- Input validation/XSS sanitization on static files (`form.html`, `success.html`, etc.) was not fully audited.

## 4. Conclusion
There are four significant security and memory leakage vulnerabilities in the Task Manager and Express server:
1. Unbounded in-memory task map growth (memory leak).
2. Arbitrary property pollution of terminal tasks.
3. Absence of brute-force captcha protection (no lockout).
4. Plaintext captcha code exposure via public API.

A new test file `tests/adversarial_hardening.test.js` has been created under `tests/` which implements automated tests that expose these four vulnerabilities. A remediation plan has been written to `gap_report.md` in the agent folder.

## 5. Verification Method
1. Inspect `/Users/uricho/Desktop/Watson/teamwork_projects/kakao_admin_assistant/tests/adversarial_hardening.test.js` to review the verification test assertions.
2. Run the test command:
   ```bash
   node --test tests/adversarial_hardening.test.js
   ```
   *Expected behavior before remediation*: The tests will run and pass, thereby confirming the existence of the memory leak, state pollution, brute-force availability, and captcha code leak (i.e. the assertions prove the gaps exist).
3. Inspect the detailed gap report and proposed remediation plan in:
   `/Users/uricho/Desktop/Watson/teamwork_projects/kakao_admin_assistant/.agents/challenger_I5_2_gen1/gap_report.md`
