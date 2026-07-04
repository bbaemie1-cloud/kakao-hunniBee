const taskManager = require('../src/automation/taskManager');
const assert = require('assert');

async function testPauseResume() {
  console.log('--- Testing Pause & Resume ---');
  const taskId = 'task-test-resume';
  
  // 1. Create task
  console.log('Creating task...');
  const task = taskManager.createTask(taskId);
  taskManager.updateTask(taskId, { correctCaptcha: '123456' });
  assert.strictEqual(task.status, 'RUNNING');
  console.log('Task status is RUNNING: OK');

  // 2. Pause task
  console.log('Pausing task...');
  const pausePromise = taskManager.pauseTask(taskId, 'ABCDEF');
  assert.strictEqual(task.status, 'PAUSED_SECURITY');
  assert.strictEqual(task.captchaText, 'ABCDEF');
  console.log('Task status is PAUSED_SECURITY, captcha code saved: OK');

  // 3. Resume task asynchronously
  setTimeout(() => {
    console.log('Triggering resumeTask...');
    taskManager.resumeTask(taskId, '123456');
  }, 100);

  // 4. Await the deferred promise
  console.log('Waiting for pausePromise to resolve...');
  const resolvedCode = await pausePromise;
  assert.strictEqual(resolvedCode, '123456');
  assert.strictEqual(task.status, 'RUNNING');
  console.log(`Promise resolved with captchaCode "${resolvedCode}", status is RUNNING: OK`);
}

async function testPauseTimeout() {
  console.log('\n--- Testing Pause Timeout ---');
  const taskId = 'task-test-timeout';

  // 1. Create task
  console.log('Creating task...');
  const task = taskManager.createTask(taskId);
  assert.strictEqual(task.status, 'RUNNING');

  // 2. Pause task with a short timeout of 200ms
  console.log('Pausing task with 200ms timeout...');
  const pausePromise = taskManager.pauseTask(taskId, 'XYZ987', 200);
  assert.strictEqual(task.status, 'PAUSED_SECURITY');

  // 3. Await promise and expect rejection due to timeout
  console.log('Waiting for pausePromise to timeout and reject...');
  try {
    await pausePromise;
    assert.fail('Promise should have rejected on timeout');
  } catch (error) {
    console.log(`Caught expected error: "${error.message}"`);
    assert.ok(error.message.includes('timed out'));
    assert.strictEqual(task.status, 'FAILED');
    console.log('Task status transitioned to FAILED: OK');
  }
}

async function run() {
  try {
    await testPauseResume();
    await testPauseTimeout();
    console.log('\nAll TaskManager checks passed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('\nVerification failed:', err);
    process.exit(1);
  }
}

run();
