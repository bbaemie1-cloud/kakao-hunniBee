# Challenger Report — 2026-07-04T04:05:09+09:00

## Challenge Summary

**Overall risk assessment**: MEDIUM

The application's core implementation is highly robust, utilizing a Deferred Promise mechanism with explicit state transitions, automatic browser cleanup, and task-interleaving capabilities. However, several architectural and implementation vulnerabilities exist around memory management, state pollution, and security enforcement.

---

## Challenges

### [Medium] Challenge 1: In-Memory Task Map Leak (Memory Growth)
- **Assumption challenged**: The in-memory `tasks` Map in `TaskManager` can grow indefinitely without resource exhaustion.
- **Attack scenario**: A malicious actor (or regular high volume traffic) repeatedly fires `POST /api/kakao/webhook` requests. Each request allocates a task object with unique IDs, correct captcha strings, timeouts, and form data. Because tasks are never deleted or evicted from the Map, the server heap memory increases continuously until it crashes due to Out Of Memory (OOM).
- **Blast radius**: Complete Denial of Service (DoS) of the Express application due to process crashes under sustained traffic.
- **Mitigation**: Implement a Task Eviction/Cleanup policy. Tasks in a terminal state (`COMPLETED` or `FAILED`) should be removed from the `tasks` Map after a short grace period (e.g., 5-10 minutes), or a maximum Map capacity with LRU eviction should be enforced.

### [Low] Challenge 2: Completed/Failed Task State Pollution
- **Assumption challenged**: Once a task reaches a terminal state (`COMPLETED` or `FAILED`), its attributes and data are immutable.
- **Attack scenario**: In `taskManager.updateTask`, status transitions to/from terminal states are blocked. However, other properties (e.g., `formData`) can still be overwritten on a terminal task using the update method. If future API extensions or administrative dashboards write to `updateTask` without validating status, historical audit trails and session data could be corrupted.
- **Blast radius**: State inconsistency, audit trail pollution, and potential security bypasses in administrative views.
- **Mitigation**: Update `taskManager.updateTask` to reject all updates if the task's current status is `COMPLETED` or `FAILED`.

### [Low] Challenge 3: Lack of Captcha Attempt Rate-Limiting
- **Assumption challenged**: Captcha verification is secure because it requires a 6-digit random code.
- **Attack scenario**: The endpoints `/api/automation/resume` and `/api/submit-captcha` do not track failed verification attempts. An attacker could brute force all 6-digit captcha combinations (100,000 to 999,999) within the 5-minute timeout window.
- **Blast radius**: Bypassing captcha verification, allowing automated submissions to proceed unauthorized.
- **Mitigation**: Track the number of failed captcha entry attempts in the task object. After 3 to 5 failed attempts, immediately fail/cancel the task.

---

## Stress Test Results

- **Scenario A: Concurrent Webhook & Automation Triggers**
  - *Expected behavior*: Multiple concurrent webhook requests start independent Playwright sessions, navigate correctly, pause at secure page, and resolve on resume.
  - *Actual behavior*: Passed. The `Deferred Promise` mechanism isolates active browser instances by `taskId`.
- **Scenario B: Rapid Task Interleaving**
  - *Expected behavior*: Operations on Task A do not interfere with Task B.
  - *Actual behavior*: Passed. In-memory `Map` correctly namespaces operations using `taskId`.
- **Scenario C: Zero/Negative Resume Timeouts**
  - *Expected behavior*: Passing a zero or negative timeout to `pauseTask` causes it to reject immediately.
  - *Actual behavior*: Passed. Handled robustly by `taskManager.pauseTask` which rejects the promise immediately.
- **Scenario D: Duplicate Task Re-Approval Request**
  - *Expected behavior*: Submitting a new webhook request for the same user automatically cancels the previous active task.
  - *Actual behavior*: Passed. Checked by user email lookup on webhook request, triggering `cancelTask` on the older active task.

---

## Unchallenged Areas

- **System Network Behavior** — Reason: Network access is restricted to CODE_ONLY mode, so third-party integration points (actual Kakao APIs) were not tested live.
- **Visual Captcha Image Generation** — Reason: The secure page uses a mock text-based captcha display instead of an obfuscated image captcha, which is out of scope for the integration pass.
