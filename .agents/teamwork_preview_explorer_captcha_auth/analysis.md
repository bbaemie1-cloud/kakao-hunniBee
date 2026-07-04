# Captcha Authorization Analysis Report

## 1. Executive Summary
The test suites `tests/tier1_coverage.test.js`, `tests/tier3_combination.test.js`, and `tests/tier4_workload.test.js` currently fail when attempting to fetch captcha values directly from the server via `GET /api/automation/captcha/:taskId`. This is because the server endpoint strictly requires an `Authorization: Bearer mock-secret-token-123` header, which the test cases omit when calling the endpoint using the Node `fetch` API. Including this header resolves the `401 Unauthorized` responses and allows the test suites to run to completion.

---

## 2. Analysis of the 401 Unauthorized Error & Correct Header Structure

### Why the 401 Error Occurs
The mock server implementation in `src/server.js` protects the `/api/automation/captcha/:taskId` endpoint with an authorization check (lines 131–135):

```javascript
// Captcha fetching endpoint for secure page
app.get('/api/automation/captcha/:taskId', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer mock-secret-token-123') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
...
```

When tests directly query `GET /api/automation/captcha/:taskId` via Node's native `fetch` client without any options or headers:
1. `req.headers.authorization` is undefined.
2. The check `!authHeader` evaluates to `true`.
3. The server immediately returns HTTP status `401 Unauthorized` with `{ error: 'Unauthorized' }`.

### Correct Header Structure
To authorize the request, the HTTP request must contain the standard `Authorization` header set to the specific bearer token.
- **Header Name**: `Authorization` (parsed as `authorization` in Node/Express)
- **Header Value**: `Bearer mock-secret-token-123`

In code, this is supplied as an options object to the `fetch` call:
```javascript
{
  headers: {
    'Authorization': 'Bearer mock-secret-token-123'
  }
}
```

---

## 3. Exact Lines of Code in the Test Files Needing Modification

Below are the exact file paths, line numbers, current code, and the proposed modified code to include the authorization header.

### A. File: `tests/tier1_coverage.test.js`

- **Line 271**:
  - **Before**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`);
    ```
  - **After**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    ```

---

### B. File: `tests/tier3_combination.test.js`

- **Line 62**:
  - **Before**:
    ```javascript
    const capResA = await fetch(`${BASE_URL}/api/automation/captcha/${taskIdA}`);
    ```
  - **After**:
    ```javascript
    const capResA = await fetch(`${BASE_URL}/api/automation/captcha/${taskIdA}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    ```

- **Line 66**:
  - **Before**:
    ```javascript
    const capResB = await fetch(`${BASE_URL}/api/automation/captcha/${taskIdB}`);
    ```
  - **After**:
    ```javascript
    const capResB = await fetch(`${BASE_URL}/api/automation/captcha/${taskIdB}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    ```

- **Line 159**:
  - **Before**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`);
    ```
  - **After**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    ```

- **Line 216**:
  - **Before**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`);
    ```
  - **After**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    ```

---

### C. File: `tests/tier4_workload.test.js`

- **Line 40**:
  - **Before**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`);
    ```
  - **After**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    ```

- **Line 115**:
  - **Before**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`);
    ```
  - **After**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    ```

- **Line 188**:
  - **Before**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`);
    ```
  - **After**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    ```

- **Line 244**:
  - **Before**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`);
    ```
  - **After**:
    ```javascript
    const capRes = await fetch(`${BASE_URL}/api/automation/captcha/${taskId}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    ```

- **Line 330**:
  - **Before**:
    ```javascript
    const cap1Res = await fetch(`${BASE_URL}/api/automation/captcha/${taskId1}`);
    ```
  - **After**:
    ```javascript
    const cap1Res = await fetch(`${BASE_URL}/api/automation/captcha/${taskId1}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    ```

- **Line 352**:
  - **Before**:
    ```javascript
    const cap2Res = await fetch(`${BASE_URL}/api/automation/captcha/${taskId2}`);
    ```
  - **After**:
    ```javascript
    const cap2Res = await fetch(`${BASE_URL}/api/automation/captcha/${taskId2}`, {
      headers: {
        'Authorization': 'Bearer mock-secret-token-123'
      }
    });
    ```

---

## 4. Verification that the Change Satisfies Server Requirements

By tracing the execution flow in `src/server.js`:
1. Node.js lowercases HTTP request headers. The sent `Authorization` header is stored in `req.headers.authorization` as `'Bearer mock-secret-token-123'`.
2. The logic in `src/server.js` retrieves `const authHeader = req.headers.authorization;`.
3. The guard condition:
   `if (!authHeader || authHeader !== 'Bearer mock-secret-token-123')`
   will evaluate `authHeader` as truthy (`!authHeader` is `false`) and the string comparison `authHeader !== 'Bearer mock-secret-token-123'` as `false` because they match exactly.
4. The conditional branch is skipped.
5. The task status and captcha are resolved and returned successfully via `res.json({ captcha: task.correctCaptcha })`.

This verification is also consistent with the client-side JavaScript located in `src/public/secure.html` (lines 113–121) which successfully retrieves the captcha using the exact same header:
```javascript
fetch('/api/automation/captcha/' + taskId, {
  headers: {
    'Authorization': 'Bearer mock-secret-token-123'
  }
})
```
Therefore, adding the header to the direct `fetch` calls in the test files is guaranteed to satisfy the server's authentication requirements.
