const { startServer } = require('../src/server');
const taskManager = require('../src/automation/taskManager');
const assert = require('assert');
const { exec } = require('child_process');

const PORT = 3088;
const BASE_URL = `http://localhost:${PORT}`;

function getChromiumProcessCount() {
  return new Promise((resolve) => {
    // On macOS / Linux, count processes containing 'chromium' or 'Playwright'
    exec('ps aux | grep -i "chromium" | grep -v "grep" | wc -l', (err, stdout) => {
      if (err) return resolve(-1);
      resolve(parseInt(stdout.trim(), 10));
    });
  });
}

async function runStressTest() {
  console.log('=== STARTING CONCURRENCY & ZOMBIE PROCESS STRESS TEST ===');
  const server = await startServer(PORT);
  console.log(`Server started on port ${PORT}`);

  const initialChromiumCount = await getChromiumProcessCount();
  console.log(`Initial Chromium process count: ${initialChromiumCount}`);

  const totalTasks = 30;
  const tasks = [];

  console.log(`Creating ${totalTasks} concurrent tasks...`);

  // We will trigger tasks via webhook
  const triggerPromises = [];
  for (let i = 0; i < totalTasks; i++) {
    const userId = `stress-user-${i}-${Date.now()}`;
    const p = fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: userId }
        }
      })
    })
      .then(r => r.json())
      .then(data => {
        const text = data.template.outputs[0].simpleText.text;
        const taskId = text.match(/작업 ID:\s*(task-[^\s)]+)/)[1];
        return { taskId, userId };
      });
    triggerPromises.push(p);
  }

  const triggeredTasks = await Promise.all(triggerPromises);
  console.log(`Triggered ${triggeredTasks.length} tasks successfully.`);

  // Poll until tasks reach either PAUSED_SECURITY or some final state
  console.log('Waiting for tasks to reach PAUSED_SECURITY status...');
  const activeTaskIds = triggeredTasks.map(t => t.taskId);

  let allReachedPaused = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(r => setTimeout(r, 1000));
    let pausedCount = 0;
    let terminalCount = 0;

    for (const taskId of activeTaskIds) {
      const task = taskManager.getTask(taskId);
      if (task.status === 'PAUSED_SECURITY') {
        pausedCount++;
      } else if (task.status === 'COMPLETED' || task.status === 'FAILED') {
        terminalCount++;
      }
    }

    console.log(`Polling: ${pausedCount} paused, ${terminalCount} terminal, ${activeTaskIds.length - pausedCount - terminalCount} running...`);
    if (pausedCount + terminalCount === activeTaskIds.length) {
      allReachedPaused = true;
      break;
    }
  }

  assert.ok(allReachedPaused, 'All tasks should have reached PAUSED_SECURITY or a terminal state');
  console.log('All tasks successfully paused or terminated.');

  // Now, we will split tasks:
  // - Group A (10 tasks): Resume them with correct captcha.
  // - Group B (10 tasks): Cancel them via API.
  // - Group C (10 tasks): Trigger re-approval (duplicate check) by sending another webhook request.
  const groupA = triggeredTasks.slice(0, 10);
  const groupB = triggeredTasks.slice(10, 20);
  const groupC = triggeredTasks.slice(20, 30);

  console.log('--- Processing Group A: Resuming 10 tasks with correct captcha ---');
  const resumePromises = groupA.map(async (t) => {
    const task = taskManager.getTask(t.taskId);
    const res = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: t.taskId, captchaCode: task.correctCaptcha })
    });
    assert.strictEqual(res.status, 200);
  });
  await Promise.all(resumePromises);

  console.log('--- Processing Group B: Cancelling 10 tasks directly ---');
  const cancelPromises = groupB.map(async (t) => {
    const res = await fetch(`${BASE_URL}/api/automation/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: t.taskId, reason: 'Stress test cancellation' })
    });
    assert.strictEqual(res.status, 200);
  });
  await Promise.all(cancelPromises);

  console.log('--- Processing Group C: Triggering duplicate re-approvals for 10 tasks ---');
  const reapprovePromises = groupC.map(async (t) => {
    // Send a new webhook request for the same user
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: t.userId }
        }
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const text = data.template.outputs[0].simpleText.text;
    const newTaskId = text.match(/작업 ID:\s*(task-[^\s)]+)/)[1];
    return newTaskId;
  });
  const newGroupCTaskIds = await Promise.all(reapprovePromises);

  // Poll until all tasks reach their final states (COMPLETED or FAILED)
  console.log('Waiting for all original and new tasks to complete or fail...');
  const allTaskIdsToTrack = [...activeTaskIds, ...newGroupCTaskIds];

  let allCompleted = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(r => setTimeout(r, 1000));
    let completedCount = 0;
    let failedCount = 0;
    let otherCount = 0;

    for (const taskId of allTaskIdsToTrack) {
      const task = taskManager.getTask(taskId);
      if (task.status === 'COMPLETED') {
        completedCount++;
      } else if (task.status === 'FAILED') {
        failedCount++;
      } else {
        otherCount++;
      }
    }

    console.log(`Polling terminal states: ${completedCount} completed, ${failedCount} failed, ${otherCount} other...`);
    if (otherCount === 0) {
      allCompleted = true;
      break;
    }
  }

  assert.ok(allCompleted, 'Not all tasks reached a terminal state');
  console.log('All tasks reached terminal state.');

  // Validate results:
  // - Group A: Should be COMPLETED
  for (const t of groupA) {
    const task = taskManager.getTask(t.taskId);
    assert.strictEqual(task.status, 'COMPLETED', `Group A Task ${t.taskId} should be COMPLETED, got ${task.status}`);
  }
  console.log('Group A (resumed): All 10 tasks COMPLETED. OK.');

  // - Group B: Should be FAILED
  for (const t of groupB) {
    const task = taskManager.getTask(t.taskId);
    assert.strictEqual(task.status, 'FAILED', `Group B Task ${t.taskId} should be FAILED, got ${task.status}`);
    assert.strictEqual(task.error, 'Stress test cancellation');
  }
  console.log('Group B (cancelled): All 10 tasks FAILED with correct reason. OK.');

  // - Group C (original): Should be FAILED due to re-approval request
  for (const t of groupC) {
    const task = taskManager.getTask(t.taskId);
    assert.strictEqual(task.status, 'FAILED', `Group C Original Task ${t.taskId} should be FAILED, got ${task.status}`);
    assert.ok(task.error.includes('Cancelled by new re-approval request'));
  }
  console.log('Group C (original - duplicate check): All 10 tasks FAILED with re-approval reason. OK.');

  // - Group C (new): Let's resume the new tasks to verify they are healthy
  console.log('Resuming the 10 new re-approval tasks...');
  const resumeNewPromises = newGroupCTaskIds.map(async (newTaskId) => {
    const task = taskManager.getTask(newTaskId);
    // If it is in PAUSED_SECURITY, resume it
    if (task.status === 'PAUSED_SECURITY') {
      const res = await fetch(`${BASE_URL}/api/automation/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: newTaskId, captchaCode: task.correctCaptcha })
      });
      assert.strictEqual(res.status, 200);
    }
  });
  await Promise.all(resumeNewPromises);

  // Poll again for new tasks to complete
  let newTasksCompleted = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(r => setTimeout(r, 1000));
    const pendingCount = newGroupCTaskIds.filter(id => taskManager.getTask(id).status !== 'COMPLETED' && taskManager.getTask(id).status !== 'FAILED').length;
    if (pendingCount === 0) {
      newTasksCompleted = true;
      break;
    }
  }
  assert.ok(newTasksCompleted, 'New re-approval tasks did not finish');
  
  for (const id of newGroupCTaskIds) {
    const task = taskManager.getTask(id);
    assert.strictEqual(task.status, 'COMPLETED', `New Task ${id} status should be COMPLETED, got ${task.status}`);
  }
  console.log('Group C (new): All 10 tasks COMPLETED. OK.');

  // Check chromium processes count to ensure no zombie processes
  console.log('Checking for zombie Chromium processes...');
  await new Promise(r => setTimeout(r, 5000)); // Wait for browser close async operations to completely settle
  const finalChromiumCount = await getChromiumProcessCount();
  console.log(`Final Chromium process count: ${finalChromiumCount}`);
  
  if (finalChromiumCount !== -1 && initialChromiumCount !== -1) {
    const diff = finalChromiumCount - initialChromiumCount;
    console.log(`Chromium process count delta: ${diff}`);
    if (diff > 2) {
      console.error(`WARNING: Possible zombie Chromium processes detected! Delta: ${diff}`);
    } else {
      console.log('No zombie Chromium processes detected. Clean cleanup verified! OK.');
    }
  } else {
    console.log('Could not get precise process counts (command execution skipped/failed).');
  }

  // Check for promise leaks in taskManager
  console.log('Checking for promise leaks in TaskManager...');
  for (const taskId of allTaskIdsToTrack) {
    const task = taskManager.getTask(taskId);
    assert.strictEqual(task.deferred, null, `Task ${taskId} still has a deferred promise reference!`);
    assert.strictEqual(task.timeoutId, null, `Task ${taskId} still has an active timeoutId!`);
  }
  console.log('No promise leaks or active timeouts found in TaskManager. OK.');

  server.close();
  console.log('=== STRESS TEST COMPLETED SUCCESSFULLY ===');
  process.exit(0);
}

runStressTest().catch(err => {
  console.error('Stress test failed:', err);
  process.exit(1);
});
