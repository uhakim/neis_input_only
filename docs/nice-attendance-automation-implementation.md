# 나이스 출결 자동화 상세 구현 기록

## 목적

이 문서는 현재 프로젝트에서 나이스 출결 자동화를 어떤 방식으로 안정화했는지 자세히 정리한 기록이다.

특히 다음 문제들을 어떻게 해결했는지 남겨두는 것이 목적이다.

1. 로그인은 사람이 하고, 자동화는 로그인 이후 세션에 붙어야 하는 문제
2. 나이스 화면의 동적 ID, iframe, 가상 스크롤 때문에 셀렉터가 잘 흔들리는 문제
3. `일일출결입력` 팝업 내부의 `결석 > 질병` 라디오 버튼이 일반 클릭으로 잘 안 눌리던 문제
4. 저장 확인 팝업과 저장 완료 알림이 연속으로 떠서 자동화가 다음 단계로 못 넘어가던 문제
5. `연속출결입력`의 종료기간이 기본값으로 남아 잘못 저장되던 문제

이 문서를 보면 현재 구현의 의도, 핵심 함수, 실제 운영 순서를 한 번에 이해할 수 있다.

## 전체 구조

현재 자동화의 큰 흐름은 다음과 같다.

1. 사용자가 디버그 모드로 실행한 브라우저에서 나이스에 로그인한다.
2. 자동화 프로그램이 그 브라우저 세션에 붙는다.
3. 나이스 메인 창 또는 이미 열려 있는 출결 화면을 찾는다.
4. 출결 대상 학생과 날짜 칸을 찾는다.
5. 날짜 칸 클릭으로 `일일출결입력` 팝업을 연다.
6. 팝업에서 결석 종류, 사유, 기간을 입력한다.
7. 팝업 저장 후 뜨는 확인 팝업과 완료 알림까지 처리한다.
8. 다음 학생 또는 다음 입력 항목으로 넘어간다.

핵심 구현 파일은 다음과 같다.

- [index.js](c:/Users/win11/Desktop/vibe%20coding/%EC%B6%9C%EA%B2%B0%EC%9E%90%EB%8F%99%ED%99%94%20%EB%82%98%EC%9D%B4%EC%8A%A4%EB%B6%80%EB%B6%84/src/index.js)
- [browser.js](c:/Users/win11/Desktop/vibe%20coding/%EC%B6%9C%EA%B2%B0%EC%9E%90%EB%8F%99%ED%99%94%20%EB%82%98%EC%9D%B4%EC%8A%A4%EB%B6%80%EB%B6%84/src/lib/browser.js)
- [attendance.js](c:/Users/win11/Desktop/vibe%20coding/%EC%B6%9C%EA%B2%B0%EC%9E%90%EB%8F%99%ED%99%94%20%EB%82%98%EC%9D%B4%EC%8A%A4%EB%B6%80%EB%B6%84/src/lib/attendance.js)
- [popup-actions.js](c:/Users/win11/Desktop/vibe%20coding/%EC%B6%9C%EA%B2%B0%EC%9E%90%EB%8F%99%ED%99%94%20%EB%82%98%EC%9D%B4%EC%8A%A4%EB%B6%80%EB%B6%84/src/lib/popup-actions.js)
- [radio-test.js](c:/Users/win11/Desktop/vibe%20coding/%EC%B6%9C%EA%B2%B0%EC%9E%90%EB%8F%99%ED%99%94%20%EB%82%98%EC%9D%B4%EC%8A%A4%EB%B6%80%EB%B6%84/src/lib/radio-test.js)
- [confirm-test.js](c:/Users/win11/Desktop/vibe%20coding/%EC%B6%9C%EA%B2%B0%EC%9E%90%EB%8F%99%ED%99%94%20%EB%82%98%EC%9D%B4%EC%8A%A4%EB%B6%80%EB%B6%84/src/lib/confirm-test.js)
- [nice-selectors.json](c:/Users/win11/Desktop/vibe%20coding/%EC%B6%9C%EA%B2%B0%EC%9E%90%EB%8F%99%ED%99%94%20%EB%82%98%EC%9D%B4%EC%8A%A4%EB%B6%80%EB%B6%84/config/nice-selectors.json)
- [attendance-input.json](c:/Users/win11/Desktop/vibe%20coding/%EC%B6%9C%EA%B2%B0%EC%9E%90%EB%8F%99%ED%99%94%20%EB%82%98%EC%9D%B4%EC%8A%A4%EB%B6%80%EB%B6%84/config/attendance-input.json)

