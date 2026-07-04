const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const taskManager = require('../src/automation/taskManager');
const { startServer } = require('../src/server');

const PORT = 3015; // Distinct port for Instance 3 challenger tests
const BASE_URL = `http://localhost:${PORT}`;
let server;

describe('Challenger Instance 3 - Retry & Cancellation Robustness Tests', () => {
  before(async () => {
    server = await startServer(PORT);
    console.log(`Challenger Instance 3 test server started on port ${PORT}`);
  });

  after(() => {
    if (server) {
      server.close();
      console.log('Challenger Instance 3 test server stopped');
    }
  });

  describe('1. Task Cancellation & Playwright Hang Behavior', () => {
    test('cancellation of a paused task resolves deferred with CANCELLED and fails the task', async () => {
      const taskId = `cancel-hang-test-${Date.now()}`;
      
      // Create and start task
      taskManager.createTask(taskId, {
        name: 'Cancel Test',
        email: 'cancel@example.com',
        amount: 3000000
      });

      // Pause task to generate deferred promise
      const pausePromise = taskManager.pauseTask(taskId, 'CAPTCHA');
      const task = taskManager.getTask(taskId);
      assert.strictEqual(task.status, 'PAUSED_SECURITY');
      assert.ok(task.deferred);

      // Cancel task
      const cancelRes = taskManager.cancelTask(taskId, 'Cancelled for test');
      assert.strictEqual(cancelRes.success, true);
      assert.strictEqual(task.status, 'FAILED');
      assert.strictEqual(task.error, 'Cancelled for test');
      assert.strictEqual(task.deferred, null);

      // Await promise to confirm it resolved with 'CANCELLED'
      const resolvedValue = await pausePromise;
      assert.strictEqual(resolvedValue, 'CANCELLED');
    });
  });

  describe('2. Captcha Retry State & Timeout Persistence', () => {
    test('wrong captcha in resumeTask keeps status as PAUSED_SECURITY and does not clear timeout', async () => {
      const taskId = `wrong-captcha-timeout-${Date.now()}`;
      taskManager.createTask(taskId, {
        name: 'Retry Timeout Test',
        email: 'retrytimeout@example.com',
        amount: 2500000
      });

      // Pause task with a custom timeout of 1000ms
      taskManager.pauseTask(taskId, '123456', 1000);
      const task = taskManager.getTask(taskId);
      assert.strictEqual(task.status, 'PAUSED_SECURITY');
      assert.ok(task.timeoutId);

      // Call resumeTask with wrong captcha code
      const resumeRes = taskManager.resumeTask(taskId, 'wrong-code');
      assert.strictEqual(resumeRes.success, false);
      assert.strictEqual(resumeRes.error, 'Invalid captcha code');

      // Verify task status is still PAUSED_SECURITY and timeoutId is still active
      assert.strictEqual(task.status, 'PAUSED_SECURITY');
      assert.ok(task.timeoutId);

      // Wait for the timeout to trigger (1500ms)
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Task should now be FAILED and timeoutId cleared
      assert.strictEqual(task.status, 'FAILED');
      assert.ok(task.error.includes('security check timed out'));
      assert.strictEqual(task.timeoutId, null);
    });
  });

  describe('3. Concurrent Resume & Status Verification', () => {
    test('handles multiple concurrent correct and incorrect resume requests safely', async () => {
      const taskId = `concurrent-resume-${Date.now()}`;
      taskManager.createTask(taskId, {
        name: 'Concurrent Resume User',
        email: 'concurrent@example.com',
        amount: 4000000
      });

      const pausePromise = taskManager.pauseTask(taskId, '123456');
      const task = taskManager.getTask(taskId);

      // Send multiple resume requests concurrently: 2 wrong, then 1 right, then 1 right again
      const res1 = taskManager.resumeTask(taskId, 'wrong-1');
      const res2 = taskManager.resumeTask(taskId, 'wrong-2');
      const res3 = taskManager.resumeTask(taskId, task.correctCaptcha);
      const res4 = taskManager.resumeTask(taskId, task.correctCaptcha); // Already resumed

      assert.strictEqual(res1.success, false);
      assert.strictEqual(res2.success, false);
      assert.strictEqual(res3.success, true);
      assert.strictEqual(res4.success, false); // Should fail since it's already RUNNING

      const resolvedCode = await pausePromise;
      assert.strictEqual(resolvedCode, task.correctCaptcha);
      assert.strictEqual(task.status, 'RUNNING');
    });
  });

  describe('4. Server API Validation & State Boundaries', () => {
    test('POST /api/automation/resume returns 400 Bad Request for wrong captcha but leaves task paused', async () => {
      const taskId = `api-wrong-captcha-${Date.now()}`;
      
      // Setup task in PAUSED_SECURITY
      taskManager.createTask(taskId, {
        name: 'API Retry User',
        email: 'apiretry@example.com',
        amount: 1500000
      });
      taskManager.pauseTask(taskId, 'CAPTCHA');

      // Call resume API with incorrect captcha
      const res = await fetch(`${BASE_URL}/api/automation/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, captchaCode: 'wrong-captcha-code' })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error, 'Invalid captcha code');

      // Verify task remains in PAUSED_SECURITY
      const task = taskManager.getTask(taskId);
      assert.strictEqual(task.status, 'PAUSED_SECURITY');
    });

    test('POST /api/automation/resume returns 404 for non-existent tasks', async () => {
      const res = await fetch(`${BASE_URL}/api/automation/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: 'non-existent-task-id-instance3', captchaCode: '123456' })
      });
      assert.strictEqual(res.status, 404);
    });
  });
});
