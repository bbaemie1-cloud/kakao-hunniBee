const { describe, test } = require('node:test');
const assert = require('node:assert');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

describe('Tier 3: Cross-Feature Combination Tests', () => {
  test('3.1. Multi-user task interleaving ensures independent execution and no crosstalk', async () => {
    // 1. Trigger webhook for User A
    const resA = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: 'user-interleave-A' }
        }
      })
    });
    assert.strictEqual(resA.status, 200);
    const dataA = await resA.json();
    const textA = dataA.template.outputs[0].simpleText.text;
    const taskIdA = textA.match(/작업 ID:\s*(task-[^\s)]+)/)[1];

    // 2. Trigger webhook for User B
    const resB = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: 'user-interleave-B' }
        }
      })
    });
    assert.strictEqual(resB.status, 200);
    const dataB = await resB.json();
    const textB = dataB.template.outputs[0].simpleText.text;
    const taskIdB = textB.match(/작업 ID:\s*(task-[^\s)]+)/)[1];

    // 3. Poll until both reach PAUSED_SECURITY
    let pausedA = false;
    let pausedB = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (!pausedA) {
        const statusRes = await fetch(`${BASE_URL}/api/automation/status/${taskIdA}`);
        const statusData = await statusRes.json();
        if (statusData.status === 'PAUSED_SECURITY') pausedA = true;
      }
      if (!pausedB) {
        const statusRes = await fetch(`${BASE_URL}/api/automation/status/${taskIdB}`);
        const statusData = await statusRes.json();
        if (statusData.status === 'PAUSED_SECURITY') pausedB = true;
      }
      if (pausedA && pausedB) break;
    }
    assert.ok(pausedA, 'Task A should be paused');
    assert.ok(pausedB, 'Task B should be paused');

    // Get correct captchas
    const capResA = await fetch(`${BASE_URL}/api/automation/captcha/${taskIdA}`);
    const capDataA = await capResA.json();
    const captchaA = capDataA.captcha;

    const capResB = await fetch(`${BASE_URL}/api/automation/captcha/${taskIdB}`);
    const capDataB = await capResB.json();
    const captchaB = capDataB.captcha;

    // 4. Resume User B first
    const resumeResB = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: taskIdB, captchaCode: captchaB })
    });
    assert.strictEqual(resumeResB.status, 200);

    // 5. Verify User B completed, and User A remains paused
    let completedB = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const statusResB = await fetch(`${BASE_URL}/api/automation/status/${taskIdB}`);
      const statusDataB = await statusResB.json();
      if (statusDataB.status === 'COMPLETED') {
        completedB = true;
        break;
      }
    }
    assert.ok(completedB, 'Task B should complete');

    const statusResA = await fetch(`${BASE_URL}/api/automation/status/${taskIdA}`);
    const statusDataA = await statusResA.json();
    assert.strictEqual(statusDataA.status, 'PAUSED_SECURITY', 'Task A should remain paused');

    // 6. Resume User A
    const resumeResA = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: taskIdA, captchaCode: captchaA })
    });
    assert.strictEqual(resumeResA.status, 200);

    // 7. Verify User A completed
    let completedA = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const statusResA = await fetch(`${BASE_URL}/api/automation/status/${taskIdA}`);
      const statusDataA = await statusResA.json();
      if (statusDataA.status === 'COMPLETED') {
        completedA = true;
        break;
      }
    }
    assert.ok(completedA, 'Task A should complete');
  });

  test('3.2. Concurrent webhook and resume executions are processed robustly without errors', async () => {
    const concurrentCount = 3;
    
    // 1. Fire webhook requests concurrently
    const webhookPromises = Array.from({ length: concurrentCount }, (_, i) =>
      fetch(`${BASE_URL}/api/kakao/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userRequest: {
            utterance: '승인',
            user: { id: `concurrent-user-${i}-${Date.now()}` }
          }
        })
      }).then(async r => {
        assert.strictEqual(r.status, 200);
        return r.json();
      })
    );

    const webhookResponses = await Promise.all(webhookPromises);
    const taskIds = webhookResponses.map(res => 
      res.template.outputs[0].simpleText.text.match(/작업 ID:\s*(task-[^\s)]+)/)[1]
    );

    // 2. Poll concurrently until all reach PAUSED_SECURITY
    await Promise.all(taskIds.map(async (taskId) => {
      let paused = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        const statusRes = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
        const statusData = await statusRes.json();
        if (statusData.status === 'PAUSED_SECURITY') {
          paused = true;
          break;
        }
      }
      assert.ok(paused, `Task ${taskId} should transition to PAUSED_SECURITY`);
    }));

    // 3. Fetch all captchas and resume concurrently
    const resumePromises = taskIds.map(async (taskId) => {
      const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`);
      const capData = await capRes.json();
      const captcha = capData.captcha;

      const resumeRes = await fetch(`${BASE_URL}/api/automation/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, captchaCode: captcha })
      });
      assert.strictEqual(resumeRes.status, 200);
    });

    await Promise.all(resumePromises);

    // 4. Verify all tasks reach COMPLETED state concurrently
    await Promise.all(taskIds.map(async (taskId) => {
      let completed = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        const statusRes = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
        const statusData = await statusRes.json();
        if (statusData.status === 'COMPLETED') {
          completed = true;
          break;
        }
      }
      assert.ok(completed, `Task ${taskId} should complete successfully`);
    }));
  });

  test('3.3. Status monitoring interactions report precise sequential status transitions', async () => {
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: 'status-monitor-user' }
        }
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const taskId = data.template.outputs[0].simpleText.text.match(/작업 ID:\s*(task-[^\s)]+)/)[1];

    const statusHistory = [];
    let isPaused = false;
    let captcha = '';

    // Poll rapidly to capture transitions
    for (let i = 0; i < 60; i++) {
      const statusRes = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
      const statusData = await statusRes.json();
      statusHistory.push(statusData.status);

      if (statusData.status === 'PAUSED_SECURITY' && !isPaused) {
        isPaused = true;
        const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`);
        const capData = await capRes.json();
        captcha = capData.captcha;

        // Resume task immediately
        const resumeRes = await fetch(`${BASE_URL}/api/automation/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, captchaCode: captcha })
        });
        assert.strictEqual(resumeRes.status, 200);
      }

      if (statusData.status === 'COMPLETED') {
        break;
      }
      await new Promise(r => setTimeout(r, 200));
    }

    // Assert transitions occurred correctly
    assert.ok(statusHistory.includes('RUNNING'), 'Status history should contain RUNNING');
    assert.ok(statusHistory.includes('PAUSED_SECURITY'), 'Status history should contain PAUSED_SECURITY');
    assert.strictEqual(statusHistory[statusHistory.length - 1], 'COMPLETED', 'Final status should be COMPLETED');
  });
});
