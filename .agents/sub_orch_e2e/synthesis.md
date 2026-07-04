# Synthesis: E1 Test Infrastructure & Test Design

## Consensus
Explorers 1 and 2 reached a 100% consensus on the testing stack and design:
- **Test Runner Framework**: Standard Node.js native test runner (`node:test` and `node:assert`) to run without external dependencies (reducing complexity under `CODE_ONLY` network restrictions).
- **Execution isolation**: A custom runner `tests/e2e_runner.js` will boot the mock server as a child process, wait for it to be active, run the tests, and shut down the server.
- **Port waiting**: Implementing a clean socket-based wait in `tests/e2e_runner.js`.
- **Test case count**: 15 Tier 1 tests (5 per feature) and 15 Tier 2 tests (5 per feature).

## Proposed Files to Implement in Milestone E1
1. `package.json`: express, playwright dependencies.
2. `tests/e2e_runner.js`: Orchestrator for the test execution lifecycle.
3. `tests/tier1_coverage.test.js`: Tier 1 feature coverage tests.
4. `tests/tier2_boundary.test.js`: Tier 2 boundary and corner cases.
5. `TEST_INFRA.md`: Project-level documentation of test methodologies and coverage.
