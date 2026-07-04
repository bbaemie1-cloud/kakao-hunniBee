# Handoff Report: E2E Testing Infrastructure Design for Milestone E1

This report outlines the proposed design, structure, and test specifications for the E2E Testing Track of the KakaoTalk Admin Assistant project. It provides the full architectural details, code files, and mock scenarios needed by the implementation team to complete Milestone E1.

---

## 1. Observation

During the read-only exploration of the workspace, the following observations were made:

1. **Workspace Structure**:
   The workspace `/Users/uricho/Desktop/Watson/teamwork_projects/kakao_admin_assistant` contains only documentation files:
   - `PROJECT.md` (defining the architecture, milestones, and interface contracts).
   - `ORIGINAL_REQUEST.md` (defining user request).
   No `src/` or `tests/` directories exist yet.

2. **Project Contract Details**:
   According to `PROJECT.md` (lines 45-102), the application defines the following endpoints:
   - **KakaoTalk Bot Webhook (R1)**: `POST /api/kakao/webhook`
     - Input: `{"userRequest": {"utterance": "승인", "user": {"id": "mock-user-12345"}}}`
     - Output: `{"version": "2.0", "template": {"outputs": [{"simpleText": {"text": "대출 자동 신청을 시작합니다. (작업 ID: task-123). 보안 확인 단계가 발생하면 추가 안내를 드리겠습니다."}}]}}`
   - **Automation Resume API (R3)**: `POST /api/automation/resume`
     - Input: `{"taskId": "task-123", "captchaCode": "123456"}`
     - Output: `{"success": true, "message": "Resume signal received. Processing captcha..."}`
   - **Task Status Monitoring (Internal)**: `GET /api/automation/status/:taskId`
     - Output: `{"taskId": "task-123", "status": "RUNNING" | "PAUSED_SECURITY" | "COMPLETED" | "FAILED", "currentUrl": "http://localhost:3000/secure.html", "error": null}`

3. **Planned Code Layout**:
   `PROJECT.md` (lines 9-32) specifies the directory structure:
   - `package.json` at root.
   - `tests/e2e_runner.js` for test orchestration.
   - `tests/tier1_coverage.test.js` for Feature Coverage.
   - `tests/tier2_boundary.test.js` for Boundary Cases.
   - `TEST_INFRA.md` to document the test infrastructure.

4. **Environment Setup**:
   The planning agent report (`teamwork_preview_explorer_planning/handoff.md`, lines 11-23) confirmed the presence of Node.js (`/opt/homebrew/bin/node`) and npm (`/opt/homebrew/bin/npm`), as well as Google Chrome (`/Applications/Google Chrome.app`).

---

## 2. Logic Chain

Based on the observations, we formulate the E2E testing framework using the following step-by-step reasoning:

* **Step 1 (Stack Selection)**: Node.js is already installed and has user-writable brew paths. An Express server is required to host the API endpoints and the static pages.
* **Step 2 (Playwright Integration)**: Playwright is chosen as the browser automation driver as it handles auto-waiting natively and integrates cleanly into a Node.js-based test suite without requiring global selenium drivers.
* **Step 3 (Test Runner Philosophy)**: We recommend using Node.js's native test runner (`node:test` and `node:assert`) which is built-in for Node.js >= 18. This avoids introducing massive third-party testing frameworks (such as Jest or Mocha), reducing potential setup errors and package download failures under `CODE_ONLY` network restrictions.
* **Step 4 (Test Runner Architecture)**: The runner `tests/e2e_runner.js` must start the server, wait for it to bind to its port, spawn the test runner process, capture the exit status, kill the server process, and exit. A custom port-checking function utilizing the native `net` module is proposed to avoid relying on external utilities like `wait-on`.
* **Step 5 (Coverage & Robustness)**: Defining 15 Tier 1 (happy-path coverage) tests and 15 Tier 2 (boundary/error) tests across Features 1 (Webhook), 2 (Playwright automation), and 3 (Pause/Resume & Task Control) ensures complete and robust test coverage of the system contract.

---

## 3. Caveats

* **Local Browser Installation**: In the `CODE_ONLY` network mode, Playwright browser binaries must be pre-cached or configured to use the local Chrome application (`/Applications/Google Chrome.app`) via Playwright's `channel: 'chrome'` or custom `executablePath` setting.
* **Timing Sensitivity**: Headless browser testing can be subject to timing issues. Retries and polling timeouts must be configured to prevent intermittent test failures (flakiness).

