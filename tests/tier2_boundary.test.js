const { describe, test, before } = require('node:test');
const assert = require('node:assert');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

describe('Feature 1: Webhook Edges', () => {
  test('missing userRequest payload returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(res.status, 400);
  });

  test('missing utterance returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          user: { id: 'mock-user-123' }
        }
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('missing user object or user id returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인'
        }
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('handles extremely long user id gracefully', async () => {
    const longId = 'a'.repeat(500);
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '승인',
          user: { id: longId }
        }
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.version, '2.0');
  });

  test('empty utterance returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/kakao/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest: {
          utterance: '',
          user: { id: 'mock-user-123' }
        }
      })
    });
    assert.strictEqual(res.status, 400);
  });
});

describe('Feature 2: Form Validation/Edges', () => {
  const taskId = 'test-boundary-1';
  before(async () => {
    await fetch(`${BASE_URL}/api/test/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, formData: {} })
    });
  });

  test('form submission with empty name returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/submit-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        taskId: 'test-boundary-1',
        name: '',
        email: 'test@example.com',
        amount: '1000'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('form submission with invalid email format returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/submit-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        taskId: 'test-boundary-1',
        name: 'John',
        email: 'invalidemail',
        amount: '1000'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('form submission with negative loan amount returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/submit-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        taskId: 'test-boundary-1',
        name: 'John',
        email: 'john@example.com',
        amount: '-500'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('form submission with zero loan amount returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/submit-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        taskId: 'test-boundary-1',
        name: 'John',
        email: 'john@example.com',
        amount: '0'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('form submission with missing taskId returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/submit-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        name: 'John',
        email: 'john@example.com',
        amount: '1000'
      })
    });
    assert.strictEqual(res.status, 400);
  });
});

describe('Feature 3: API Edges/Bad Inputs', () => {
  test('resuming a task that is not paused returns 400', async () => {
    const taskId = `test-boundary-not-paused-${Date.now()}`;
    await fetch(`${BASE_URL}/api/test/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, formData: {} })
    });

    const res = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, captchaCode: '123456' })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
  });

  test('resuming with missing taskId returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ captchaCode: '123456' })
    });
    assert.strictEqual(res.status, 400);
  });

  test('resuming with missing captchaCode returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'test-task' })
    });
    assert.strictEqual(res.status, 400);
  });

  test('status endpoint handles invalid characters in taskId safely and returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/automation/status/../../../etc/passwd`);
    assert.strictEqual(res.status, 404);
  });

  test('resuming a task that does not exist returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/automation/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'non-existent-task-id-9999', captchaCode: '123456' })
    });
    assert.strictEqual(res.status, 404);
  });
});
