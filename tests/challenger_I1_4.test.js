const { describe, test } = require('node:test');
const assert = require('node:assert');
const taskManager = require('../src/automation/taskManager');

describe('Challenger I1_4: Empirical Verification Tests', () => {

  test('1. Verify that short timeouts correctly reject the deferred promise (validates I1 Retry 1 timeout implementation)', async () => {
    const taskId = `timeout-reject-test-${Date.now()}`;
    const task = taskManager.createTask(taskId);
    assert.strictEqual(task.status, 'RUNNING');

    // Pause the task with a very short timeout of 50ms
    const pausePromise = taskManager.pauseTask(taskId, 'CAPTCHA_TEXT', 50);
    assert.strictEqual(task.status, 'PAUSED_SECURITY');

    try {
      await pausePromise;
      assert.fail('The promise should have rejected due to safety timeout');
    } catch (err) {
      assert.ok(err.message.includes('timed out'), `Expected timeout error, got: ${err.message}`);
      assert.strictEqual(task.status, 'FAILED');
      assert.strictEqual(task.error, 'Task paused due to security check timed out');
    }
  });

  test('2. Verify that cancelTask resolves deferred with "CANCELLED", leading to potential browser hang', async () => {
    const taskId = `cancel-hang-test-${Date.now()}`;
    const task = taskManager.createTask(taskId);
    
    const pausePromise = taskManager.pauseTask(taskId, 'CAPTCHA_TEXT', 5000);
    assert.strictEqual(task.status, 'PAUSED_SECURITY');

    // Cancel the task
    const cancelRes = taskManager.cancelTask(taskId, 'Deliberate cancellation');
    assert.strictEqual(cancelRes.success, true);
    assert.strictEqual(task.status, 'FAILED');
    assert.strictEqual(task.error, 'Deliberate cancellation');

    // The promise resolves with 'CANCELLED' instead of rejecting
    const resolvedValue = await pausePromise;
    assert.strictEqual(resolvedValue, 'CANCELLED');
    
    // Note: If browser.js does not check for 'CANCELLED', it will proceed to input 'CANCELLED' into the captcha input,
    // which fails validation in secure.html, leading to a silent browser hang in page.waitForNavigation().
  });

  test('3. Verify that calling pauseTask twice overwrites deferred and resolves the first promise with "CANCELLED"', async () => {
    const taskId = `double-pause-leak-test-${Date.now()}`;
    const task = taskManager.createTask(taskId);

    const promise1 = taskManager.pauseTask(taskId, 'CAPTCHA1', 5000);
    const deferred1 = task.deferred;

    const promise2 = taskManager.pauseTask(taskId, 'CAPTCHA2', 5000);
    const deferred2 = task.deferred;

    // Verify deferred was overwritten
    assert.notStrictEqual(deferred1, deferred2);

    // Resolve task with the correct captcha
    taskManager.resumeTask(taskId, task.correctCaptcha);

    // promise2 resolves successfully
    const val2 = await promise2;
    assert.strictEqual(val2, task.correctCaptcha);

    // promise1 is resolved with 'CANCELLED'
    const val1 = await promise1;
    assert.strictEqual(val1, 'CANCELLED');
  });

  test('4. Verify that state pollution is prevented when form is re-submitted for completed/failed tasks', async () => {
    // This is tested in server integration, but we can verify taskManager state updates directly.
    const taskId = `state-pollution-test-${Date.now()}`;
    const task = taskManager.createTask(taskId, { name: 'Original Name' });
    
    taskManager.completeTask(taskId);
    assert.strictEqual(task.status, 'COMPLETED');

    // Attempting to update a completed task should return early and not modify its properties
    taskManager.updateTask(taskId, { formData: { name: 'Polluted Name' } });
    
    const updatedTask = taskManager.getTask(taskId);
    assert.strictEqual(updatedTask.status, 'COMPLETED');
    assert.notStrictEqual(updatedTask.formData.name, 'Polluted Name');
    assert.strictEqual(task.formData.name, 'Original Name');
  });
});
