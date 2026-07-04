# Implementation Analysis & Design: Milestone I1

## Executive Summary
This document provides the implementation analysis and design strategy for **Milestone I1: Mock Web App & Task Manager** of the KakaoTalk Admin Assistant project. 
The objective of Milestone I1 is to establish the mock frontend application forms that simulate a multi-step user registration flow for a "Youth rent/deposit loan" (청년 맞춤형 전월세 대출) and implement the in-memory task manager capable of pausing and resuming automated Playwright flows via Deferred Promises.

---

## 1. Mock Web Application Design (HTML Pages)

The mock web app provides a multi-page checkout flow served statically by the Express application. The interface files reside in `src/public/` and consist of:
1. `form.html`: Primary input form collecting applicant information.
2. `secure.html`: Captcha-based security checkpoint that halts automation until external approval.
3. `success.html`: The terminal confirmation page indicating application success.

### 1.1 Page Design & Visual Flow Simulation

```
[ form.html ] --(Form Submit)--> [ secure.html ] --(Captcha Correct)--> [ success.html ]
 (User Input)                     (Security Check)                        (Result Page)
                                  [State: PAUSED]                         [State: COMPLETED]
```

#### A. form.html (Youth Rent/Deposit Loan Form)
- **Purpose**: Mimics the primary form where details are submitted.
- **Fields & DOM Elements**:
  - `<form id="loanForm" action="/secure.html" method="GET">`
  - Name (실명): `<input type="text" id="name" name="name" required>`
  - Age (만 나이): `<input type="number" id="age" name="age" min="19" max="34" required>` (Enforces target eligibility)
  - Contact (연락처): `<input type="tel" id="phone" name="phone" pattern="[0-9]{3}-[0-9]{3,4}-[0-9]{4}" required>`
  - Desired Deposit (희망 보증금): `<input type="number" id="deposit" name="deposit" min="100" required>`
  - Submission: `<button type="submit" id="submitBtn">`
- **Simulation Mechanics**: Submitting the form navigates the browser to `/secure.html` via GET parameters, simulating standard form submission.

#### B. secure.html (Security CAPTCHA Gate)
- **Purpose**: Halts the automated execution flow to simulate a human-in-the-loop security checkpoint.
- **Fields & DOM Elements**:
  - Captcha Code Display: `<span id="captchaCode">`
  - Captcha Input Field: `<input type="text" id="captchaInput" name="captchaInput" required>`
  - Submit Button: `<button type="submit" id="submitCaptcha">`
  - Error Display Container: `<div id="errorMessage">`
- **Validation & Dynamic Code Mechanics**:
  - On page load (`DOMContentLoaded`), client-side JavaScript generates a random 6-digit number and injects it into `#captchaCode`.
  - The submit action listens to the `submit` event. If the text in `#captchaInput` does not match the generated code in `#captchaCode`, the submit is intercepted (`event.preventDefault()`), and `#errorMessage` displays "보안 문자가 올바르지 않습니다."
  - If the input is correct, the form is allowed to submit, navigating to `/success.html`.
  - *Note*: This design makes the captcha fully automatable for tests because the Playwright automation can easily scrape `#captchaCode` to verify or resume the flow.

#### C. success.html (Submission Complete Page)
- **Purpose**: Represents the final successful application state.
- **Key Element**:
  - `<div id="status">SUCCESS</div>`
- **Simulation Mechanics**: The existence of `#status` containing `SUCCESS` serves as the test validation assertion for the automated E2E test runner.

---

## 2. In-Memory Task Manager Design

The `taskManager.js` component manages browser automation workflows in memory. It tracks state and implements the **Deferred Promise Pattern** to allow active Playwright tasks to pause execution and yield control, resuming only when the Express server receives the correct webhook or resume API requests.

### 2.1 Task States and Lifecycle Transitions

Each task is represented in memory by an object with the following schema:
```typescript
interface Task {
  taskId: string;
  status: 'RUNNING' | 'PAUSED_SECURITY' | 'COMPLETED' | 'FAILED';
  currentUrl: string | null;
  error: string | null;
  deferred: Deferred | null;
  createdAt: Date;
}
```

#### Task State Machine Diagram:
```
      (Create Task)
            │
            ▼
       ┌───────────┐         (Error / Timeout)
       │  RUNNING  ├──────────────────────────┐
       └─────┬─────┘                          │
             │                                │
      (Hits secure.html)                      │
             │                                │
             ▼                                ▼
    ┌─────────────────┐               ┌──────────────┐
    │ PAUSED_SECURITY ├──────────────>│    FAILED    │
    └────────┬────────┘               └──────────────┘
             │                                ▲
     (Resume API Called)                      │
             │                                │
             ▼                                │
       ┌───────────┐                          │
       │  RUNNING  ├──────────────────────────┤
       └─────┬─────┘                          │
             │                                │
      (Hits success.html)                     │
             │                                │
             ▼                                │
       ┌───────────┐                          │
       │ COMPLETED ├──────────────────────────┘
       └───────────┘
```