## 브라우저 연결 전략

로그인 자체는 자동화하지 않는다.

이유는 다음과 같다.

- 인증서, 보안 모듈, 세션 정책 때문에 로그인 자동화가 불안정하다.
- 로그인보다 로그인 이후 업무 자동화가 프로젝트의 핵심 가치다.
- 사람 손으로 로그인하고 자동화는 세션에 붙는 방식이 운영상 안전하다.

현재 전략은 다음과 같다.

1. Chrome을 `--remote-debugging-port=9222`로 실행한다.
2. 사용자가 업무포털 로그인 후 나이스 새 창까지 연다.
3. 자동화가 CDP로 브라우저에 연결한다.
4. 열린 탭 중에서 실제 나이스 메인 창을 점수 기반으로 찾는다.

관련 구현:

- `attachToLoggedInBrowser()`
- `findNicePage()`
- `assertLoggedIn()`

## 학생/날짜 칸 탐색 전략

이 부분은 별도 문서인 [attendance-targeting-strategy.md](c:/Users/win11/Desktop/vibe%20coding/%EC%B6%9C%EA%B2%B0%EC%9E%90%EB%8F%99%ED%99%94%20%EB%82%98%EC%9D%B4%EC%8A%A4%EB%B6%80%EB%B6%84/docs/attendance-targeting-strategy.md)에 더 자세히 정리돼 있다.

여기서는 요점만 정리한다.

- 나이스 출결 그리드는 가상 스크롤이라서 화면에 보이는 학생만 DOM에 존재할 수 있다.
- 따라서 `몇 번째 행` 기준 접근은 위험하다.
- 자동화는 `학생 이름`을 기준으로 현재 보이는 행을 찾는다.
- 안 보이면 그리드를 스크롤하며 다시 탐색한다.
- 날짜 칸도 `학생 행 내부의 날짜 셀`을 우선 찾고, 실패하면 fallback 후보를 쓴다.

핵심 함수:

- `ensureStudentRowVisible()`
- `extractStudentNames()`
- `findVisibleStudentRow()`
- `applyFieldAction()`
- `buildDateTokens()`

이 구조 덕분에 화면이 스크롤된 상태에서도 올바른 학생 날짜 칸을 다시 찾을 수 있다.

## 팝업 진입 후 기본 흐름

학생 날짜 칸을 누르면 `일일출결입력` 팝업이 열린다.

팝업 진입 뒤 기본 순서는 다음과 같다.

1. 팝업 open signal 확인
2. `결석` 구역 옵션이 실제로 렌더링될 때까지 대기
3. 출결 종류 선택
4. 사유 입력
5. 연속입력이면 시작/종료기간 입력
6. 저장
7. 저장 확인 팝업 처리
8. 저장 완료 알림 처리

관련 함수:

- `applyAttendanceDialog()`
- `waitForDialogTypeOptions()`
- `fillDialogReason()`
- `fillDialogPeriod()`
- `waitForAttendanceDialogResolution()`

## 왜 `결석 > 질병` 라디오 버튼이 어려웠는가

초기에는 단순 텍스트 클릭이나 일반 selector click으로 `질병` 라디오가 잘 눌리지 않았다.

원인은 다음과 같다.

- 실제 클릭 대상은 텍스트가 아니라 커스텀 라디오 아이콘이었다.
- `결석`, `지각`, `조퇴`, `결과`가 비슷한 구조로 동시에 존재했다.
- 텍스트 클릭은 다른 구역과 섞일 가능성이 있었다.
- 팝업이 막 열린 직후에는 라디오 DOM이 아직 안정되지 않은 경우가 있었다.

그래서 최종 전략은 다음과 같이 바뀌었다.

1. 보이는 `일일출결입력` 팝업만 대상으로 삼는다.
2. 그 안에서 `aria-label`이 `결석`으로 시작하는 radiogroup을 찾는다.
3. 그 radiogroup 안에서 `질병`, `미인정`, `기타`, `출석인정` 중 목표 항목을 찾는다.
4. 해당 라디오 아이콘의 실제 좌표를 계산한다.
5. 그 좌표를 마우스로 클릭한다.
6. 클릭 후 `.cl-selected` 상태가 실제로 바뀌었는지 확인한다.
7. 실패하면 짧게 대기 후 재시도한다.

