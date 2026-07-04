const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const taskManager = require('../src/automation/taskManager');
const { startServer } = require('../src/server');

const PORT = 3010; // Distinct port to avoid conflicts
const BASE_URL = `http://localhost:${PORT}`;
let server;

describe('Challenger Empirical Tests - KakaoTalk Admin Assistant', () => {
  before(async () => {
    server = await startServer(PORT);
    console.log(`Challenger test server started on port ${PORT}`);
  });

  after(() => {
    if (server) {
      server.close();
      console.log('Challenger test server stopped');
    }
  });

  describe('1. Concurrency Verification', () => {
    test('verifies concurrent independent tasks and browser flows', async () => {
      const concurrency = 3;
      const tasks = [];

      for (let i = 0; i < concurrency; i++) {
        const taskId = `challenger-concurrency-${i}-${Date.now()}`;
        const formData = {
          name: `Challenger User ${i}`,
          email: `challenger${i}@example.com`,
          amount: 5000000 + i * 1000000
        };
        const task = taskManager.createTask(taskId, formData);
        tasks.push(task);
      }

      // Check task structures
      for (const task of tasks) {
        assert.strictEqual(task.status, 'RUNNING');
        assert.ok(task.correctCaptcha);
        assert.strictEqual(task.correctCaptcha.length, 6);
      }

      // Concurrently run automation using Playwright
      const { runAutomation } = require('../src/automation/browser');
      const automationPromises = tasks.map(t => runAutomation(t.taskId, PORT));

      // Wait until all are paused
      await new Promise((resolve) => {
        const interval = setInterval(() => {
          const allPaused = tasks.every(t => {
            const currentTask = taskManager.getTask(t.taskId);
            return currentTask && currentTask.status === 'PAUSED_SECURITY';
          });
          if (allPaused) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      });

      // Resume concurrently with their respective correct captchas
      for (const task of tasks) {
        const result = taskManager.resumeTask(task.taskId, task.correctCaptcha);
        assert.strictEqual(result.success, true);
      }

      await Promise.all(automationPromises);

      // Verify all finished successfully
      for (const task of tasks) {
        const currentTask = taskManager.getTask(task.taskId);
        assert.strictEqual(currentTask.status, 'COMPLETED');
        assert.strictEqual(currentTask.error, null);
      }
    });
  });

  describe('2. Invalid States & Transitions', () => {
    test('rejects resume when task is not in PAUSED_SECURITY status', async () => {
      const taskId = `challenger-invalid-status-${Date.now()}`;
      taskManager.createTask(taskId);

      // Try resuming a RUNNING task
      const res = taskManager.resumeTask(taskId, '123456');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'Task is not paused');
    });

    test('re-submitting form for an already completed task is rejected by the server', async () => {
      const taskId = `challenger-pollute-${Date.now()}`;
      const task = taskManager.createTask(taskId, {
        name: 'Initial Name',
        email: 'init@example.com',
        amount: 1000
      });

      // Set to COMPLETED manually
      taskManager.updateTask(taskId, { status: 'COMPLETED' });

      // Send form submission again
      const response = await fetch(`${BASE_URL}/api/submit-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          taskId,
          name: 'Polluted Name',
          email: 'polluted@example.com',
          amount: '999999'
        })
      });

      assert.strictEqual(response.status, 400);

      // Verify task state was NOT polluted/overwritten
      const updatedTask = taskManager.getTask(taskId);
      assert.strictEqual(updatedTask.formData.name, 'Initial Name');
      assert.strictEqual(updatedTask.formData.email, 'init@example.com');
    });
  });

  describe('3. Edge Cases (Zero/Negative Timeouts)', () => {
    test('confirms safety timeout implementation in pauseTask', async () => {
      const taskId = `challenger-timeout-${Date.now()}`;
      taskManager.createTask(taskId);

      // Pass zero and negative timeouts to pauseTask
      const promiseZero = taskManager.pauseTask(taskId, '123456', 0);
      
      try {
        await promiseZero;
        assert.fail('Expected pauseTask to reject with zero timeout');
      } catch (error) {
        assert.ok(error.message.includes('timed out'));
        assert.strictEqual(taskManager.getTask(taskId).status, 'FAILED');
      }

      const taskId2 = `challenger-timeout-neg-${Date.now()}`;
      taskManager.createTask(taskId2);
      const promiseNegative = taskManager.pauseTask(taskId2, '123456', -5000);

      try {
        await promiseNegative;
        assert.fail('Expected pauseTask to reject with negative timeout');
      } catch (error) {
        assert.ok(error.message.includes('timed out'));
        assert.strictEqual(taskManager.getTask(taskId2).status, 'FAILED');
      }
    });
  });

  describe('4. Form Field Validation Mismatch & Playwright Hangs', () => {
    test('mismatch: email accepted by server but rejected by browser HTML5 validation fails immediately', async () => {
      const taskId = `challenger-validation-mismatch-${Date.now()}`;
      taskManager.createTask(taskId, {
        name: 'Valid Name',
        email: 'invalid-email@', // Mismatch email: server accepts it because it includes '@', but browser rejects it!
        amount: 5000
      });

      const { runAutomation } = require('../src/automation/browser');
      
      // Start automation and wait for it. It should fail immediately.
      await runAutomation(taskId, PORT);

      const task = taskManager.getTask(taskId);
      assert.strictEqual(task.status, 'FAILED');
      assert.ok(task.error && (task.error.includes('validation') || task.error.includes('Validation')));
    });
  });

  describe('5. Browser Form Field Layout Validity', () => {
    test('verifies vertical layout and label matching in form.html', async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(`${BASE_URL}/form.html`);

        const fields = ['#name', '#email', '#amount'];
        const boxes = {};

        for (const field of fields) {
          const el = await page.$(field);
          assert.ok(el, `Field ${field} must exist`);
          assert.ok(await el.isVisible(), `Field ${field} must be visible`);
          const box = await el.boundingBox();
          assert.ok(box, `Field ${field} must have bounding box`);
          boxes[field] = box;
        }

        // Layout check
        assert.ok(boxes['#name'].y < boxes['#email'].y, 'Name input must be above email input');
        assert.ok(boxes['#email'].y < boxes['#amount'].y, 'Email input must be above amount input');

        // Check matching labels exist
        for (const field of ['name', 'email', 'amount']) {
          const label = await page.$(`label[for="${field}"]`);
          assert.ok(label, `Label for "${field}" must exist`);
          assert.ok(await label.isVisible(), `Label for "${field}" must be visible`);
        }
      } finally {
        await browser.close();
      }
    });

    test('verifies vertical layout in secure.html', async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(`${BASE_URL}/secure.html?taskId=dummy-task`);

        const captchaImg = await page.$('#captcha-image');
        const captchaInput = await page.$('#captcha');
        const verifyBtn = await page.$('#verify-btn');

        assert.ok(captchaImg && await captchaImg.isVisible());
        assert.ok(captchaInput && await captchaInput.isVisible());
        assert.ok(verifyBtn && await verifyBtn.isVisible());

        const imgBox = await captchaImg.boundingBox();
        const inputBox = await captchaInput.boundingBox();
        const btnBox = await verifyBtn.boundingBox();

        assert.ok(imgBox.y < inputBox.y, 'Captcha display must be above input field');
        assert.ok(inputBox.y < btnBox.y, 'Input field must be above verify button');
      } finally {
        await browser.close();
      }
    });
  });
});
