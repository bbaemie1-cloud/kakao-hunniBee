# E2E Test Infrastructure & Methodology

This document outlines the End-to-End (E2E) testing infrastructure, feature inventory, test classification tiers, and steps to execute tests for the KakaoTalk Admin Assistant.

---

## Architecture Overview

The E2E testing framework is composed of the following core components:

1. **Express Server (`src/server.js`)**:
   - Acts as a mock KakaoTalk chatbot webhook endpoint (`POST /api/kakao/webhook`).
   - Serves static forms representing the target web application:
     - `form.html`: The loan application form.
     - `secure.html`: The captcha verification form.
     - `success.html`: The successful application page.
   - Implements automated workflow APIs to resume tasks (`POST /api/automation/resume`) and check status (`GET /api/automation/status/:taskId`).

2. **Task Manager (`src/automation/taskManager.js`)**:
   - Manages task state in-memory (`RUNNING`, `PAUSED_SECURITY`, `COMPLETED`, `FAILED`).
   - Uses a **Deferred Promise** pattern. When the headless browser lands on the captcha page, the runner blocks waiting for the `taskManager.pauseTask` promise to resolve.
   - Exposes a `resumeTask` API that resolves the promise upon verification of the correct captcha code, unblocking the browser runner.

3. **Playwright Automation (`src/automation/browser.js`)**:
   - Launches a headless chromium instance using Playwright.
   - Automates the navigation, form submission, captcha filling, and validation flow.

4. **Test Runner (`tests/e2e_runner.js`)**:
   - Starts the mock server as a child process.
   - Polls using `net.Socket` to ensure the server's TCP port is open.
   - Spawns the Node.js native test runner (`node --test`) to run the E2E test files.
   - Terminates the server process cleanly after tests finish and exits with the test runner's exit code.

---

## Feature Inventory

### Feature 1: Webhook
- **Description**: Receives user utterances from KakaoTalk, verifies the input, registers a task, triggers background automation, and returns a Kakao Link simpleText block.
- **Contract**: `POST /api/kakao/webhook`
- **Output**: Submits the task ID back to the user.

### Feature 2: Playwright Flow
- **Description**: Navigates through the target Youth Loan application.
- **Pages**:
  - `form.html` (Inputs: name, email, loan amount).
  - `secure.html` (Inputs: captcha code).
  - `success.html` (Displays success confirmation).
- **Flow**: Form submission redirects the browser to the secure page, which triggers the task pause condition.

### Feature 3: Pause/Resume
- **Description**: The Task Manager suspends the Playwright execution thread on the secure page until the correct captcha code is provided via the resume API, transitioning the state dynamically.
- **Endpoints**:
  - `POST /api/automation/resume`
  - `GET /api/automation/status/:taskId`

---

## Test Classification Tiers

### Tier 1: Feature Coverage (`tests/tier1_coverage.test.js`)
Contains **15 tests** checking the happy path and basic functionality (5 tests per feature group):
- **Feature 1 (Webhook)**:
  - Correct response status and body format.
  - Correct protocol version (2.0).
  - Kakao Link output structure compliance.
  - Inclusion of the task ID in the response.
  - Rejection of invalid utterances (400).
- **Feature 2 (Playwright Flow)**:
  - Form loading.
  - Successful form submission and navigation to the secure page.
  - Form elements existence checks.
  - Validation attributes presence.
  - Seamless full-flow browser automation trigger.
- **Feature 3 (Pause/Resume)**:
  - Status 404 for unknown tasks.
  - Automatic status transition to `PAUSED_SECURITY`.
  - Monitoring endpoint returns correct path / URL details.
  - Captcha verification and task completion.
  - Handling and rejection of invalid captchas (400).

### Tier 2: Boundary & Corner Cases (`tests/tier2_boundary.test.js`)
Contains **15 tests** checking invalid inputs and edge cases (5 tests per feature group):
- **Feature 1 (Webhook Edges)**:
  - Missing payload structure (400).
  - Missing utterance field (400).
  - Missing user identifiers (400).
  - Handling of abnormally long user ID strings.
  - Empty string utterance (400).
- **Feature 2 (Form Validation & Edges)**:
  - Form submission with missing name.
  - Invalid email formatting.
  - Negative loan amount validation.
  - Zero loan amount validation.
  - Form submission missing the required `taskId`.
- **Feature 3 (API Edges & Bad Inputs)**:
  - Re-resuming a task that is not in a paused state (400).
  - Resuming with missing taskId (400).
  - Resuming with missing captcha code (400).
  - Directory traversal attacks / unsafe characters in `taskId` parameters (404).
  - Resuming tasks that do not exist (404).

---

## How to Run Tests

### Prerequisites
- Node.js (v18+)
- Playwright browser binaries

### Steps

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Install Playwright Browsers**:
   ```bash
   npx playwright install chromium
   ```

3. **Run the entire test suite**:
   ```bash
   npm test
   ```
   This command invokes `tests/e2e_runner.js` which manages the server and executes both Tier 1 and Tier 2 test suites.