이 최종 구현은 [popup-actions.js](c:/Users/win11/Desktop/vibe%20coding/%EC%B6%9C%EA%B2%B0%EC%9E%90%EB%8F%99%ED%99%94%20%EB%82%98%EC%9D%B4%EC%8A%A4%EB%B6%80%EB%B6%84/src/lib/popup-actions.js)의 `clickAttendanceTypeOptionDomRobust()` 에 들어 있다.

## 왜 `radio-test` 모드를 만들었는가

전체 자동화에서 실패하면 원인이 너무 많아서 라디오 버튼 문제를 따로 떼어 확인할 필요가 있었다.

그래서 `radio-test` 모드를 만들었다.

이 모드는:

- 이미 열린 `일일출결입력` 팝업을 전제로 한다.
- 전체 흐름 없이 `결석 > 질병` 라디오만 눌러본다.
- 클릭 전후 상태를 아티팩트로 저장한다.

관련 파일:

- [radio-test.js](c:/Users/win11/Desktop/vibe%20coding/%EC%B6%9C%EA%B2%B0%EC%9E%90%EB%8F%99%ED%99%94%20%EB%82%98%EC%9D%B4%EC%8A%A4%EB%B6%80%EB%B6%84/src/lib/radio-test.js)

관련 명령:

```powershell
npm run radio-test
```

이 모드가 성공하면서 `라디오 클릭 로직 자체는 된다`는 걸 먼저 분리해서 증명할 수 있었다.

## `npm start`와 `radio-test` 차이를 줄인 방법

초기에 `radio-test`는 되는데 `npm start`는 안 되는 문제가 있었다.

이 차이는 주로 다음 때문이었다.

- `start`는 팝업이 열린 직후 바로 조작했다.
- `radio-test`는 이미 사람이 띄워둔 안정된 팝업에서만 조작했다.
- `start`에서 불필요하게 daily mode를 다시 누르던 시점도 있었다.

이를 줄이기 위해 다음 조정을 했다.

- `daily` 모드는 팝업이 기본값이므로 다시 누르지 않게 함
- 팝업 open signal만 보지 않고 `결석` 옵션 4개가 렌더링될 때까지 기다리게 함
- 라디오 클릭 후 선택 상태 확인까지 포함함

결과적으로 `start`도 `radio-test`와 거의 같은 조건에서 라디오를 누르도록 맞췄다.

## 저장 확인 팝업 처리

팝업의 `저장` 버튼을 누르면 바로 끝나는 것이 아니라, 먼저 `해당자료를 저장하시겠습니까?` 확인 팝업이 뜬다.

여기서 초기에는 다음 문제가 있었다.

- 버튼을 찾긴 했지만 실제 클릭이 안 먹는 경우가 있었다.
- 숨겨진 다른 dialog와 헷갈릴 수 있었다.

그래서 최종 전략은:

1. 보이는 dialog만 대상으로 한다.
2. 본문에 저장 확인 문구가 포함된 dialog를 찾는다.
3. 그 안의 `확인` 버튼 좌표를 계산한다.
4. 좌표 클릭 후 dialog가 실제로 사라졌는지 확인한다.

관련 함수:

- `handlePostSaveConfirmationRobust()`

## 저장 완료 알림 처리

저장 확인 팝업이 끝난 뒤 바로 다음 항목으로 넘어갈 수 없었다.

이유는 저장 완료 후에 또 한 번:

- `알림`
- `저장했습니다.`
- `확인`

형태의 후속 안내 팝업이 떴기 때문이다.

이 팝업을 닫지 않으면 다음 학생, 다음 날짜 입력으로 진행할 수 없다.

그래서 후속 알림을 별도 단계로 추가했다.

최종 흐름:

1. 팝업 저장 클릭
2. 저장 확인 팝업 `확인`
3. 원래 출결 팝업 닫힘 확인
4. `저장했습니다.` 알림 팝업 `확인`
5. 다음 작업 진행

관련 함수:

- `acknowledgeInformationalAlertRobust()`

## 연속출결입력 날짜 문제와 해결

연속출결입력에서는 `종료기간`이 제대로 안 들어가서 월말 기본값이 그대로 남는 문제가 있었다.

실제 증상:

- 입력 의도는 `2026.03.05.` ~ `2026.03.06.` 이었다.
- 저장 결과는 종료기간이 `3월 30일`처럼 기본값으로 남았다.

원인은 보통 다음 중 하나였다.

