const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const taskManager = require('../src/automation/taskManager');
const { startServer } = require('../src/server');

const PORT = 3006;
let server;

describe('Adversarial Gaps & Security Hardening Tests (Tier 5)', () => {
  before(async () => {
    server = await startServer(PORT);
  });

  after(() => {
    if (server) {
      server.close();
    }
  });

  describe('1. Task Storage Memory Growth Risk', () => {
    test('completed and failed tasks must be cleaned up from the in-memory Map', async () => {
      const taskId1 = `memleak-task-1-${Date.now()}`;
      const taskId2 = `memleak-task-2-${Date.now()}`;

      taskManager.createTask(taskId1);
      taskManager.createTask(taskId2);

      taskManager.completeTask(taskId1);
      taskManager.failTask(taskId2, 'Failed intentionally');

      // The in-memory tasks Map should not retain references to terminal tasks indefinitely.
      // Asserting that Map size decreases or doesn't retain these tasks.
      // (This will fail under current implementation as tasks Map retains them forever).
      const task1Exist = taskManager.tasks.has(taskId1);
      const task2Exist = taskManager.tasks.has(taskId2);

      assert.strictEqual(task1Exist, false, 'Completed task should be removed from in-memory Map or pruned');
      assert.strictEqual(task2Exist, false, 'Failed task should be removed from in-memory Map or pruned');
    });
  });

  describe('2. State Pollution on Completed/Failed Tasks', () => {
    test('should prevent updating task properties (e.g. currentUrl, formData) on completed/failed tasks', () => {
      const taskId = `state-pollute-update-${Date.now()}`;
      const task = taskManager.createTask(taskId);
      taskManager.completeTask(taskId);

      const oldUrl = task.currentUrl;

      // Try updating properties of a completed task
      taskManager.updateTask(taskId, { currentUrl: 'http://malicious.com' });

      // Verify task properties did not change
      // (This will fail under current implementation because updateTask overwrites non-status/error properties of completed tasks)
      assert.strictEqual(task.currentUrl, oldUrl, 'Completed task should not allow property updates');
    });

    test('should reject transitions to PAUSED_SECURITY if task is already COMPLETED', async () => {
      const taskId = `state-pollute-pause-${Date.now()}`;
      taskManager.createTask(taskId);
      taskManager.completeTask(taskId);

      // Attempt to pause an already completed task
      // (This should throw an error, but in the current implementation it succeeds and shifts status to PAUSED_SECURITY)
      assert.throws(() => {
        taskManager.pauseTask(taskId, 'CAPTCHA');
      }, /Cannot pause a completed task/, 'Should throw an error when trying to pause a completed task');
    });
  });

  describe('3. Captcha Brute-Force Rate-Limiting', () => {
    test('should automatically fail task after multiple invalid captcha attempts', () => {
      const taskId = `bruteforce-task-${Date.now()}`;
      taskManager.createTask(taskId);
      taskManager.pauseTask(taskId, 'CAPTCHA');

      // Perform 6 invalid attempts (exceeding typical limit of 3-5)
      for (let i = 0; i < 6; i++) {
        taskManager.resumeTask(taskId, `wrong-${i}`);
      }

      // The task should transition to FAILED due to too many invalid attempts
      // (This will fail under current implementation as status remains PAUSED_SECURITY forever)
      const task = taskManager.getTask(taskId);
      assert.strictEqual(task.status, 'FAILED', 'Task should fail after exceeding maximum captcha attempts');
      assert.ok(task.error && task.error.includes('Too many'), 'Error message should indicate too many attempts');
    });
  });

  describe('4. Unauthenticated Captcha Leakage API', () => {
    test('fetching captcha code directly from API should be prohibited or require auth', async () => {
      const taskId = `leakage-task-${Date.now()}`;
      taskManager.createTask(taskId);

      // Attempt to fetch correct captcha code via API
      const response = await fetch(`http://localhost:${PORT}/api/automation/captcha/${taskId}`);
      
      // Assert that this endpoint returns unauthorized (401/403) or is disabled/protected
      // (This will fail under current implementation because it returns 200 with the exact correct captcha value)
      assert.notStrictEqual(response.status, 200, 'Captcha endpoint should not be publicly accessible with 200 OK');
    });
  });
});
