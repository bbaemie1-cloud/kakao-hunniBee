# Handoff Report: E2E Testing Explorer for Milestone E2

## 1. Observation
We observed the following about the codebase structure and E2E testing infrastructure:
- **Server and API endpoints**: `src/server.js` hosts the mock Express server. It exposes `/api/kakao/webhook` (lines 17-66), `/api/automation/resume` (lines 69-91), `/api/automation/status/:taskId` (lines 94-107), `/api/automation/captcha/:taskId` (lines 110-117), `/api/submit-form` (lines 120-150), `/api/submit-captcha` (lines 153-169), and `/api/test/create-task` (lines 172-176).
- **Task Manager Implementation**: `src/automation/taskManager.js` manages task states in-memory (`RUNNING`, `PAUSED_SECURITY`, `COMPLETED`, `FAILED`). It features `createTask` (lines 8-22), `pauseTask` (lines 35-52) returning a deferred promise, and `resumeTask` (lines 54-70) resolving the deferred promise.
- **Browser Automation Flow**: `src/automation/browser.js` automates the headless Playwright browser flow. It navigates to `/form.html?taskId=...` (lines 14-16), inputs form data (lines 19-21), submits the form (lines 24-27), pauses via `taskManager.pauseTask` when on `secure.html` (line 34), fills in the captcha code (lines 37-42), and checks if it navigated to `success.html` to set status to `COMPLETED` (lines 47-51).
- **Existing Test suites**:
  - `tests/tier1_coverage.test.js` contains feature sanity checks (15 tests).
  - `tests/tier2_boundary.test.js` contains edge case input validations (15 tests).
  - `tests/adversarial.test.js` contains concurrency stress tests, visual overlap tests, and invalid state transition checks (8 tests).
- **Re-Approval and Cancellation**: The codebase does not currently implement task cancellation on re-approval. `src/server.js` (lines 40-52) unconditionally spawns a new task ID and runs a new browser process for any utterance of `승인` without checking if the user already has a pending task.

---

## 2. Logic Chain
To meet the requirements of Milestone E2, we design Tier 3 and Tier 4 E2E tests based on the current implementation details:
1. **Tier 3 (Cross-Feature Combination)** tests check the interaction of features:
   - **Test 3.1: Multi-user task interleaving**: We simulate two users triggering webhooks (`User A`, `User B`) to verify that their Playwright browsers pause concurrently and can be resumed separately using their respective unique CAPTCHAs, proving that states do not leak between task IDs.
   - **Test 3.2: Concurrent webhook/resume executions**: We run `Promise.all` over multiple webhook and resume requests to ensure no database/memory contention, locking, or race conditions occur.
   - **Test 3.3: Status monitoring interactions**: We test the status endpoint dynamically, validating that `status` changes from `RUNNING` -> `PAUSED_SECURITY` -> `RUNNING`/`COMPLETED` while tracking `currentUrl` and checking that bad captcha attempts do not break the pause loop.
2. **Tier 4 (Real-World Workloads)** tests check end-to-end user journeys:
   - **Test 4.1: Complete E2E happy flow**: Covers the full journey from KakaoTalk chatbot webhook request down to application success.
   - **Test 4.2: Captcha retry flow**: Verifies wrong captcha retry flow (400 Bad Request, keeps state `PAUSED_SECURITY`, then correct captcha completes the task).
   - **Test 4.3: Form submit validations and recovery**: Verifies that submitting invalid values (e.g. negative loan amounts) causes task failure, and the system can recover by spawning a new valid task.
   - **Test 4.4: Multi-user concurrent flows**: Verifies stress limits with concurrent browser execution and tests against visual data crosstalk.
   - **Test 4.5: Re-approval task cancellation flow**: Verifies that when a user requests approval again while a task is already active, the old task transitions to `FAILED` (with cancellation error), its deferred promise is resolved with a cancel signal, and a new task starts successfully.

---

## 3. Caveats
- Since there is no active database, tasks are tracked entirely in-memory using `taskManager.js`'s `Map`. A server restart will wipe all tasks.
- For Test 4.5 (Re-approval cancellation) to pass, the codebase implementation must be updated. Currently, there is no logic to find existing active tasks by user email or user ID. In section 4, we provide the exact diff needed to enable this.

