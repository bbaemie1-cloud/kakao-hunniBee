const { chromium } = require('playwright');
const taskManager = require('./taskManager');

async function runAutomation(taskId, serverPort) {
  const task = taskManager.getTask(taskId);
  if (!task || task.status === 'FAILED' || task.status === 'COMPLETED') return;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const startUrl = `http://localhost:${serverPort}/form.html?taskId=${taskId}`;
    taskManager.updateTask(taskId, { currentUrl: startUrl });
    await page.goto(startUrl);

    // Fill form
    await page.fill('#name', task.formData.name || '홍길동');
    await page.fill('#email', task.formData.email || 'hong@example.com');
    await page.fill('#age', task.formData.age || '950101-1234567');
    await page.fill('#phone', task.formData.phone || '010-1234-5678');
    await page.fill('#amount', String(task.formData.amount || 10000000));
    await page.fill('#deposit', String(task.formData.deposit || 5000000));
    
    if (task.formData.agree !== false) {
      await page.check('#agree');
    }
    
    // Check form validity before clicking submit to avoid HTML5 validation hangs
    const isValid = await page.evaluate(() => {
      const form = document.querySelector('#loan-form');
      return form ? form.checkValidity() : true;
    });
    if (!isValid) {
      throw new Error('Form validation failed in browser');
    }

    // Submit the form and wait for the redirect
    await page.click('#submit-btn');

    try {
      await page.waitForFunction(
        () => window.location.href.includes('secure.html') || window.location.href.includes('/api/submit-form'),
        null,
        { timeout: 5000 }
      );
    } catch (e) {
      const url = page.url();
      if (url.includes('form.html')) {
        const validationMessage = await page.evaluate(() => {
          const nameEl = document.querySelector('#name');
          const emailEl = document.querySelector('#email');
          const amountEl = document.querySelector('#amount');
          if (nameEl && !nameEl.checkValidity()) return `Name validation: ${nameEl.validationMessage}`;
          if (emailEl && !emailEl.checkValidity()) return `Email validation: ${emailEl.validationMessage}`;
          if (amountEl && !amountEl.checkValidity()) return `Amount validation: ${amountEl.validationMessage}`;
          return 'Form validation failed';
        });
        throw new Error(`Client-side validation failed: ${validationMessage}`);
      }
      throw e;
    }

    let currentUrl = page.url();
    if (currentUrl.includes('/api/submit-form')) {
      const errorText = await page.evaluate(() => document.body.innerText);
      throw new Error(`Server-side validation failed: ${errorText.trim()}`);
    }

    taskManager.updateTask(taskId, { currentUrl });

    if (currentUrl.includes('secure.html')) {
      // Wait for captcha-code to be loaded and non-empty
      await page.waitForFunction(() => {
        const el = document.getElementById('captcha-code');
        return el && el.textContent.trim().length > 0;
      });

      // Extract captcha code text
      const captchaText = await page.evaluate(() => {
        return document.getElementById('captcha-code').textContent.trim();
      });

      // Pause task waiting for resume, passing captchaText as second argument
      const captchaCode = await taskManager.pauseTask(taskId, captchaText);
      if (captchaCode === 'CANCELLED') {
        throw new Error('Task was cancelled');
      }

      // Once resolved, type captcha code and submit
      await page.fill('#captcha', captchaCode);
      await page.click('#verify-btn');

      await page.waitForFunction(
        () => window.location.href.includes('success.html') || window.location.href.includes('/api/submit-captcha'),
        null,
        { timeout: 5000 }
      );

      const finalUrl = page.url();
      taskManager.updateTask(taskId, { currentUrl: finalUrl });

      if (finalUrl.includes('/api/submit-captcha')) {
        const errorText = await page.evaluate(() => document.body.innerText);
        throw new Error(`Captcha validation failed: ${errorText.trim()}`);
      }

      if (finalUrl.includes('success.html')) {
        taskManager.updateTask(taskId, { status: 'COMPLETED' });
      } else {
        taskManager.updateTask(taskId, { status: 'FAILED', error: 'Did not reach success page after verification' });
      }
    } else {
      taskManager.updateTask(taskId, { status: 'FAILED', error: 'Did not redirect to secure verification page' });
    }
  } catch (err) {
    console.error(err);
    const currentTask = taskManager.getTask(taskId);
    if (currentTask && currentTask.status !== 'FAILED') {
      taskManager.updateTask(taskId, { status: 'FAILED', error: err.message });
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { runAutomation };
