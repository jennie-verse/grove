# Grove 첫 릴리즈 테스트 보고서

- 릴리즈: 2026-09-05 첫 릴리즈
- 빌드: `2026.09.05-release`
- 작업 위치: `WebApp/Published/grove/`
- 실행 환경: `npm test` (Node `--test`, `tests/*.test.mjs`)

## 통과 항목

`npm test` 실행 결과 4개 테스트 파일, 총 18개 테스트 모두 통과했습니다.

| 테스트 파일 | 개수 | 내용 |
|---|---|---|
| `usage-session` 관련 (인라인) | 8 | 세션 경계, 자정 분리, idle 타임아웃, background/resume 분리, 0초 세션 미기록 등 |
| `tests/mode-policy.test.mjs` | 1 | Grove Read/Preview 모드 정책 |
| `tests/model.test.mjs` | 1 | 모델 fixture 생성 및 무결성 |
| `tests/static.test.mjs` | 1 | 앱 셸 정적 구성 (24개 항목) |
| `tests/sync-runner.test.mjs` | 1 | sync 순서, tombstone 처리, large-map 스킵 |
| 기타 개별 케이스 | 6 | map 활동 병합, projection 메타데이터, backup ledger, 저널 기록 경로, backfill 세션 루프/날짜 필터 |

합계: 18 pass / 0 fail / 0 skipped.

## Fresh-start 데이터 초기화 동작

이번 첫 릴리즈부터 `src/app.js`에 1회성 fresh-start 리셋이 추가되었습니다 (`FRESH_START_STAMP = "2026.09.05-firstrelease1"`).

- 최초 로드 시 `localStorage.getItem("grove.freshStartDone")` 값이 이번 빌드 스탬프와 다르면 리셋을 실행합니다.
- grove 자체 소유의 `localStorage` 키들만 제거합니다 (다른 앱의 키는 건드리지 않음).
- `indexedDB.deleteDatabase("grove-db")`로 grove 전용 IndexedDB만 삭제합니다.
- 리셋 후 `grove.freshStartDone`에 이번 빌드 스탬프를 기록해, 같은 빌드에서는 재실행되지 않습니다.
- 다른 Published 앱의 storage/DB는 대상이 아니므로 영향 없음.

## Pending — 실기기에서 직접 확인할 항목

- [ ] 실제 기기(Home Screen 설치 PWA 포함)에서 첫 로드 시 fresh-start 리셋이 정확히 1회만 실행되는지 확인.
- [ ] 리셋 후 Library가 빈 상태로 뜨고, 이전 빌드에서 남아있던 grove-db 데이터가 실제로 사라졌는지 확인.
- [ ] 기존 Home Screen 앱을 이번 빌드로 업데이트했을 때 SW 캐시가 새 버전으로 갱신되는지 확인 (sw.js `VERSION` = `2026.09.05-release`).
- [ ] 리셋 이후 정상적으로 새 map을 만들고 저장/동기화가 문제없이 동작하는지 실기기에서 확인.


## 2026-09-08 안정성 개선 검증

- 수정: 저장 중 추가 편집까지 순서대로 저장, Library 이동 전 인라인 편집 확정, 기존 맵 보존.
- 로컬 회귀 검사 및 JavaScript 문법 검사: 통과.
- Chromium 1280×900 / 390×844: 주요 조작, 재시작 후 기존 데이터 보존, 화면·페이지 오류 검사 통과.
- Service Worker를 통한 오프라인 앱 재실행: 통과.
- 실제 iPhone/iPad Safari, iCloud 공유, 실제 비공개 GitHub 데이터 동기화: 실기기 확인 필요.

## 2026-11-12 접이식(iPhone Duo)·Mac 최적화 검증

- 변경: `overscroll-behavior: none`(이미 있음) 유지, 버튼·입력·링크에 `touch-action: manipulation`, 접힌 폭(≤540px)에서 확대/축소 컨트롤이 노드 도구 막대와 겹치던 문제 수정(CSS만, 더 넓은 화면은 변경 없음). 빌드 `2026.11.12-foldable1`. 데이터 형식·저장 키·동기화는 변경 없음.
- Chromium 360×780 / 840×760 / 1000×700 / 1440×900: 가로 넘침 없음, 콘솔 오류 없음, 스크린샷 확인. 신규 `tests/layout.test.mjs` 포함 전체 테스트·문법 검사 통과.
- 실제 iPhone Duo 접기/펼치기 실기기 테스트는 quill 앱에서만 사용자가 수행했으며, 이 앱은 아직 실기기 확인이 필요합니다. Mac Safari 마우스·트랙패드 조작도 실기기 확인이 필요합니다.
- 2026-11-12 foldable2: 펼친 세로(669×951)에서 확대/축소 컨트롤과 노드 도구 막대가 겹치던 문제를 ≤720px 폭까지 확대 적용해 수정(CSS만, 720px 초과는 변경 없음). 빌드 `2026.11.12-foldable2`. 회귀 테스트는 `tests/layout.test.mjs`.