---

## 4. Conclusion
Milestone E2 is highly actionable. Below are the recommended implementation code templates for the test suites, the implementation code addition for the server/taskManager, and the structure of `TEST_READY.md`.

### Suggested Code for `tests/tier3_combination.test.js`
```javascript
const { describe, test } = require('node:test');
const assert = require('node:assert');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

describe('Tier 3: Cross-Feature Combination Tests', () => {
  // Test 3.1: Multi-user task interleaving
  test('multi-user task interleaving prevents state contamination', async () => {
    const resA = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: { utterance: '승인', user: { id: 'user-interleave-a' } }
      })
    });
    const taskIdA = (await resA.json()).template.outputs[0].simpleText.text.match(/작업 ID:\s*(task-[^\s)]+)/)[1];

    const resB = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: { utterance: '승인', user: { id: 'user-interleave-b' } }
      })
    });
    const taskIdB = (await resB.json()).template.outputs[0].simpleText.text.match(/작업 ID:\s*(task-[^\s)]+)/)[1];

    let statusA = 'RUNNING', statusB = 'RUNNING', attempts = 0;
    while ((statusA === 'RUNNING' || statusB === 'RUNNING') && attempts < 20) {
      await new Promise(r => setTimeout(r, 500));
      statusA = (await (await fetch(`${BASE_URL}/api/automation/status/${taskIdA}`)).json()).status;
      statusB = (await (await fetch(`${BASE_URL}/api/automation/status/${taskIdB}`)).json()).status;
      attempts++;
    }
    assert.strictEqual(statusA, 'PAUSED_SECURITY');
    assert.strictEqual(statusB, 'PAUSED_SECURITY');

    const captchaA = (await (await fetch(`${BASE_URL}/api/automation/captcha/${taskIdA}`)).json()).captcha;
    const captchaB = (await (await fetch(`${BASE_URL}/api/automation/captcha/${taskIdB}`)).json()).captcha;
    assert.notStrictEqual(captchaA, captchaB);

    await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: taskIdA, captchaCode: captchaA })
    });

    const statusBCheck = (await (await fetch(`${BASE_URL}/api/automation/status/${taskIdB}`)).json()).status;
    assert.strictEqual(statusBCheck, 'PAUSED_SECURITY');

    let finalStatusA = 'RUNNING';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      finalStatusA = (await (await fetch(`${BASE_URL}/api/automation/status/${taskIdA}`)).json()).status;
      if (finalStatusA === 'COMPLETED') break;
    }
    assert.strictEqual(finalStatusA, 'COMPLETED');

    await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: taskIdB, captchaCode: captchaB })
    });

    let finalStatusB = 'RUNNING';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      finalStatusB = (await (await fetch(`${BASE_URL}/api/automation/status/${taskIdB}`)).json()).status;
      if (finalStatusB === 'COMPLETED') break;
    }
    assert.strictEqual(finalStatusB, 'COMPLETED');
  });

  // Test 3.2: Concurrent webhook/resume executions
  test('concurrent webhook and resume requests are handled correctly without locking', async () => {
    const taskCount = 3;
    const userIds = Array.from({ length: taskCount }, (_, i) => `user-concurrent-${i}-${Date.now()}`);
    const webhookPromises = userIds.map(userId => 
      fetch(`${BASE_URL}/api/kakao/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userRequest: { utterance: '승인', user: { id: userId } } })
      }).then(r => r.json())
    );
    const responses = await Promise.all(webhookPromises);
    const taskIds = responses.map(r => r.template.outputs[0].simpleText.text.match(/작업 ID:\s*(task-[^\s)]+)/)[1]);

    let allPaused = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(r => setTimeout(r, 500));
      const statuses = await Promise.all(taskIds.map(id => fetch(`${BASE_URL}/api/automation/status/${id}`).then(r => r.json())));
      if (statuses.every(s => s.status === 'PAUSED_SECURITY')) {
        allPaused = true;
        break;
      }
    }
    assert.ok(allPaused);

    const captchas = await Promise.all(taskIds.map(id => fetch(`${BASE_URL}/api/automation/captcha/${id}`).then(r => r.json()).then(d => d.captcha)));
    const resumePromises = taskIds.map((id, index) => 
      fetch(`${BASE_URL}/api/automation/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: id, captchaCode: captchas[index] })
      }).then(r => r.json())
    );
    const resumeResults = await Promise.all(resumePromises);
    assert.ok(resumeResults.every(res => res.success === true));

    let allCompleted = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(r => setTimeout(r, 500));
      const statuses = await Promise.all(taskIds.map(id => fetch(`${BASE_URL}/api/automation/status/${id}`).then(r => r.json())));
      if (statuses.every(s => s.status === 'COMPLETED')) {
        allCompleted = true;
        break;
      }
    }
    assert.ok(allCompleted);
  });

  // Test 3.3: Status monitoring interactions
  test('status monitoring endpoint reports correct details throughout lifecycle', async () => {
    const taskId = `task-status-lifecycle-${Date.now()}`;
    await fetch(`${BASE_URL}/api/test/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, formData: { name: 'Lifecycle', email: 'life@example.com', amount: 3000 } })
    });

    const { runAutomation } = require('../src/automation/browser');
    runAutomation(taskId, PORT).catch(() => {});

    const init = await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json();
    assert.ok(init.status === 'RUNNING' || init.status === 'PAUSED_SECURITY');

    let captchaCode = '';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const data = await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json();
      if (data.status === 'PAUSED_SECURITY') {
        assert.ok(data.currentUrl.includes('secure.html'));
        captchaCode = (await (await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`)).json()).captcha;
        break;
      }
    }
    assert.ok(captchaCode);

    const badResume = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, captchaCode: 'BAD' })
    });
    assert.strictEqual(badResume.status, 400);

    const middle = await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json();
    assert.strictEqual(middle.status, 'PAUSED_SECURITY');

    await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, captchaCode })
    });

    let completed = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const data = await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json();
      if (data.status === 'COMPLETED') {
        assert.ok(data.currentUrl.includes('success.html'));
        completed = true;
        break;
      }
    }
    assert.ok(completed);
  });
});
```

### Suggested Code for `tests/tier4_workload.test.js`
```javascript
const { describe, test } = require('node:test');
const assert = require('node:assert');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

describe('Tier 4: Real-World Workload Scenarios', () => {
  // Test 4.1: Complete End-to-End Happy Flow
  test('complete end-to-end happy flow succeeds', async () => {
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userRequest: { utterance: '승인', user: { id: 'happy-user' } } })
    });
    const taskId = (await res.json()).template.outputs[0].simpleText.text.match(/작업 ID:\s*(task-[^\s)]+)/)[1];

    let status = 'RUNNING', captchaCode = '';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const data = await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json();
      status = data.status;
      if (status === 'PAUSED_SECURITY') {
        captchaCode = (await (await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`)).json()).captcha;
        break;
      }
    }
    assert.strictEqual(status, 'PAUSED_SECURITY');

    await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, captchaCode })
    });

    let finalStatus = 'RUNNING';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      finalStatus = (await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json()).status;
      if (finalStatus === 'COMPLETED') break;
    }
    assert.strictEqual(finalStatus, 'COMPLETED');
  });

  // Test 4.2: Captcha Retry Flow
  test('captcha retry flow recovers from wrong captcha', async () => {
    const taskId = `task-retry-${Date.now()}`;
    await fetch(`${BASE_URL}/api/test/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, formData: { name: 'Retry', email: 'retry@ex.com', amount: 5000 } })
    });

    const { runAutomation } = require('../src/automation/browser');
    runAutomation(taskId, PORT).catch(() => {});

    let captchaCode = '';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const data = await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json();
      if (data.status === 'PAUSED_SECURITY') {
        captchaCode = (await (await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`)).json()).captcha;
        break;
      }
    }

    const badResume = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, captchaCode: 'WRONG' })
    });
    assert.strictEqual(badResume.status, 400);

    const check = await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json();
    assert.strictEqual(check.status, 'PAUSED_SECURITY');

    await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, captchaCode })
    });

    let finalStatus = 'RUNNING';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      finalStatus = (await (await fetch(`${BASE_URL}/api/automation/status/${taskId}`)).json()).status;
      if (finalStatus === 'COMPLETED') break;
    }
    assert.strictEqual(finalStatus, 'COMPLETED');
  });

  // Test 4.3: Form submit validations and recovery
  test('form submit validation fails and recovers with new task', async () => {
    const invalidTaskId = `task-invalid-${Date.now()}`;
    await fetch(`${BASE_URL}/api/test/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: invalidTaskId, formData: { name: '', email: 'bad', amount: -10 } })
    });

    const { runAutomation } = require('../src/automation/browser');
    runAutomation(invalidTaskId, PORT).catch(() => {});

    let failedStatus = 'RUNNING';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      failedStatus = (await (await fetch(`${BASE_URL}/api/automation/status/${invalidTaskId}`)).json()).status;
      if (failedStatus === 'FAILED') break;
    }
    assert.strictEqual(failedStatus, 'FAILED');

    const validTaskId = `task-recovered-${Date.now()}`;
    await fetch(`${BASE_URL}/api/test/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: validTaskId, formData: { name: 'Valid', email: 'ok@ok.com', amount: 1000 } })
    });
    runAutomation(validTaskId, PORT).catch(() => {});

    let captchaCode = '';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const data = await (await fetch(`${BASE_URL}/api/automation/status/${validTaskId}`)).json();
      if (data.status === 'PAUSED_SECURITY') {
        captchaCode = (await (await fetch(`${BASE_URL}/api/automation/captcha/${validTaskId}`)).json()).captcha;
        break;
      }
    }
    assert.ok(captchaCode);

    await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: validTaskId, captchaCode })
    });

    let finalStatus = 'RUNNING';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      finalStatus = (await (await fetch(`${BASE_URL}/api/automation/status/${validTaskId}`)).json()).status;
      if (finalStatus === 'COMPLETED') break;
    }
    assert.strictEqual(finalStatus, 'COMPLETED');
  });

  // Test 4.4: Multi-user concurrent flows
  test('multi-user concurrent flows execute without crosstalk', async () => {
    const taskIds = [`t-c-0-${Date.now()}`, `t-c-1-${Date.now()}`];
    for (let i = 0; i < taskIds.length; i++) {
      await fetch(`${BASE_URL}/api/test/create-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: taskIds[i], formData: { name: `User ${i}`, email: `u${i}@ex.com`, amount: 1000 * (i+1) } })
      });
    }

    const { runAutomation } = require('../src/automation/browser');
    const runs = taskIds.map(id => runAutomation(id, PORT));

    let allPaused = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const statuses = await Promise.all(taskIds.map(id => fetch(`${BASE_URL}/api/automation/status/${id}`).then(r => r.json())));
      if (statuses.every(s => s.status === 'PAUSED_SECURITY')) {
        allPaused = true;
        break;
      }
    }
    assert.ok(allPaused);

    for (const taskId of taskIds) {
      const captcha = (await (await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`)).json()).captcha;
      await fetch(`${BASE_URL}/api/automation/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, captchaCode: captcha })
      });
    }

    await Promise.all(runs);

    for (const id of taskIds) {
      const data = await (await fetch(`${BASE_URL}/api/automation/status/${id}`)).json();
      assert.strictEqual(data.status, 'COMPLETED');
    }
  });

  // Test 4.5: Re-approval task cancellation flow
  test('re-approval cancels existing task and starts a new one', async () => {
    const res1 = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userRequest: { utterance: '승인', user: { id: 'user-cancel-test' } } })
    });
    const taskId1 = (await res1.json()).template.outputs[0].simpleText.text.match(/작업 ID:\s*(task-[^\s)]+)/)[1];

    let paused1 = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const status = (await (await fetch(`${BASE_URL}/api/automation/status/${taskId1}`)).json()).status;
      if (status === 'PAUSED_SECURITY') { paused1 = true; break; }
    }
    assert.ok(paused1);

    const res2 = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userRequest: { utterance: '승인', user: { id: 'user-cancel-test' } } })
    });
    const taskId2 = (await res2.json()).template.outputs[0].simpleText.text.match(/작업 ID:\s*(task-[^\s)]+)/)[1];
    assert.notStrictEqual(taskId1, taskId2);

    let task1Cancelled = false;
    for (let i = 0; i < 20; i++) {
      const data = await (await fetch(`${BASE_URL}/api/automation/status/${taskId1}`)).json();
      if (data.status === 'FAILED') {
        assert.ok(data.error.includes('Cancelled') || data.error.includes('re-approval'));
        task1Cancelled = true;
        break;
      }
      await new Promise(r => setTimeout(r, 200));
    }
    assert.ok(task1Cancelled);

    let paused2 = false, captcha2 = '';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const data = await (await fetch(`${BASE_URL}/api/automation/status/${taskId2}`)).json();
      if (data.status === 'PAUSED_SECURITY') {
        paused2 = true;
        captcha2 = (await (await fetch(`${BASE_URL}/api/automation/captcha/${taskId2}`)).json()).captcha;
        break;
      }
    }
    assert.ok(paused2);

    await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: taskId2, captchaCode: captcha2 })
    });

    let finalStatus2 = 'RUNNING';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      finalStatus2 = (await (await fetch(`${BASE_URL}/api/automation/status/${taskId2}`)).json()).status;
      if (finalStatus2 === 'COMPLETED') break;
    }
    assert.strictEqual(finalStatus2, 'COMPLETED');
  });
});
```

### Required Source Code Additions for Task Cancellation
To make the re-approval cancellation test pass, the following changes are required in `src/automation/taskManager.js` and `src/server.js`:

1. **`src/automation/taskManager.js` additions**:
   ```javascript
   findActiveTaskByEmail(email) {
     for (const [taskId, task] of this.tasks.entries()) {
       if (task.formData && task.formData.email === email && (task.status === 'RUNNING' || task.status === 'PAUSED_SECURITY')) {
         return task;
       }
     }
     return null;
   }
   ```

2. **`src/server.js` additions inside `app.post('/api/kakao/webhook')`**:
   Before creating the task:
   ```javascript
   const email = `${user.id}@example.com`;
   const existingTask = taskManager.findActiveTaskByEmail(email);
   if (existingTask) {
     taskManager.updateTask(existingTask.taskId, {
       status: 'FAILED',
       error: 'Cancelled due to re-approval request'
     });
     if (existingTask.deferred) {
       // Resolve the deferred promise with 'CANCELLED' to wake up and abort the browser thread
       existingTask.deferred.resolve('CANCELLED');
     }
   }
   ```

3. **`src/automation/browser.js` modifications**:
   Inside `runAutomation`:
   ```javascript
   if (currentUrl.includes('secure.html')) {
     const captchaCode = await taskManager.pauseTask(taskId);

     // Check if task was cancelled while paused
     const activeTask = taskManager.getTask(taskId);
     if (activeTask.status === 'FAILED') {
       throw new Error(activeTask.error || 'Task cancelled');
     }
     ...
   ```

---

## 5. Verification Method
1. Create `tests/tier3_combination.test.js` and `tests/tier4_workload.test.js` under the `tests/` directory with the provided codes.
2. Implement the cancellation logic additions in `src/automation/taskManager.js`, `src/server.js`, and `src/automation/browser.js`.
3. Add the two new test suites to the test list inside `tests/e2e_runner.js` (lines 57-60):
   ```javascript
   const testFiles = [
     path.join(__dirname, 'tier1_coverage.test.js'),
     path.join(__dirname, 'tier2_boundary.test.js'),
     path.join(__dirname, 'tier3_combination.test.js'),
     path.join(__dirname, 'tier4_workload.test.js')
   ];
   ```
4. Run `npm test` from the project directory. All tests from Tiers 1-4, including the newly added concurrent interleaving and task cancellation tests, should pass successfully.