---

## 4. Conclusion & Recommendations

The E2E Testing Track recommends the following concrete designs and code skeletons for Milestone E1.

### 4.1. package.json Configuration
The root `package.json` should specify minimal standard dependencies and scripts:

```json
{
  "name": "kakao-talk-admin-assistant-tests",
  "version": "1.0.0",
  "description": "E2E Testing infrastructure for KakaoTalk Admin Assistant",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "test": "node tests/e2e_runner.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "playwright": "^1.44.0"
  },
  "private": true
}
```

### 4.2. E2E Test Runner Implementation (`tests/e2e_runner.js`)
This script orchestrates the lifecycles of the Express server and the test run:

```javascript
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SERVER_PATH = path.join(__dirname, '../src/server.js');

/**
 * Checks if a local port is listening.
 */
function waitForPort(port, host = '127.0.0.1', timeout = 10000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      const socket = new net.Socket();
      socket.connect(port, host, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', (err) => {
        socket.destroy();
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Timeout waiting for port ${port}: ${err.message}`));
        } else {
          setTimeout(check, 250);
        }
      });
    };
    check();
  });
}

async function run() {
  console.log(`Starting Express mock server from: ${SERVER_PATH}`);
  
  // Start the server in background, passing the PORT environment variable
  const serverProcess = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT },
    stdio: 'inherit'
  });

  let testExitCode = 1;

  try {
    // Wait for the server to be up and responsive
    await waitForPort(PORT);
    console.log(`Express server is up and listening on port ${PORT}.`);

    // Execute the test suites via Node's native test runner
    console.log('Running test suites...');
    const testRunner = spawn('node', [
      '--test',
      'tests/tier1_coverage.test.js',
      'tests/tier2_boundary.test.js'
    ], {
      stdio: 'inherit'
    });

    testExitCode = await new Promise((resolve) => {
      testRunner.on('close', (code) => {
        resolve(code === null ? 1 : code);
      });
    });

    console.log(`Test suite finished with exit code: ${testExitCode}`);
  } catch (error) {
    console.error('Error during test execution:', error);
  } finally {
    console.log('Stopping Express mock server...');
    serverProcess.kill('SIGTERM');
    
    // Allow process to release sockets
    await new Promise((resolve) => setTimeout(resolve, 500));
    process.exit(testExitCode);
  }
}

process.on('SIGINT', () => {
  console.log('Orchestrator interrupted, exiting...');
  process.exit(1);
});

