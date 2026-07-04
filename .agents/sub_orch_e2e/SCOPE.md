# Scope: E2E Testing Track

## Architecture
The E2E testing infrastructure runs opaque-box E2E tests against the KakaoTalk Admin Assistant application.
- **E2E Test Runner**: A Node.js runner (`tests/e2e_runner.js`) that boots the Express server, executes test files, asserts test outputs, and handles cleanup (stopping the server, reporting exit codes).
- **Mock Web App Form**: Interactive form at `/form.html` (applicant details).
- **Captcha Verification Page**: Security gate at `/secure.html` (requires pause and resume signal).
- **Success Page**: Redirection endpoint `/success.html` after a successful flow.
- **Tiers 1-4 Tests**: Structured JS files containing assertions for:
  - Tier 1: Feature Coverage (happy-paths, 5 tests per feature, total >= 15).
  - Tier 2: Boundary & Corner Cases (edge cases, error inputs, total >= 15).
  - Tier 3: Cross-Feature combination (pairwise combinations, total >= 3).
  - Tier 4: Real-World Application scenarios (comprehensive flows, total >= 5).

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| E1 | Test Infra & Tiers 1-2 | Define E2E test runner (`tests/e2e_runner.js`), design/implement Tier 1 (`tests/tier1_coverage.test.js`) and Tier 2 (`tests/tier2_boundary.test.js`) tests, and write `TEST_INFRA.md` | None | DONE |
| E2 | Tiers 3-4 & TEST_READY | Implement Tier 3 (`tests/tier3_combination.test.js`) and Tier 4 (`tests/tier4_workload.test.js`) tests, verify correctness, and publish `TEST_READY.md` | E1 | DONE |

## Interface Contracts
- See `PROJECT.md` for full API details:
  - KakaoTalk Bot Webhook: `POST /api/kakao/webhook`
  - Automation Resume API: `POST /api/automation/resume`
  - Task Status Monitoring: `GET /api/automation/status/:taskId`
