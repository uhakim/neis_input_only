# NICE 출결 자동화

사용자가 직접 나이스에 로그인한 뒤, 이 프로그램이 이미 열린 브라우저 세션에 붙어서 출결 처리 화면 이동과 입력/저장을 자동화합니다.

## 빠른 시작

1. `npm install`
2. PowerShell에서 `./scripts/start-edge-debug.ps1` 또는 `./scripts/start-chrome-debug.ps1` 실행
3. 열린 빈 브라우저 창에 사용자가 직접 주소를 입력하고 업무포털 로그인 후 나이스 새창까지 진입
4. `config/*.json`을 실제 학교 화면에 맞게 조정
5. `npm start`

현재 PC에 Edge가 없으면 `./scripts/start-chrome-debug.ps1`를 사용하면 됩니다. 크롬과 엣지는 이 자동화 목적에서 큰 차이가 없고, 설치되어 있는 브라우저를 쓰는 편이 가장 간단합니다.

업무포털과 나이스가 여러 창으로 나뉘어 열려도 괜찮습니다. 자동화는 `pen.neis.go.kr/jsp/main.jsp` 쪽 실제 나이스 메인 창을 우선 선택합니다.

실제 셀렉터를 보정할 때는 먼저 `npm run inspect`를 실행하세요. 그러면 `artifacts/inspection/frame-diagnostics.json`과 화면 스크린샷이 생성되어, 어느 프레임 안에 어떤 메뉴 텍스트와 버튼이 있는지 확인할 수 있습니다.

## 핵심 방식

- 로그인은 자동화하지 않습니다.
- 원격 디버깅 포트로 열린 브라우저에 Playwright가 연결합니다.
- 동적 ID/XPath 대신 텍스트, role, title, 구조 기반 후보 셀렉터를 순서대로 시도합니다.
- iframe 내부까지 포함해서 탐색합니다.
- 실패 시 `artifacts/`에 스크린샷을 남기고 `logs/`에 실행 로그를 기록합니다.

## 설정 파일

- `config/attach-config.json`: 브라우저 연결 정보
- `config/job-config.json`: 학년/반/일자 같은 실행 조건
- `config/attendance-input.json`: 학생별 입력 데이터
- `config/nice-selectors.json`: 메뉴 이동, 검색, 저장, 학생 목록, 성공 신호 후보 셀렉터

## 커스터마이징 팁

- 나이스 UI는 지역/권한/업무 화면에 따라 구조가 다를 수 있어 `config/nice-selectors.json`을 실제 화면 기준으로 보정해야 합니다.
- 학생 이름 열, 출결 상태 입력 방식이 다르면 `studentList`와 `attendanceRows.fields`를 먼저 수정하세요.
- 권장 환경은 브라우저 배율 100%, 창 최대화, 동일 브라우저 프로필 재사용입니다.
- 출결 그리드는 가상 스크롤 방식일 수 있어, 보이는 학생만 DOM에 존재할 수 있습니다. 현재 구현은 학생 이름을 기준으로 보이는 행을 찾고, 필요하면 그리드를 스크롤하면서 다시 탐색하도록 설계되어 있습니다.

## 검증

- `npm test`

## 진단 모드

- `npm run inspect`
- 필요하면 `node src/index.js --mode inspect --keywords 출결,학생생활,학급담임`
- 결과물:
  - `artifacts/inspection/page-overview.png`
  - `artifacts/inspection/frame-diagnostics.json`

이 JSON에는 프레임별 URL, 제목, heading, 상호작용 가능한 요소, 키워드와 매칭된 요소 목록이 들어 있습니다. 나이스 화면에서 메뉴가 iframe 안에 들어가 있거나 ID가 자주 바뀌는 경우, 이 파일을 기준으로 `config/nice-selectors.json`을 보정하면 훨씬 빠릅니다.

테스트는 핵심 셀렉터 조합과 명단 검증 유틸리티를 대상으로 합니다. 실제 나이스 사이트 E2E 검증은 로그인 세션이 필요하므로 별도로 현장 점검이 필요합니다.