run();
```

---

### 4.3. Tier 1: Feature Coverage Test Design (`tests/tier1_coverage.test.js`)
This tier contains **15 test cases** (5 per feature) targeting happy path flows and standard capabilities.

#### Feature 1: KakaoTalk Webhook (R1)
1. **Test 1.1: Webhook Endpoint Responds 200 OK**: Sends valid webhook request and verifies HTTP 200.
2. **Test 1.2: Webhook Content-Type is JSON**: Verifies headers specify `application/json`.
3. **Test 1.3: Webhook Output Schema Compliance**: Asserts response has `version` and `template.outputs[0].simpleText.text`.
4. **Test 1.4: Webhook Response Returns Task ID**: Extracts `taskId` using regex on simpleText.
5. **Test 1.5: Unique Task ID Generation**: Calls webhook twice and verifies both generated task IDs are unique.

#### Feature 2: Playwright Form Automation Flow (R2)
6. **Test 2.1: Loading Form Page HTML**: Direct navigation to `/form.html` loads successfully.
7. **Test 2.2: Form Fields Presence**: Checks for inputs: `name`, `phone`, `amount`, `agree`, and submit button.
8. **Test 2.3: Filling and Submitting Form**: Fills out correct info and submits; page transitions.
9. **Test 2.4: Success Page Content**: Page `/success.html` is readable and displays confirmation content.
10. **Test 2.5: Public Static Assets Accessibility**: Confirms Express serves CSS/assets properly without auth issues.

#### Feature 3: Task Control & Captcha Pause/Resume (R3)
11. **Test 3.1: Task Pauses on Captcha Page**: Starting a task automates the form, hits `/secure.html`, and task status transitions to `PAUSED_SECURITY`.
12. **Test 3.2: Status Endpoint Schema Compliance**: Verification that `GET /api/automation/status/:taskId` returns status, taskId, currentUrl, and error.
13. **Test 3.3: Captcha Resume Endpoint Success**: Sending correct captcha code returns `success: true`.
14. **Test 3.4: Complete Flow Status Transitions**: Verifies state moves from `PAUSED_SECURITY` to `COMPLETED` after resume.
15. **Test 3.5: Final Page Redirection**: Asserts status monitoring page changes to `/success.html` post-resume.

---

### 4.4. Tier 2: Boundary/Corner Case Test Design (`tests/tier2_boundary.test.js`)
This tier contains **15 test cases** (5 per feature) checking edge cases, malformed payloads, and invalid states.

#### Feature 1: KakaoTalk Webhook (R1)
1. **Test 1.1: Webhook Malformed JSON Payload**: Sending invalid JSON structure triggers HTTP 400 instead of crashing.
2. **Test 1.2: Webhook Missing Required Fields**: Sending a body without `userRequest` triggers HTTP 400.
3. **Test 1.3: Webhook Unsupported Utterance**: Utterances other than "승인" (e.g. "도움말") return instructions without starting a task.
4. **Test 1.4: Webhook Invalid HTTP Methods**: `GET` or `PUT` requests to `/api/kakao/webhook` return HTTP 404 or 405.
5. **Test 1.5: Webhook Missing User ID**: Sending a webhook request with no user identifier is rejected or handled with defaults.

#### Feature 2: Playwright Form Automation Flow (R2)
6. **Test 2.1: Blank Form Submission Blocked**: Submitting form with no values displays HTML5 validation or application errors.
7. **Test 2.2: Invalid Telephone Format Rejection**: Submitting an alphanumeric phone number triggers client-side validation errors.
8. **Test 2.3: Unchecked Terms and Conditions Checkbox**: Fails to submit when terms checkbox is unchecked.
9. **Test 2.4: Direct Access of Success Page**: Accessing `/success.html` directly without a session redirects to `/form.html` or displays a denial message.
10. **Test 2.5: Browser Timeout Graceful Recovery**: Playwright element timeout sets task status to `FAILED` and cleans up browser contexts.

#### Feature 3: Task Control & Captcha Pause/Resume (R3)
11. **Test 3.1: Resume Request with Non-existent Task ID**: Calling resume on a non-existent task ID returns HTTP 404.
12. **Test 3.2: Resume Request with Incorrect Captcha Code**: Submitting an incorrect captcha returns `success: false` and keeps status as `PAUSED_SECURITY`.
13. **Test 3.3: Double Resume Rejection**: Submitting a resume request to a task that has already completed returns HTTP 400.
14. **Test 3.4: Status Request for Non-existent Task ID**: Querying status of an invalid task ID returns HTTP 404.
15. **Test 3.5: Task Inactivity Timeout (Garbage Collection)**: Idle tasks in `PAUSED_SECURITY` automatically fail and close after timeout (e.g. simulated timeout).

---

### 4.5. Structure & Content of `TEST_INFRA.md`
The `TEST_INFRA.md` document serves as the guide for the E2E testing framework. It should be structured as follows:

1. **Title and Overview**: Purpose of the test suite and overall test runner architecture.
2. **Feature Inventory**:
   - **Feature 1**: KakaoTalk Bot Webhook API (R1).
   - **Feature 2**: Playwright Web Automation Flow (R2).
   - **Feature 3**: Captcha Pause & Resume (R3).
3. **Execution Instructions**:
   - Running the test runner: `npm test`.
   - Environmental variables (e.g. `PORT`, `HEADLESS`).
4. **Test Hierarchy (Tiers)**:
   - Detailed specifications of Tiers 1, 2, 3, and 4.
5. **Quality Goals**:
   - Required pass rates (100%).
   - Validation criteria for resource cleanup (ensuring no orphaned chromium instances are left running).

---

## 5. Verification Method

To verify the test design infrastructure locally once implemented:
1. Run the test command:
   ```bash
   npm test
   ```
2. Check that the console logs output the Express server starting, the tests executing under the native Node runner, and the cleanup logs.
3. Validate that no zombie Node.js or Playwright Chrome processes remain running.