- `fill()`이 UI 마스크 컴포넌트에 완전히 반영되지 않음
- 기존 값이 완전히 지워지지 않음
- blur가 발생하지 않아 내부 상태가 갱신되지 않음

그래서 날짜 입력은 다음 방식으로 강화했다.

1. 날짜 필드를 클릭한다.
2. `Ctrl+A`로 전체 선택한다.
3. `Delete`로 기존 값을 지운다.
4. 새 날짜를 직접 타이핑한다.
5. `Tab`으로 blur를 발생시킨다.
6. 입력 후 실제 input 값을 읽는다.
7. 숫자만 남긴 값이 기대값과 정확히 같은지 검증한다.
8. 다르면 저장 전에 즉시 오류로 중단한다.

관련 함수:

- `fillDialogDateField()`
- `normalizeDateInputValue()`
- `fillDialogPeriod()`

이제는 종료기간이 잘못 들어가면 조용히 잘못 저장되는 대신, 저장 전에 안전하게 실패하도록 바뀌었다.

## 현재 입력 데이터 형식

현재 [attendance-input.json](c:/Users/win11/Desktop/vibe%20coding/%EC%B6%9C%EA%B2%B0%EC%9E%90%EB%8F%99%ED%99%94%20%EB%82%98%EC%9D%B4%EC%8A%A4%EB%B6%80%EB%B6%84/config/attendance-input.json)은 학생별로 `values.status` 객체를 사용한다.

예시:

```json
{
  "students": [
    {
      "name": "김태이",
      "values": {
        "status": {
          "mode": "daily",
          "targetDate": "2026.03.03.",
          "type": "질병",
          "reason": "병원 진료"
        }
      }
    },
    {
      "name": "김태이",
      "values": {
        "status": {
          "mode": "continuous",
          "startDate": "2026.03.05.",
          "endDate": "2026.03.06.",
          "type": "미인정",
          "reason": "가정 사정"
        }
      }
    }
  ]
}
```

의미는 다음과 같다.

- `mode: daily` 는 하루짜리
- `mode: continuous` 는 연속입력
- `type` 은 `질병`, `미인정`, `기타`, `출석인정`
- `targetDate` 는 하루짜리 기준 날짜
- `startDate`, `endDate` 는 연속입력 기준 날짜
- `reason` 은 팝업의 사유 입력 칸

## 현재 지원하는 보조 모드

### inspect

현재 화면 구조를 진단하고 셀렉터/프레임 정보를 아티팩트로 남긴다.

```powershell
npm run inspect
```

### radio-test

열려 있는 `일일출결입력` 팝업에서 라디오 클릭만 검증한다.

```powershell
npm run radio-test
```

### confirm-test

이미 떠 있는 저장 확인창에서 `확인` 버튼만 눌러본다.

```powershell
npm run confirm-test
```

### start

전체 출결 자동화를 실행한다.

```powershell
npm start
```

## 남은 작업

현재까지 안정화된 범위는 다음과 같다.

- 브라우저 세션 연결
- 나이스 메인/출결화면 선택
- 학생/날짜 칸 탐색
- `일일출결입력` 팝업 진입
- `결석 > 질병/미인정/...` 선택
- 사유 입력
- 연속입력 기간 입력
- 저장 확인 처리
- 저장 완료 알림 처리

다음 큰 작업은 `비고등록` 자동화다.

이 작업은 현재 출결 팝업 자동화와는 별도 흐름으로 분리해서 구현하는 것이 좋다.

이유는:

- 현재 출결 입력 흐름이 이미 길고 상태 전환이 많다.
- 비고등록은 다른 버튼과 다른 팝업 구조를 가질 가능성이 높다.
- 학생/날짜 칸 탐색 로직은 재사용하고, 팝업 내부 조작만 별도로 붙이는 편이 안전하다.

## 운영 원칙 요약

현재 자동화에서 가장 중요한 원칙은 다음 다섯 가지다.

1. 로그인은 사람, 업무 자동화는 프로그램
2. 학생 탐색은 행 번호가 아니라 학생 이름 기준
3. 팝업 내부 클릭은 텍스트가 아니라 실제 보이는 활성 dialog 기준
4. 저장은 하나의 버튼 클릭이 아니라 여러 확인 단계의 묶음
5. 날짜 입력은 눈속임이 아니라 실제 값 검증까지 포함

이 원칙이 현재 안정성의 핵심이다.
