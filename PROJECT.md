# Project: KakaoTalk Admin Assistant

## Architecture
The system consists of:
1. **Express Server**: Simulates both the KakaoTalk bot webhook and hosts the target mock web application forms (form, secure captcha page, success page). It also exposes resume/status APIs.
2. **Task Manager**: Maintains in-memory Deferred Promises to pause and resume headless browser automation flows based on task IDs.
3. **Playwright Automation**: Orchestrates browser navigation through the form pages, inputting mock data, pausing when security/captcha pages are reached, and resuming upon trigger.

## Code Layout
```
kakao_admin_assistant/
├── package.json                  # Dependencies (express, playwright)
├── PROJECT.md                    # Global index: architecture, milestones, interfaces
├── ORIGINAL_REQUEST.md           # Verbatim user requirements
├── TEST_INFRA.md                 # Test track index: feature inventory, methodology, coverage goals
├── TEST_READY.md                 # Signal that test suite is complete with coverage summary
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
    ├── e2e_runner.js             # Test runner for E2E tests
    ├── tier1_coverage.test.js    # Tier 1: Feature coverage tests
    ├── tier2_boundary.test.js    # Tier 2: Boundary/error/corner cases
    ├── tier3_combination.test.js # Tier 3: Cross-feature combinations
    └── tier4_workload.test.js    # Tier 4: Real-world scenarios
```

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| E1 | Test Infra & Tier 1-2 Tests | Define E2E test runner, mock APIs/harness, Tier 1 and 2 tests | None | DONE (13a09ea4) |
| E2 | Full E2E Test Suite | Implement Tier 3-4 tests, write TEST_INFRA.md & publish TEST_READY.md | E1 | DONE (13a09ea4) |
| I1 | Mock Web App & Task Manager | Create mock HTML pages and task manager API (deferred promise mechanism) | None | DONE (dc25a854) |
| I2 | KakaoTalk Webhook & API | Setup Express webhook endpoint (R1) & Resume/Status API (R3) | I1 | DONE (dc25a854) |
| I3 | Playwright Automation Flow | Implement Playwright script with dynamic inputs and pause/resume (R2, R3) | I1, I2 | DONE (045da4e0) |
| I4 | E2E Integration Pass | Integrate code, run against E2E test suite (Tiers 1-4) until 100% pass | I3, E2 | DONE (13a09ea4) |
| I5 | Adversarial Hardening | Tier 5: White-box coverage audit, fix gaps and run adversarial tests | I4 | DONE (045da4e0) |

## Interface Contracts
### KakaoTalk Bot Webhook (R1)
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

### Automation Resume API (R3)
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

### Task Status Monitoring Endpoint (Internal)
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
