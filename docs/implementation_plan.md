# Proactive Policy Suggestion Protocol Plan

사용자가 봇에게 먼저 질문하기 전에, **AI가 사용자 맞춤형 정책을 선제적으로 찾아 제안(Push/Recommend)하는 프로세스**를 추가하기 위한 구현 계획입니다.

## Goal
사용자의 프로필(나이, 소득, 직업 등)을 기반으로 가장 적합한 정책을 매칭하고, 이를 카카오톡 에이전트가 사용자에게 "선제안" 할 수 있는 로직을 MCP 서버에 추가합니다.

## Proposed Changes

### 1. 사용자 프로필 목업 (Mock User DB)
#### [NEW] [src/crawler/user_db.js](file:///Users/uricho/Desktop/Watson/teamwork_projects/kakao_admin_assistant/src/crawler/user_db.js)
- 사용자의 가상 데이터를 저장/관리합니다.
- 예: `user_1` (25세, 무주택, 소상공인)

### 2. 맞춤형 추천 알고리즘 로직
#### [MODIFY] [src/crawler/db.js](file:///Users/uricho/Desktop/Watson/teamwork_projects/kakao_admin_assistant/src/crawler/db.js)
- `recommendPoliciesForUser(userProfile)` 함수를 추가합니다.
- 정책의 `target_audience`(지원대상) 문구와 사용자의 프로필 데이터를 비교하여 매칭 스코어를 계산하고 높은 순서대로 반환합니다.

### 3. 새로운 MCP Tool 확장
#### [MODIFY] [src/mcp_server.js](file:///Users/uricho/Desktop/Watson/teamwork_projects/kakao_admin_assistant/src/mcp_server.js)
- **`get_recommendations` Tool 추가:**
  - **입력:** `userId` (또는 사용자 프로필 정보)
  - **출력:** 해당 사용자에게 딱 맞는 "추천 정책 리스트"와 "추천 사유" 반환
  - **활용:** 카카오톡 에이전트가 대화방이 열리자마자 이 툴을 호출하여 "OOO님, 방금 뜬 청년 전월세 대출 정책 대상자이신데, 바로 신청 대행해 드릴까요?" 라고 봇이 먼저 말을 걸 수 있게 합니다.

### 4. 백그라운드 매칭 알림 (Push Notification Mock)
#### [MODIFY] [src/crawler/index.js](file:///Users/uricho/Desktop/Watson/teamwork_projects/kakao_admin_assistant/src/crawler/index.js)
- 크롤러가 새로운 정책을 수집했을 때, 기존에 등록된 `user_db`를 순회하며 조건이 맞는 사용자가 있는지 확인합니다.
- 매칭될 경우 "카카오 알림톡(웹훅) 발송 프로세스"를 호출하는 로직(로그 출력)을 추가하여, 실시간 알림 시스템의 뼈대를 완성합니다.

## User Review Required
> [!IMPORTANT]
> **선제안 발동 시점 선택**
> 해커톤에서 "선제안"을 보여주기 위해 2가지 시나리오가 가능합니다. 두 가지를 모두 구현해 둘 예정입니다.
> 1. **대화방 입장 시점:** 사용자가 카카오톡 봇에 들어왔을 때, 봇이 `get_recommendations` 도구를 써서 바로 정책을 띄워줌.
> 2. **크롤러 수집 시점 (알림톡):** 새벽에 크롤러가 새 정책을 발견하자마자, 사용자에게 알림톡(메시지)을 푸시(Push)하는 형태. (실제 알림톡 API 대신 터미널 로그 및 가상 엔드포인트로 구현)
> 
> 이 방식대로 로직을 추가하는 것이 맞을까요? 마음에 드신다면 **Proceed**를 눌러주세요!
