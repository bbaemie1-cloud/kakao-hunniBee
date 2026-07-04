# Handoff Report - Milestone I1 (Instance 3 Challenger Verification)

## Challenge Summary

**Overall risk assessment**: MEDIUM

- **Playwright Hang on Task Cancellation (Bug)**: When a task is cancelled, `taskManager.cancelTask` resolves the deferred pause promise with the string `'CANCELLED'`. The browser script (`browser.js`) continues running, types `'CANCELLED'` as the captcha, and tries to submit. The static web page frontend JS blocks submission due to captcha mismatch, causing `page.waitForNavigation()` to hang for 30 seconds before timing out and overwriting the cancellation error message.
- **Outdated Test Assertions (Fix)**: Pre-existing tests in `tests/adversarial.test.js` and `tests/challenger_I1_2.test.js` expected zero or negative timeouts in `pauseTask` to hang (as if safety timeouts were not implemented). Since the worker did implement safety timeouts, these tests failed with unhandled promise rejections. We have modified both test files to correctly expect immediate rejection.
- **Concurrent Resume API (Robust)**: Verified that incorrect captchas submitted to `resumeTask` are correctly rejected and keep the task in `PAUSED_SECURITY` without resetting the safety timeout or contaminating task state. Subsequent correct submissions resume the task successfully.

---

## 1. Observation

### Observation 1.1: Task Cancellation Resolve Value and Browser Interaction
In `src/automation/taskManager.js` (lines 141-144), task cancellation is implemented as:
```javascript
    if (task.deferred) {
      task.deferred.resolve('CANCELLED');
      task.deferred = null;
    }
```
In `src/automation/browser.js` (lines 34-42), the Playwright flow waits for this resolution:
```javascript
      // Pause task waiting for resume
      const captchaCode = await taskManager.pauseTask(taskId);

      // Once resolved, type captcha code and submit
      await page.fill('#captcha', captchaCode);
      
      await Promise.all([
        page.click('#verify-btn'),
        page.waitForNavigation()
      ]);
```
In `src/public/secure.html` (lines 181-189), frontend JS intercepts the form submit button:
```javascript
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

### Observation 1.2: Broken Assertions in Existing Test Suites
In `tests/adversarial.test.js` (original lines 191-199):
```javascript
      // Verify that the actual pauseTask method ignores the timeout parameter because it is not implemented
      // If it were implemented, passing 0 or negative timeouts would reject immediately.
      // We will race the promise with a 100ms timeout to prove it does not reject (i.e., hangs).
      const pausePromise = taskManager.pauseTask(taskId, 'SOME_CODE', -100);

      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('hang'), 100));
      const result = await Promise.race([pausePromise, timeoutPromise]);

      assert.strictEqual(result, 'hang', 'Expected pauseTask to hang because safety timeout parameter is not implemented');
```
However, `src/automation/taskManager.js` (lines 46-48) implements the timeout:
```javascript
    task.timeoutId = setTimeout(() => {
      this.failTask(taskId, `Task paused due to security check timed out`);
    }, timeoutMs);
```

### Observation 1.3: Webhook Re-Approval Cancellation Hook
In `src/server.js` (lines 47-53):
```javascript
  // Cancel any existing active tasks for the same user to handle re-approval cancellation
  const userEmail = `${user.id}@example.com`;
  for (const t of taskManager.tasks.values()) {
    if (t.formData && t.formData.email === userEmail && (t.status === 'RUNNING' || t.status === 'PAUSED_SECURITY')) {
      taskManager.cancelTask(t.taskId, 'Cancelled by new re-approval request');
    }
  }
```

---

## 2. Logic Chain

1. **Cancellation Hang Bug**: 
   - A task is cancelled (either via a direct `cancelTask` call or automatically when the same user submits a new webhook request).
   - `cancelTask` transitions task status to `FAILED` and resolves the deferred promise with `'CANCELLED'`.
   - `browser.js` wakes up, types `'CANCELLED'` in `#captcha`, and clicks `#verify-btn`.
   - Because `'CANCELLED'` does not match the target captcha, the frontend form submit handler calls `e.preventDefault()`, preventing any page navigation.
   - `page.waitForNavigation()` hangs indefinitely because no navigation occurs.
   - After a default timeout of 30 seconds, Playwright throws a timeout exception, which is caught by the browser script's `catch` block.
   - The task's error status is overwritten with the timeout error message (erasing the cancellation reason), and browser resources are wasted for 30 seconds.
   - **Mitigation**: `browser.js` should check if the resolved value is `'CANCELLED'` (or if the task is failed) and immediately throw or return instead of clicking verify.

2. **Test Fixes**:
   - Because the worker implemented the safety timeout parameter, passing 0 or a negative value (like `-100`) executes the timeout immediately in `setTimeout`.
   - This calls `failTask`, rejecting the promise with an error.
   - The test's `Promise.race` then rejects, causing an unhandled promise rejection error and failing the test instead of returning `'hang'`.
   - **Mitigation**: We modified `tests/adversarial.test.js` and `tests/challenger_I1_2.test.js` to correctly catch this rejection and assert that the task transitions to `FAILED`.

---

## 3. Caveats

- We were unable to execute the tests directly in the terminal because the execution environment's `run_command` tool requires manual user approval, which timed out during automated evaluation.
- All verification was conducted through rigorous white-box code path tracing and manual analysis.

---

## 4. Conclusion

- The Task Manager's safety timeout works correctly, but the previous test assertions incorrectly expected it to hang on zero/negative values.
- Task cancellation resolves the deferred promise rather than rejecting it, leading to a 30-second Playwright hang when it attempts to submit the `'CANCELLED'` string. This must be fixed in the browser script by checking for `'CANCELLED'` and exiting early.
- The webhook re-approval cancellation logic is sound but is degraded by the cancellation hang bug mentioned above.

---

## 5. Verification Method

To verify these behaviors once terminal access is available:

1. **Execution Command**:
   ```bash
   node --test tests/challenger_I1_3.test.js
   node --test tests/adversarial.test.js
   node --test tests/challenger_I1_2.test.js
   ```
2. **Success Criteria**:
   - All tests pass, including the updated safety timeout assertions.
   - The new test `cancellation of a paused task resolves deferred with CANCELLED and fails the task` in `challenger_I1_3.test.js` passes.
