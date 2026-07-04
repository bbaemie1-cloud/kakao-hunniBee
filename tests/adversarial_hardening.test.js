const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const taskManager = require('../src/automation/taskManager');
const { startServer } = require('../src/server');

const PORT = 3009;
const BASE_URL = `http://localhost:${PORT}`;
let server;

describe('Adversarial Hardening (Phase 2) - Vulnerability Checks', () => {
  before(async () => {
    server = await startServer(PORT);
  });

  after(() => {
    if (server) {
      server.close();
    }
  });

  test('1. Verify memory growth risks (tasks Map does not clean up)', async () => {
    const initialSize = taskManager.tasks.size;
    const testTasksCount = 5;
    const createdIds = [];

    // Create a few tasks
    for (let i = 0; i < testTasksCount; i++) {
      const taskId = `mem-growth-${i}-${Date.now()}`;
      taskManager.createTask(taskId, { name: `Test ${i}` });
      createdIds.push(taskId);
    }

    // Complete/fail them to transition to terminal states
    taskManager.completeTask(createdIds[0]);
    taskManager.failTask(createdIds[1], 'Failed on purpose');
    taskManager.completeTask(createdIds[2]);
    taskManager.failTask(createdIds[3], 'Failed on purpose');
    taskManager.completeTask(createdIds[4]);

    // Check that the Map still contains all of them, meaning no cleanup is performed
    assert.strictEqual(taskManager.tasks.size, initialSize + testTasksCount);
    for (const id of createdIds) {
      assert.ok(taskManager.getTask(id), `Task ${id} should still exist in memory`);
    }
  });

  test('2. Verify state pollution on completed/failed tasks', async () => {
    const completedTaskId = `pollution-completed-${Date.now()}`;
    const failedTaskId = `pollution-failed-${Date.now()}`;

    // Create and complete task
    taskManager.createTask(completedTaskId, { name: 'Original Name' });
    taskManager.completeTask(completedTaskId);
    assert.strictEqual(taskManager.getTask(completedTaskId).status, 'COMPLETED');

    // Attempt to pollute completed task's formData
    taskManager.updateTask(completedTaskId, { formData: { name: 'Polluted Name' }, currentUrl: 'http://polluted.com' });
    const completedTask = taskManager.getTask(completedTaskId);
    assert.strictEqual(completedTask.formData.name, 'Polluted Name', 'Completed task formData was polluted');
    assert.strictEqual(completedTask.currentUrl, 'http://polluted.com', 'Completed task currentUrl was polluted');

    // Create and fail task
    taskManager.createTask(failedTaskId, { name: 'Original Name' });
    taskManager.failTask(failedTaskId, 'Test Failure');
    assert.strictEqual(taskManager.getTask(failedTaskId).status, 'FAILED');

    // Attempt to pollute failed task's correct captcha or captcha code
    taskManager.updateTask(failedTaskId, { correctCaptcha: '999999', captchaCode: '111111' });
    const failedTask = taskManager.getTask(failedTaskId);
    assert.strictEqual(failedTask.correctCaptcha, '999999', 'Failed task correctCaptcha was polluted');
    assert.strictEqual(failedTask.captchaCode, '111111', 'Failed task captchaCode was polluted');
  });

  test('3. Verify lack of captcha brute-force rate-limiting and lockout', async () => {
    const taskId = `brute-force-${Date.now()}`;
    const task = taskManager.createTask(taskId);
    taskManager.pauseTask(taskId, 'CAPTCHA');

    assert.strictEqual(task.status, 'PAUSED_SECURITY');

    // Perform multiple failed resume attempts
    for (let i = 0; i < 20; i++) {
      const res = taskManager.resumeTask(taskId, `wrong-code-${i}`);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'Invalid captcha code');
    }

    // Verify task is STILL paused and not failed/locked out
    assert.strictEqual(task.status, 'PAUSED_SECURITY', 'Task status should remain PAUSED_SECURITY after multiple failed attempts');
    
    // Verify that the correct captcha STILL works
    const correctRes = taskManager.resumeTask(taskId, task.correctCaptcha);
    assert.strictEqual(correctRes.success, true, 'Correct captcha should still work');
    assert.strictEqual(task.status, 'RUNNING');
  });

  test('4. Verify captcha exposure endpoint (unauthenticated)', async () => {
    const taskId = `captcha-exposure-${Date.now()}`;
    const task = taskManager.createTask(taskId);
    
    // Fetch captcha from the public API
    const response = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`);
    assert.strictEqual(response.status, 205 || 200); // Wait, response could be 200
    const data = await response.json();
    
    assert.strictEqual(data.captcha, task.correctCaptcha, 'Public API exposed the correct captcha');
  });
});
