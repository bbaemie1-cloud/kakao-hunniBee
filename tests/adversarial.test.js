const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const taskManager = require('../src/automation/taskManager');
const { startServer } = require('../src/server');

const PORT = 3005; // Use a different port to avoid conflicts
const BASE_URL = `http://localhost:${PORT}`;
let server;

describe('Adversarial & Robustness Tests', () => {
  before(async () => {
    server = await startServer(PORT);
    console.log(`Test server started on port ${PORT}`);
  });

  after(() => {
    if (server) {
      server.close();
      console.log('Test server stopped');
    }
  });

  describe('1. Concurrency Stress Tests', () => {
    test('handles multiple concurrent tasks without cross-talk or state contamination', async () => {
      const taskCount = 10;
      const tasks = [];

      // Create tasks
      for (let i = 0; i < taskCount; i++) {
        const taskId = `concurrency-task-${i}-${Date.now()}`;
        const formData = {
          name: `User ${i}`,
          email: `user${i}@example.com`,
          amount: 1000000 + i * 100000
        };
        const task = taskManager.createTask(taskId, formData);
        tasks.push(task);
      }

      // Verify all tasks created in RUNNING state
      for (const task of tasks) {
        assert.strictEqual(taskManager.getTask(task.taskId).status, 'RUNNING');
      }

      // Concurrently pause all tasks
      const pausePromises = tasks.map(task => taskManager.pauseTask(task.taskId));

      // Verify all tasks transitioned to PAUSED_SECURITY
      for (const task of tasks) {
        assert.strictEqual(taskManager.getTask(task.taskId).status, 'PAUSED_SECURITY');
        assert.ok(taskManager.getTask(task.taskId).deferred);
      }

      // Resume tasks in reverse order with correct and incorrect captchas
      for (let i = taskCount - 1; i >= 0; i--) {
        const task = tasks[i];
        
        // Try incorrect captcha first
        const wrongResult = taskManager.resumeTask(task.taskId, 'invalid-captcha');
        assert.strictEqual(wrongResult.success, false);
        assert.strictEqual(taskManager.getTask(task.taskId).status, 'PAUSED_SECURITY');

        // Resume with correct captcha
        const correctCaptcha = task.correctCaptcha;
        const rightResult = taskManager.resumeTask(task.taskId, correctCaptcha);
        assert.strictEqual(rightResult.success, true);

        // Await the corresponding promise
        const resolvedCode = await pausePromises[i];
        assert.strictEqual(resolvedCode, correctCaptcha);
        assert.strictEqual(taskManager.getTask(task.taskId).status, 'RUNNING');
      }
    });

    test('handles concurrent full Playwright browser runs', async () => {
      const concurrency = 3;
      const taskIds = Array.from({ length: concurrency }, (_, i) => `pw-concurrency-${i}-${Date.now()}`);
      
      // Initialize tasks
      for (let i = 0; i < concurrency; i++) {
        taskManager.createTask(taskIds[i], {
          name: `Browser Runner ${i}`,
          email: `runner${i}@example.com`,
          amount: 5000000
        });
      }

      const { runAutomation } = require('../src/automation/browser');

      // Trigger automation flows concurrently
      const runs = taskIds.map(taskId => runAutomation(taskId, PORT));

      // Poll until all tasks reach PAUSED_SECURITY
      await new Promise(resolve => {
        const interval = setInterval(() => {
          const allPaused = taskIds.every(id => {
            const task = taskManager.getTask(id);
            return task && task.status === 'PAUSED_SECURITY';
          });
          if (allPaused) {
            clearInterval(interval);
            resolve();
          }
        }, 200);
      });

      // Resume all tasks concurrently with their correct captcha codes
      for (const taskId of taskIds) {
        const task = taskManager.getTask(taskId);
        const resumeRes = taskManager.resumeTask(taskId, task.correctCaptcha);
        assert.strictEqual(resumeRes.success, true);
      }

      // Await all browser flows to finish
      await Promise.all(runs);

      // Verify all tasks reached COMPLETED state
      for (const taskId of taskIds) {
        const task = taskManager.getTask(taskId);
        assert.strictEqual(task.status, 'COMPLETED', `Task ${taskId} should be COMPLETED, got ${task.status} (error: ${task.error})`);
      }
    });
  });

  describe('2. Invalid State Transition Tests', () => {
    test('rejects resuming an already completed task', async () => {
      const taskId = `invalid-state-completed-${Date.now()}`;
      const task = taskManager.createTask(taskId);
      
      // Manually set status to COMPLETED
      taskManager.updateTask(taskId, { status: 'COMPLETED' });

      const result = taskManager.resumeTask(taskId, task.correctCaptcha);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, 'Task is not paused');
    });

    test('rejects resuming an already failed task', async () => {
      const taskId = `invalid-state-failed-${Date.now()}`;
      const task = taskManager.createTask(taskId);
      
      // Manually set status to FAILED
      taskManager.updateTask(taskId, { status: 'FAILED', error: 'Some error' });

      const result = taskManager.resumeTask(taskId, task.correctCaptcha);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, 'Task is not paused');
    });

    test('rejects resuming a task that is running', async () => {
      const taskId = `invalid-state-running-${Date.now()}`;
      const task = taskManager.createTask(taskId);

      assert.strictEqual(task.status, 'RUNNING');
      const result = taskManager.resumeTask(taskId, task.correctCaptcha);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, 'Task is not paused');
    });

    test('calling pauseTask twice on the same task overwrites deferred and resolves the first promise with CANCELLED', async () => {
      const taskId = `double-pause-${Date.now()}`;
      taskManager.createTask(taskId);

      const promise1 = taskManager.pauseTask(taskId);
      const deferred1 = taskManager.getTask(taskId).deferred;

      const promise2 = taskManager.pauseTask(taskId);
      const deferred2 = taskManager.getTask(taskId).deferred;

      assert.notStrictEqual(deferred1, deferred2, 'The deferred promise was overwritten on second pauseTask call');
      
      // If we resume now, only promise2 will resolve, promise1 is resolved with CANCELLED
      taskManager.resumeTask(taskId, taskManager.getTask(taskId).correctCaptcha);

      const resolvedValue2 = await promise2;
      assert.strictEqual(resolvedValue2, taskManager.getTask(taskId).correctCaptcha);

      // Verify promise1 is resolved with 'CANCELLED'
      const resolvedValue1 = await promise1;
      assert.strictEqual(resolvedValue1, 'CANCELLED', 'The first paused promise resolved with CANCELLED');
    });
  });

  describe('3. Edge Cases & Timeouts Tests', () => {
    test('checks taskManager behaviour when passing zero or negative timeouts to pauseTask', async () => {
      const taskId = `timeout-edge-${Date.now()}`;
      taskManager.createTask(taskId);

      // Verify that the actual pauseTask method implements the safety timeout parameter.
      // Passing 0 or negative timeouts should reject quickly.
      const pausePromise = taskManager.pauseTask(taskId, 'SOME_CODE', -100);

      try {
        await pausePromise;
        assert.fail('Expected pauseTask to reject with negative timeout');
      } catch (error) {
        assert.ok(error.message.includes('timed out'));
        assert.strictEqual(taskManager.getTask(taskId).status, 'FAILED');
      }
    });
  });

  describe('4. Browser Form Field Layout Validity', () => {
    test('form.html fields are visible, ordered vertically, and do not overlap', async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(`${BASE_URL}/form.html`);

        const selectors = ['#name', '#email', '#amount', '#submit-btn'];
        const boxes = {};

        // Verify visibility and fetch bounding boxes
        for (const selector of selectors) {
          const element = await page.$(selector);
          assert.ok(element, `Element ${selector} should exist`);
          
          const isVisible = await element.isVisible();
          assert.ok(isVisible, `Element ${selector} should be visible`);

          const box = await element.boundingBox();
          assert.ok(box, `Element ${selector} should have a bounding box`);
          assert.ok(box.width > 0, `Element ${selector} width should be > 0`);
          assert.ok(box.height > 0, `Element ${selector} height should be > 0`);
          
          boxes[selector] = box;
        }

        // Verify vertical layout ordering: name above email, email above amount, amount above submit
        assert.ok(boxes['#name'].y < boxes['#email'].y, 'Name input should be above email input');
        assert.ok(boxes['#email'].y < boxes['#amount'].y, 'Email input should be above amount input');
        assert.ok(boxes['#amount'].y < boxes['#submit-btn'].y, 'Amount input should be above submit button');

        // Check labels association and layout positioning
        const labels = ['name', 'email', 'amount'];
        for (const id of labels) {
          const label = await page.$(`label[for="${id}"]`);
          assert.ok(label, `Label for ${id} should exist`);
          assert.ok(await label.isVisible(), `Label for ${id} should be visible`);
          
          const labelBox = await label.boundingBox();
          const inputBox = boxes[`#${id}`];

          // Label should be placed above or to the left of the input
          assert.ok(labelBox.y <= inputBox.y + 5, `Label for ${id} should be positioned before or aligned with input`);
        }

        // Verify no overlapping between the fields
        const keys = Object.keys(boxes);
        for (let i = 0; i < keys.length; i++) {
          for (let j = i + 1; j < keys.length; j++) {
            const boxA = boxes[keys[i]];
            const boxB = boxes[keys[j]];

            const overlap = !(
              boxA.x + boxA.width <= boxB.x ||
              boxB.x + boxB.width <= boxA.x ||
              boxA.y + boxA.height <= boxB.y ||
              boxB.y + boxB.height <= boxA.y
            );

            assert.ok(!overlap, `Elements ${keys[i]} and ${keys[j]} overlap visually!`);
          }
        }
      } finally {
        await browser.close();
      }
    });

    test('secure.html fields are visible and do not overlap', async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(`${BASE_URL}/secure.html?taskId=dummy-task`);

        const selectors = ['#captcha-image', '#captcha', '#verify-btn'];
        const boxes = {};

        for (const selector of selectors) {
          const element = await page.$(selector);
          assert.ok(element, `Element ${selector} should exist`);
          assert.ok(await element.isVisible(), `Element ${selector} should be visible`);

          const box = await element.boundingBox();
          assert.ok(box, `Element ${selector} should have a bounding box`);
          assert.ok(box.width > 0, `Element ${selector} width should be > 0`);
          assert.ok(box.height > 0, `Element ${selector} height should be > 0`);
          
          boxes[selector] = box;
        }

        // Verify vertical layout ordering
        assert.ok(boxes['#captcha-image'].y < boxes['#captcha'].y, 'Captcha text/image should be above input');
        assert.ok(boxes['#captcha'].y < boxes['#verify-btn'].y, 'Captcha input should be above verify button');

        // Verify no overlapping
        const keys = Object.keys(boxes);
        for (let i = 0; i < keys.length; i++) {
          for (let j = i + 1; j < keys.length; j++) {
            const boxA = boxes[keys[i]];
            const boxB = boxes[keys[j]];

            const overlap = !(
              boxA.x + boxA.width <= boxB.x ||
              boxB.x + boxB.width <= boxA.x ||
              boxA.y + boxA.height <= boxB.y ||
              boxB.y + boxB.height <= boxA.y
            );

            assert.ok(!overlap, `Elements ${keys[i]} and ${keys[j]} overlap visually!`);
          }
        }
      } finally {
        await browser.close();
      }
    });
  });
});
