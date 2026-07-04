# Original User Request

## Initial Request — 2026-07-04T03:26:26+09:00

# Teamwork Project Prompt — Draft

An AI assistant integrated with a KakaoTalk bot that automates online administrative tasks using a headless browser. For the demo, it focuses on the "청년 맞춤형 전월세 대출" (Youth rent/deposit loan) application. The user simply approves the tailored policy suggestion via chat, and the assistant handles the online application process, prompting the user only for necessary security steps like authentication and captchas.

Working directory: /Users/uricho/Desktop/Watson/teamwork_projects/kakao_admin_assistant
Integrity mode: demo

## Requirements

### R1. KakaoTalk Bot Interface
The system must provide a webhook or API endpoint that simulates a KakaoTalk bot interaction. It should send a policy proposal to the user and accept an "approval" command to trigger the automation.

### R2. Headless Browser Automation
Upon receiving approval, the assistant must use headless browser automation to navigate to a target web form, fill in required applicant details, and submit the form. 

### R3. Human-in-the-Loop for Security
The automation process must be able to pause when it encounters a simulated security prompt (e.g., login or captcha) and notify the user to provide input before resuming the automation.

## Acceptance Criteria

### Bot Interaction
- [ ] A provided test script can successfully send a mock POST request to the bot's endpoint and receive a JSON response containing the policy proposal.
- [ ] The bot successfully parses a simulated "approve" command and initiates the background browser automation task.

### Browser Automation & Human-in-the-Loop
- [ ] The headless browser successfully navigates a locally hosted mock HTML application form, fills it out with predefined mock user data, and submits it automatically.
- [ ] When navigating to a specific "mock secure page", the automation system pauses and exposes a way (e.g., via console or API) for the user to provide a "captcha solved" signal before successfully completing the process.