### 2.2 The Deferred Promise Pattern

A Deferred Promise decouples the Promise creation from its resolution or rejection, allowing these actions to be triggered asynchronously across different routes or files.

```javascript
class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}
```

When Playwright automation navigates to `/secure.html`, it asks the Task Manager to block. The Task Manager returns the promise from a newly instantiated `Deferred` object and attaches it to the task. 

```javascript
// Within Playwright flow (browser.js):
taskManager.updateTask(taskId, { status: 'PAUSED_SECURITY', currentUrl: page.url() });

// Blocks until resolve is called by another endpoint
const captchaCode = await taskManager.waitForResume(taskId); 

// Resume execution
await page.fill('#captchaInput', captchaCode);
await page.click('#submitCaptcha');
```

When a user submits the captcha code via `POST /api/automation/resume`, the server calls:
```javascript
// Within Express Route (server.js):
taskManager.resumeTask(taskId, captchaCode); // This invokes deferred.resolve(captchaCode)
```
This triggers the resolution of the promise, passing `captchaCode` back to the Playwright thread and resuming execution.

### 2.3 Task Manager API Specifications

#### Class Design (`TaskManager`):
1. `createTask(taskId)`: Initializes task state inside the internal `tasks = new Map()`.
2. `getTask(taskId)`: Reads the task state.
3. `updateTask(taskId, updates)`: Updates fields like `currentUrl`, `status`, or `error`.
4. `waitForResume(taskId, timeoutMs)`: Sets status to `PAUSED_SECURITY`, constructs a new `Deferred` instance, initiates a safety timer, and returns `deferred.promise`.
5. `resumeTask(taskId, captchaCode)`: Retrieves the task, verifies it is in `PAUSED_SECURITY`, clears the timeout, resolves the deferred promise with `captchaCode`, and resets the task's deferred reference to null.
6. `failTask(taskId, error)`: Transitions task to `FAILED` and rejects the deferred promise.
7. `deleteTask(taskId)`: Cleans up memory.

### 2.4 Safety Controls, Timeouts, and Error Scenarios

- **Hanging Worker Prevention**: If a user never completes the captcha verification, the Playwright browser context would hang indefinitely, leaking memory. The `waitForResume` method schedules a `setTimeout` (defaulting to 5 minutes / 300,000 ms). If the timeout fires before the task is resumed, the Deferred promise is rejected, transitioning the task to `FAILED` and shutting down the headless browser.
- **Process Shutdowns**: Upon server shutdown, the application should iterate through all active tasks in the `TaskManager` and call `failTask(taskId, 'Server shutting down')` to release all pending promises.
- **Concurrent Task Isolation**: Tasks are stored using a `Map` keyed by `taskId`. Each task holds its own unique `Deferred` instance, ensuring that multiple simultaneous browser automations can be paused and resumed independently without state collisions.

---

## 3. Playwright Automation Integration Plan

Although the automation script itself is scoped for Milestone I3, it must integrate seamlessly with the Milestone I1 mock pages and task manager. 

1. **Launch**: The webhook endpoint receives an approval request, spawns `browser.js` (either as a child process or imported async module), passes the `taskId` and applicant data, and immediately responds with a JSON success message to KakaoTalk.
2. **Navigation**: `browser.js` runs Playwright in headless mode, navigating to `/form.html`, filling values, and clicking submit.
3. **Detection & Pause**: `browser.js` monitors page navigation. Upon arriving at `/secure.html`, it calls `await taskManager.waitForResume(taskId)`.
4. **Resolution**: When a POST is sent to `/api/automation/resume`, `taskManager` resolves the promise. `browser.js` receives the captcha value, fills `#captchaInput`, and clicks `#submitCaptcha`.
5. **Completion**: `browser.js` waits for navigation to `/success.html`, verifies `#status` equals `SUCCESS`, sets task status to `COMPLETED`, and closes the browser.

---

## 4. Proposed Source Code Files

The actual implementations for these designs are written to the following proposed files in the agent directory for review and implementation:
- [proposed_form.html](./proposed_form.html)
- [proposed_secure.html](./proposed_secure.html)
- [proposed_success.html](./proposed_success.html)
- [proposed_taskManager.js](./proposed_taskManager.js)
