# Honeybee Admin Assistant - Master Implementation Plan (Hackathon)

이 문서는 카카오 **AGENTIC PLAYER 10** 해커톤 출품을 위해 개발된 프로젝트의 전체 아키텍처와 모든 세부 구현 기능(크롤링, 알림, 브라우저 자동화, MCP 연동)을 종합한 마스터 기획/설계 문서입니다.

---

## 1. Project Goal (목표)
PlayMCP 환경에서 카카오톡 봇과 연동되어 **"맞춤형 정책 추천부터 복잡한 온라인 행정업무 대행(인증/캡챠 포함)까지 원스톱으로 처리하는 AI 어시스턴트"**를 구축합니다.

## 2. Architecture Overview (아키텍처 개요)
- **Framework**: Node.js, Express
- **Protocol**: MCP (Model Context Protocol) via SSE (Server-Sent Events)
- **Browser Automation**: Playwright (Headless 브라우저)
- **Database**: Local JSON Data Store (policies, users)

## 3. Core Features & Implementation Details (핵심 기능 및 구현 상세)

### A. 맞춤형 정책 실시간 제안 및 알림 (Proactive Policy Suggestions)
- **Data Crawling (`src/crawler`)**:
  - `api_fetcher.js`: 공공데이터포털 등의 Open API를 통해 정형화된 정책 데이터를 수집합니다.
  - `web_scraper.js`: Playwright를 이용해 API가 없는 지자체 공지사항 등의 웹페이지 DOM을 파싱하여 비정형 데이터를 수집합니다.
  - 수집된 데이터는 `db.js`를 통해 중복을 제거하고 정규화되어 `policies.json`에 저장됩니다.
- **Smart Recommendation (`get_recommendations` Tool)**:
  - 사용자 프로필(나이, 직업, 주택 소유 여부 등)을 분석하여 맞춤형 정책을 선별합니다.
  - 카카오 AI 에이전트가 채팅방 입장 시 즉시 이 도구를 호출하여 사용자에게 먼저(Push) 제안합니다.
- **Push Notification Scheduler (`notifier.js`)**:
  - 지정된 특정 시간(10시, 12시, 16시, 18시, 20시)에만 알림을 발송하여 스팸성 메시지를 방지합니다.
  - 마감 임박(7일 이내) 정책은 리마인드 알림을 보내고, 여러 정책은 한 번에 묶어서(Bundling) 발송합니다.

### B. 헤드리스 브라우저를 통한 행정업무 대행 (Browser Automation)
- **Form Automation (`start_application` Tool)**:
  - AI가 정책 신청에 필요한 기본 정보(이름, 이메일, 금액 등)를 수집하여 도구를 호출하면, 서버의 Playwright가 백그라운드에서 타겟 웹사이트로 이동하여 자동으로 폼을 작성합니다.

### C. Human-in-the-Loop 보안 및 인증 처리 (Security Pause & Resume)
- **Task Management (`taskManager.js`)**:
  - 각 대행 작업은 고유한 `taskId`를 가지며 인메모리 상태 머신(Pending, Running, Paused, Completed, Failed)으로 관리됩니다.
- **Security Handling (`check_status` & `resume_application` Tools)**:
  - 브라우저가 자동화 도중 캡챠나 본인인증(로그인) 페이지를 만나면 상태를 `PAUSED_SECURITY`로 전환합니다.
  - AI가 `check_status`로 이를 감지하고 카카오톡 사용자에게 캡챠 코드를 묻습니다.
  - 사용자가 코드를 제공하면 AI는 `resume_application`을 호출하고, 브라우저는 입력을 받아 남은 절차를 최종 제출까지 마무리합니다.

## 4. MCP Tools Specification (MCP 도구 명세)
서버는 다음과 같은 5가지 도구를 PlayMCP 클라이언트(AI 에이전트)에 노출합니다.
1. `get_recommendations(userId)`: 사용자 프로필 기반 정책 선제안 리스트 반환
2. `search_policies(keyword, category)`: 전체 정책 데이터베이스 검색
3. `start_application(name, email, amount)`: 온라인 행정업무 대행 봇 실행 (비동기)
4. `check_status(taskId)`: 현재 봇의 상태(인증 대기 여부 등) 모니터링
5. `resume_application(taskId, captchaCode)`: 사용자 인증 정보를 받아 멈춰있던 봇 작업 재개

## 5. Verification & Testing
- E2E 및 시스템 테스트 코드가 `tests/` 폴더에 구성되어 있으며, 캡챠가 발생하는 가상의 대출 폼을 상대로 브라우저 조작부터 도구 호출(Pause/Resume)까지 전체 사이클 검증이 완료되었습니다.
