## 2026-07-04T04:12:36Z
You are the Worker for Milestone I5: Adversarial Hardening (Phase 2) in the KakaoTalk Admin Assistant project.
Your working directory is /Users/uricho/Desktop/Watson/teamwork_projects/kakao_admin_assistant/.agents/worker_I5_gen1/
Your identity is worker_I5_gen1.

MANDATORY INTEGRITY WARNING:
> DO NOT CHEAT. All implementations must be genuine. DO NOT
> hardcode test results, create dummy/facade implementations, or
> circumvent the intended task. A Forensic Auditor will independently
> verify your work. Integrity violations WILL be detected and your
> work WILL be rejected.

Objective:
Implement the security and stability remediations for the Task Manager, Express server, and static templates to resolve the vulnerabilities identified by the Challengers.

Required Changes:

1. **Task Storage Memory Eviction & Cleanup** (in `src/automation/taskManager.js`):
   - In the constructor, initialize `this.recentTerminalStatuses = new Map();` to store brief status metadata for recently finished tasks.
   - When a task reaches a terminal state in `completeTask(taskId)` or `failTask(taskId, errorMessage)`:
     - Save a metadata object `{ taskId, status: 'COMPLETED' | 'FAILED', currentUrl: task.currentUrl, error: task.error || errorMessage }` into `this.recentTerminalStatuses`.
     - Evict the oldest key from `this.recentTerminalStatuses` if its size exceeds 100 entries.
     - Delete the task object from `this.tasks` using `this.tasks.delete(taskId)` to free memory and prevent leaks.
   - In `getTask(taskId)`, return the task from `this.tasks.get(taskId)` if it exists; otherwise fallback to `this.recentTerminalStatuses.get(taskId)`.

2. **State Pollution & Re-pause Prevention** (in `src/automation/taskManager.js`):
   - In `updateTask(taskId, updates)`, retrieve the task only using `this.tasks.get(taskId)`. If the task is not in the active `this.tasks` Map (i.e. it is completed or failed), return early without applying updates.
   - In `pauseTask(taskId, captchaText)`, check if the task is already completed or failed. Specifically, if `this.recentTerminalStatuses.has(taskId)`:
     - If the status is `'COMPLETED'`, throw `new Error('Cannot pause a completed task')`.
     - If `'FAILED'`, throw `new Error('Cannot pause a failed task')`.

3. **Captcha Rate-Limiting & Lockout** (in `src/automation/taskManager.js`):
   - In `createTask`, initialize `task.attempts = 0;`.
   - In `resumeTask(taskId, captchaCode)`, if `captchaCode !== task.correctCaptcha`:
     - Increment `task.attempts`.
     - If `task.attempts` reaches 5 attempts, call `this.failTask(taskId, 'Too many invalid captcha attempts')` and return `{ success: false, error: 'Too many invalid captcha attempts. Task failed.' }`.

4. **Securing the Captcha API Endpoint**:
   - In `src/server.js`: update `GET /api/automation/captcha/:taskId` to check for `Authorization: Bearer mock-secret-token-123` in headers. If missing or invalid, return 401 Unauthorized.
   - In `src/public/secure.html` (around line 113): update the `fetch('/api/automation/captcha/' + taskId)` call to pass the header `Authorization: Bearer mock-secret-token-123`.

5. **Updating Unit Tests**:
   - In `tests/challenger_I1_4.test.js` (around line 72), update Test 4 ("Verify that state pollution occurs...") to instead assert that state pollution is *prevented* and task properties are not modified after completion.

Validation:
After making these changes:
1. Run the new adversarial tests:
   ```bash
   node tests/adversarial_gaps.test.js
   ```
2. Run the main E2E test suite:
   ```bash
   npm test
   ```
3. Run the concurrency stress tests:
   ```bash
   node tests/stress_concurrency.js
   ```
Ensure they all pass. If any issues are found, debug and correct your implementation.
Once verified, write your final findings and test results to `handoff.md` in your directory and notify the orchestrator (conversation ID: 045da4e0-485a-43eb-bcea-69c6c817bdce) via send_message.
