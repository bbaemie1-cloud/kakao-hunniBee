# Handoff Report: Environment Analysis & Stack Recommendation for KakaoTalk Admin Assistant

This report details the investigation of the macOS workspace environment, analyzes the technical options, and presents a proposed tech stack, code layout, and interface contracts to implement the KakaoTalk Admin Assistant automation.

---

## 1. Observation

During the read-only workspace investigation, the following file paths, executable paths, and environments were detected using filesystem search tools:

1. **Node.js & npm Exist**:
   - `/opt/homebrew/bin/node` (found via pattern check for `node` in `/opt/homebrew/bin`)
   - `/opt/homebrew/bin/npm` (found via pattern check for `npm` in `/opt/homebrew/bin`)
2. **Python3 & pip3 Exist**:
   - `/usr/bin/python3` (found via pattern check for `python3` in `/usr/bin`)
   - `/usr/bin/pip3` (found via pattern check for `pip3` in `/usr/bin`)
3. **Google Chrome Installed**:
   - `/Applications/Google Chrome.app` (found via pattern check in `/Applications`)
4. **Command Execution Restriction**:
   - Proposing `node -v && npm -v && python3 --version && pip3 --version` failed due to prompt timeout:
     > `Permission prompt for action 'command' on target 'node -v' timed out waiting for user response. The user was not able to provide permission on time.`
5. **Project Directory**:
   - `/Users/uricho/Desktop/Watson/teamwork_projects/kakao_admin_assistant` contains the workspace for this sub-project.

---

## 2. Logic Chain

From the observations, the following step-by-step reasoning justifies the recommended tech stack:

* **Step 1 (Architecture & OS)**: The installation prefix `/opt/homebrew/bin/` indicates this is an Apple Silicon macOS machine (ARM64 architecture).
* **Step 2 (Node.js vs Python Package Management)**: 
  - Python3 is located under `/usr/bin/python3`. On macOS, this is a system-level stub. Attempting to install libraries globally using `pip3` often fails with PEP 668 environment errors (`externally-managed-environment`), requiring virtual environment configuration (`venv`) and activation for every run.
  - Node.js and npm are located in `/opt/homebrew/bin/`. Homebrew paths are user-writable, and package installation via `npm install` stores dependencies locally in `node_modules` without system-level permission issues or venv management.
* **Step 3 (Browser Automation Libraries)**: 
  - Google Chrome is present under `/Applications/Google Chrome.app`.
  - Both Playwright and Selenium can operate here. However, Playwright is modern, natively supports auto-waiting (preventing flakiness on dynamic mock HTML forms), provides headless/headful switches seamlessly, and can target the system Chrome binary via the `channel: 'chrome'` property.
  - Playwright's primary and most mature API is Node.js.
* **Step 4 (Human-In-The-Loop Async Coordination)**:
  - R3 requires the automation script to pause when encountering a CAPTCHA page (`/secure.html`) and resume when an external API signal is received.
  - In Node.js, we can write this using native **Deferred Promises** (saving the promise's `resolve` callback in an in-memory Map associated with the task ID). 
  - Because Node.js runs on a single-threaded async event loop, coordinating these pause/resume events is inherently thread-safe and lightweight, requiring no locks or complex thread synchronization.
* **Conclusion**: **Node.js + Playwright + Express** is the optimal tech stack for this project.

---

## 3. Caveats

* **Tool Versions**: Exact versions of Node.js, npm, Python3, and pip3 could not be programmatically verified due to user permission timeouts. We assume Node.js >= 18 and Python >= 3.9 based on Homebrew and modern Xcode CommandLine tools.
* **Network Mode Constraints**: The system runs under a `CODE_ONLY` network constraint. External npm downloads during runtime must be avoided; all dependencies should be pre-installed/cached or standard modules should be used. Playwright local browsers must be downloaded during the initial local setup phase.

---

## 4. Conclusion & Recommendations

We recommend using **Node.js (Express) + Playwright** to satisfy all project requirements.

### Proposed Code Layout

```
kakao_admin_assistant/
├── package.json                  # Dependencies (express, playwright)
├── README.md
├── src/
│   ├── server.js                 # Main server (Express) serving webhook, mock pages, and resume endpoint
│   ├── automation/
│   │   ├── browser.js            # Playwright script executing the mock application flow
│   │   └── taskManager.js        # Manages active tasks and pause/resume Deferred Promises
│   └── public/                   # Static directory for mock web app pages
│       ├── form.html             # Mock Youth Loan form (R2 target)
│       ├── secure.html           # Captcha page displaying captcha placeholder (R3 target)
│       └── success.html          # Success confirmation page
└── tests/
    ├── webhook.test.js           # Tests R1 Kakao webhook contract
    └── flow.test.js              # Integration test verifying headless flow and HITL resume
```

### Proposed Interface Contracts

#### 1. KakaoTalk Webhook Endpoint (R1)
- **Endpoint**: `POST /api/kakao/webhook`
- **Request Body**:
  ```json
  {
    "userRequest": {
      "utterance": "승인",
      "user": {
        "id": "mock-user-12345"
      }
    }
  }
  ```
- **Response Body**:
  ```json
  {
    "version": "2.0",
    "template": {
      "outputs": [
        {
          "simpleText": {
            "text": "대출 자동 신청을 시작합니다. (작업 ID: task-123). 보안 확인 단계가 발생하면 추가 안내를 드리겠습니다."
          }
        }
      ]
    }
  }
  ```

#### 2. Webhook Resume API Endpoint (R3)
- **Endpoint**: `POST /api/automation/resume`
- **Request Body**:
  ```json
  {
    "taskId": "task-123",
    "captchaCode": "123456"
  }
  ```
- **Response Body**:
  ```json
  {
    "success": true,
    "message": "Resume signal received. Processing captcha..."
  }
  ```

#### 3. Task Status Monitoring Endpoint (Internal/Testing)
- **Endpoint**: `GET /api/automation/status/:taskId`
- **Response Body**:
  ```json
  {
    "taskId": "task-123",
    "status": "RUNNING" | "PAUSED_SECURITY" | "COMPLETED" | "FAILED",
    "currentUrl": "http://localhost:3000/secure.html",
    "error": null
  }
  ```

---

## 5. Verification Method

To verify the implementation of R1, R2, and R3, the following automated procedure can be run locally:

1. **Launch Server**: Start the local Express server hosting the API and static mock web pages:
   ```bash
   node src/server.js
   ```
2. **Execute E2E Flow Test**: Run the test script `tests/flow.test.js`. This script will:
   - Send a mock KakaoTalk "승인" request to `POST /api/kakao/webhook` to trigger automation and obtain a `taskId`.
   - Poll `GET /api/automation/status/:taskId` until status becomes `PAUSED_SECURITY`.
   - Extract the mock captcha or simulate a captcha code (`123456`).
   - Call `POST /api/automation/resume` with the `taskId` and `captchaCode`.
   - Poll `GET /api/automation/status/:taskId` to verify the state transitions to `COMPLETED` and the final page is `success.html`.
3. **Validation Command**:
   ```bash
   node tests/flow.test.js
   ```
