# Scope: E2E Testing Track (Remediation)

## Architecture
The testing suite consists of four tiers of E2E tests:
1. **Tier 1 (Feature Coverage)**: `tests/tier1_coverage.test.js`
2. **Tier 2 (Boundary/Error/Corner)**: `tests/tier2_boundary.test.js`
3. **Tier 3 (Cross-Feature Combinations)**: `tests/tier3_combination.test.js`
4. **Tier 4 (Real-World Application Scenarios)**: `tests/tier4_workload.test.js`

These tests query various endpoints including `POST /api/automation/resume` and `GET /api/automation/captcha/:taskId`. The `GET /api/automation/captcha/:taskId` endpoint requires an `Authorization: Bearer mock-secret-token-123` header to authenticate, which the tests currently omit.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| 1 | Explore & Analyze | Analyze existing E2E test files and server authentication requirements | None | PLANNED |
| 2 | Implementation | Update the E2E test files to add the Authorization header to all GET captcha requests | 1 | PLANNED |
| 3 | Verification | Run the test suite and ensure all tests pass (Reviewer & Challenger verification) | 2 | PLANNED |
| 4 | Audit & Sign-off | Run the Forensic Auditor to ensure clean verification, update TEST_READY.md, and report victory | 3 | PLANNED |

## Interface Contracts
### Captcha API ↔ E2E Tests
- **Endpoint**: `GET /api/automation/captcha/:taskId`
- **Headers**:
  - `Authorization: Bearer mock-secret-token-123`
- **Response**:
  - `200 OK` with JSON object containing captcha details (e.g., code, page image placeholder, etc.)
  - `401 Unauthorized` if token is missing/incorrect
