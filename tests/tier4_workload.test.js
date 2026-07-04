const { describe, test } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

describe('Tier 4: Real-World Workload Scenarios', () => {
  // Test 4.1: Complete end-to-end happy flow
  test('4.1. Complete end-to-end happy path flow', async () => {
    // 1. Webhook trigger
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: 'happy-path-user' }
        }
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const taskId = data.template.outputs[0].simpleText.text.match(/작업 ID:\s*(task-[^\s)]+)/)[1];

    // 2. Poll until paused
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
    assert.ok(paused, 'Task should transition to PAUSED_SECURITY');

    // 3. Get captcha
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    const capData = await capRes.json();
    const captcha = capData.captcha;

    // 4. Resume
    const resumeRes = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, captchaCode: captcha })
    });
    assert.strictEqual(resumeRes.status, 200);

    // 5. Poll until complete
    let completed = false;
    let finalUrl = '';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const statusRes = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
      const statusData = await statusRes.json();
      if (statusData.status === 'COMPLETED') {
        completed = true;
        finalUrl = statusData.currentUrl;
        break;
      }
    }
    assert.ok(completed, 'Task should reach COMPLETED state');
    assert.ok(finalUrl.includes('success.html'), 'Task final URL should be success.html');
  });

  // Test 4.2: Captcha retry flow (wrong captcha then right captcha)
  test('4.2. Captcha retry flow - wrong captcha keeps task paused, right captcha completes it', async () => {
    // 1. Webhook trigger
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: 'captcha-retry-user' }
        }
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const taskId = data.template.outputs[0].simpleText.text.match(/작업 ID:\s*(task-[^\s)]+)/)[1];

    // 2. Poll until paused
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
    assert.ok(paused, 'Task should transition to PAUSED_SECURITY');

    // 3. Resume with wrong captcha
    const resumeWrong = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, captchaCode: 'incorrect-code-123' })
    });
    assert.strictEqual(resumeWrong.status, 400);
    const wrongData = await resumeWrong.json();
    assert.strictEqual(wrongData.success, false);

    // Verify task is still in PAUSED_SECURITY status
    const statusMidRes = await fetch(`${BASE_URL}/api/automation/status/${taskId}`);
    const statusMidData = await statusMidRes.json();
    assert.strictEqual(statusMidData.status, 'PAUSED_SECURITY', 'Task must remain paused after a wrong captcha');

    // 4. Retrieve correct captcha and resume
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    const capData = await capRes.json();
    const captcha = capData.captcha;

    const resumeCorrect = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, captchaCode: captcha })
    });
    assert.strictEqual(resumeCorrect.status, 200);

    // 5. Poll until complete
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
    assert.ok(completed, 'Task should reach COMPLETED state after entering correct captcha');
  });

  // Test 4.3: Form submit validations and recovery
  test('4.3. Form submit validations and recovery via Playwright browser interaction', async () => {
    const taskId = `task-form-validation-${Date.now()}`;
    // Register task in TaskManager so we can load the form page directly
    const createRes = await fetch(`${BASE_URL}/api/test/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        formData: { name: '홍길동', email: 'hong@example.com', amount: 10000000 }
      })
    });
    assert.strictEqual(createRes.status, 200);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${BASE_URL}/form.html?taskId=${taskId}`);

      // 1. Submit with empty name (browser-side required validation)
      await page.fill('#name', '');
      await page.fill('#email', 'hong@example.com');
      await page.fill('#amount', '10000000');
      
      // Submit will not navigate due to required field check. We can assert the URL is still form.html
      await page.click('#submit-btn');
      await new Promise(r => setTimeout(r, 200));
      assert.ok(page.url().includes('form.html'), 'Navigation should be blocked on empty name');

      // 2. Submit with invalid email format (browser-side type="email" validation)
      await page.fill('#name', '홍길동');
      await page.fill('#email', 'invalidemailformat');
      await page.click('#submit-btn');
      await new Promise(r => setTimeout(r, 200));
      assert.ok(page.url().includes('form.html'), 'Navigation should be blocked on invalid email');

      // 3. Complete form with valid details and submit
      await page.fill('#email', 'valid@example.com');
      
      await Promise.all([
        page.click('#submit-btn'),
        page.waitForNavigation()
      ]);

      // Verify redirection to secure.html
      assert.ok(page.url().includes('secure.html'), 'Should redirect to secure verification page');

      // 4. Retrieve captcha and finish flow
      const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`, {
        headers: {
          'Authorization': 'Bearer mock-secret-token-123'
        }
      });
      const capData = await capRes.json();
      const captcha = capData.captcha;

      await page.fill('#captcha', captcha);
      await Promise.all([
        page.click('#verify-btn'),
        page.waitForNavigation()
      ]);

      assert.ok(page.url().includes('success.html'), 'Should redirect to success confirmation page');
    } finally {
      await browser.close();
    }
  });

  // Test 4.4: Multi-user concurrent flows
  test('4.4. Multi-user concurrent flows under load', async () => {
    const concurrentCount = 5;
    
    // 1. Trigger concurrent webhook flows
    const webhookPromises = Array.from({ length: concurrentCount }, (_, i) =>
      fetch(`${BASE_URL}/api/kakao/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userRequest: {
            utterance: '승인',
            user: { id: `load-user-${i}-${Date.now()}` }
          }
        })
      }).then(r => r.json())
    );

    const responses = await Promise.all(webhookPromises);
    const taskIds = responses.map(res => 
      res.template.outputs[0].simpleText.text.match(/작업 ID:\s*(task-[^\s)]+)/)[1]
    );

    // 2. Poll status concurrently
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
      assert.ok(paused, `Task ${taskId} did not reach PAUSED_SECURITY`);
    }));

    // 3. Resume all concurrently
    const resumePromises = taskIds.map(async (taskId) => {
      const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`, {
        headers: {
          'Authorization': 'Bearer mock-secret-token-123'
        }
      });
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

    // 4. Verify all complete successfully
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
      assert.ok(completed, `Task ${taskId} did not complete`);
    }));
  });

  // Test 4.5: Re-approval task cancellation flow
  test('4.5. Re-approval task cancellation flow triggers cancellation of previous active task', async () => {
    const userId = `reapprove-user-${Date.now()}`;

    // 1. Trigger first webhook request
    const res1 = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: userId }
        }
      })
    });
    assert.strictEqual(res1.status, 200);
    const data1 = await res1.json();
    const taskId1 = data1.template.outputs[0].simpleText.text.match(/작업 ID:\s*(task-[^\s)]+)/)[1];

    // Wait until taskId1 reaches PAUSED_SECURITY status
    let paused1 = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const statusRes = await fetch(`${BASE_URL}/api/automation/status/${taskId1}`);
      const statusData = await statusRes.json();
      if (statusData.status === 'PAUSED_SECURITY') {
        paused1 = true;
        break;
      }
    }
    assert.ok(paused1, 'First task should transition to PAUSED_SECURITY');

    // 2. Trigger second webhook request (re-approval) from same user before resuming first task
    const res2 = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: userId }
        }
      })
    });
    assert.strictEqual(res2.status, 200);
    const data2 = await res2.json();
    const taskId2 = data2.template.outputs[0].simpleText.text.match(/작업 ID:\s*(task-[^\s)]+)/)[1];

    assert.notStrictEqual(taskId1, taskId2, 'Second task must have a different ID');

    // 3. Verify that taskId1 is immediately marked as FAILED with cancellation info
    const status1Res = await fetch(`${BASE_URL}/api/automation/status/${taskId1}`);
    const status1Data = await status1Res.json();
    assert.strictEqual(status1Data.status, 'FAILED');
    assert.ok(status1Data.error.includes('Cancelled by new re-approval request'), 'Error must specify re-approval cancellation');

    // 4. Try to resume taskId1 with its captcha, which should fail
    const cap1Res = await fetch(`${BASE_URL}/api/automation/captcha/${taskId1}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    const cap1Data = await cap1Res.json();
    const resume1Res = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: taskId1, captchaCode: cap1Data.captcha })
    });
    assert.strictEqual(resume1Res.status, 400); // Bad Request (not paused)

    // 5. Verify taskId2 reaches PAUSED_SECURITY, resume it, and ensure it reaches COMPLETED
    let paused2 = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const statusRes = await fetch(`${BASE_URL}/api/automation/status/${taskId2}`);
      const statusData = await statusRes.json();
      if (statusData.status === 'PAUSED_SECURITY') {
        paused2 = true;
        break;
      }
    }
    assert.ok(paused2, 'Second task should transition to PAUSED_SECURITY');

    const cap2Res = await fetch(`${BASE_URL}/api/automation/captcha/${taskId2}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    const cap2Data = await cap2Res.json();

    const resume2Res = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: taskId2, captchaCode: cap2Data.captcha })
    });
    assert.strictEqual(resume2Res.status, 200);

    let completed2 = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const statusRes = await fetch(`${BASE_URL}/api/automation/status/${taskId2}`);
      const statusData = await statusRes.json();
      if (statusData.status === 'COMPLETED') {
        completed2 = true;
        break;
      }
    }
    assert.ok(completed2, 'Second task should complete successfully');
  });
});
