# Honeybee Admin Assistant - Hackathon Project

This application is built for the **Kakao AGENTIC PLAYER 10** hackathon. It provides an AI-driven online administrative assistant via an MCP server architecture.

## 🚀 Features

### 1. MCP Server Integration
The server runs locally on port 8080 and exposes an SSE endpoint (`http://localhost:8080/sse`) ready to be plugged into the **PlayMCP Console**.
It provides the following Tools to the Kakao AI Agent:
- `get_recommendations`: Analyzes a user's profile and returns a personalized list of proactive policy suggestions.
- `search_policies`: Queries a database of crawled government policies.
- `start_application`: Initiates Playwright to automatically fill and submit forms on behalf of the user.
- `check_status`: Polls the status of the background task (e.g., checks if it is paused for security).
- `resume_application`: Submits user-provided captcha/auth code to resume the paused automation.

### 2. Proactive Suggestions & Push Notifications
- **Smart Matching Algorithm:** Calculates a matching score based on age, job, housing status, and deadline proximity.
- **Scheduled Push Logic:** Configured to strictly trigger at **10 AM, 12 PM, 4 PM, 6 PM, 8 PM**.
- **Smart Bundling & Nagging:** Groups multiple recommendations into a single push. Ensures the same policy isn't spammed multiple times on the same day, but *will* re-notify on subsequent days if the deadline is within 7 days ("마감 임박").

**How to test the notification scheduler:**
```bash
node test_notifier.js
```
This script will simulate time passing (e.g., checking hour 3 vs hour 10) and demonstrate how notifications are bundled, sent, and de-duplicated.

### 3. Government Policy Crawler
A data pipeline to aggregate policies.
- **API Fetcher:** Mocks or fetches structured Open API data (e.g. data.go.kr).
- **Web Scraper (Playwright):** Visits government announcement boards and scrapes policy details.
- **Database:** Merges and normalizes the data into a local `policies.json`.

### 4. Human-in-the-Loop Automation
When `start_application` runs, the headless browser fills out the form. If it encounters a captcha or an authentication block, the task pauses. The user is notified and can supply the captcha code via `resume_application`, allowing the browser to proceed and complete the submission!
