# Grove — 무엇인지, 파일 구조, 바꾸는 법

## 무엇인지

Grove는 개인용 오프라인 우선 Mind Map(마인드맵) 편집 앱입니다. 여러 맵, 자유 배치, 노드·연결선 스타일, Memo, Markdown Note, 검색, Outline, Undo/Redo, Read Mode, JSON 백업·복원, SVG/PNG export를 제공합니다. 빌드 도구나 서버 없이 GitHub Pages에 그대로 배포합니다.

저장소·배포 주소: `github.com/jennie-verse/grove` → `https://jennie-verse.github.io/grove/`

## 파일 구조

```text
grove/
├─ .nojekyll                  GitHub Pages가 Jekyll로 처리하지 않도록 하는 표시 파일
├─ index.html                 앱 셸과 PWA 메타데이터
├─ manifest.webmanifest       홈 화면 설치 정보
├─ sw.js                      Service Worker — 오프라인 캐시
├─ assets/
│  ├─ app.css                 디자인 토큰(라이트·다크)과 전체 스타일
│  └─ fonts/                  Lexend 400·700 (오프라인 동봉)
├─ src/
│  ├─ app.js                  화면 렌더링, 이벤트 처리, 진입점
│  ├─ version.js              APP_BUILD — sw.js의 VERSION과 반드시 같아야 함
│  ├─ model.js                맵·노드·연결선 데이터 모델과 기본값
│  ├─ store.js                IndexedDB 저장·불러오기
│  ├─ sync.js                 webapp-data 읽기·쓰기 (이벤트·동기화·백업)
│  ├─ sync-runner.js          동기화 순서와 시점 (받아오기 → 합치기 → 올리기)
│  ├─ history.js              Undo/Redo 스택
│  └─ formats.js, markdown.js  SVG/PNG export, Markdown Note 파싱
├─ icons/                     앱 아이콘 (PNG 3종)
├─ licenses/Lexend-OFL.txt    Lexend 폰트 라이선스
├─ tests/                     모델·정적 파일 테스트 (Node.js `node --test`)
└─ docs/                      이 문서들
```

## 자주 바꾸는 위치

| 바꾸고 싶은 것 | 위치 |
|---|---|
| 앱 이름 | `index.html`의 `<title>`, `manifest.webmanifest`의 `name`/`short_name` |
| 대표색·라이트·다크 테마 변수 | `assets/app.css`의 `:root`, `:root[data-theme="dark"]` |
| 기본 노드·연결선 스타일 | `src/model.js`의 `DEFAULT_EDGE` 등 기본값 상수 |
| Service Worker 캐시 버전·프리캐시 목록 | `sw.js`의 `CACHE_NAME`, `APP_SHELL` |

Service Worker 파일이나 `APP_SHELL`에 든 파일의 내용을 바꾸어 배포할 때는 `CACHE_NAME`도 `grove-v11`처럼 올려야 이전 캐시가 제거됩니다. 올리지 않으면 홈 화면 앱에 옛 버전이 계속 남습니다.

## 데이터가 저장되는 곳

- 맵 데이터(노드·연결선·Memo 등): 이 브라우저의 IndexedDB (`grove-db`)
- 화면 설정(글자 크기, 테마 등): 이 브라우저의 localStorage (`grove-preferences-v2`)

기기를 바꾸거나 브라우저 저장소가 지워지면 데이터가 사라집니다. 정기적으로 Library의 Backup으로 JSON을 내보내 iCloud Drive 등에 보관하세요. 자세한 절차는 [백업·복원 안내](BACKUP-RESTORE-KO.md)를 확인하세요.

동기화(Sync)를 켜면 `webapp-data`(비공개 저장소)에도 함께 올라갑니다. 켜는 법과 주의점은 [사용 안내](USER-GUIDE-KO.md)의 "동기화 (Sync)"를 확인하세요.

| 층 | 파일 | 무엇 |
|---|---|---|
| A | `grove/index.<기기>.json` | 맵 목록·메타 (제목, 시각, 삭제 표시) |
| A | `grove/maps/<맵id>.<기기>.json` | 맵 본문 1개당 1파일 |
| B | `events/grove.<기기>.<YYYY-MM>.json` | 맵을 만든 기록 — 보관된 Atlas·Trace 형식과의 호환용이며 현재 활성 소비 앱은 없음 |
| C | `backups/grove/YYYY-MM-DD.json` | 복원용 스냅샷, 최근 12개 |

`views`(기기별 화면 위치)는 올리지 않습니다. 맵 본문은 **바뀐 것만** 올립니다.

## 고칠 때 지켜야 하는 것 네 가지

1. **`sw.js`의 `VERSION`과 `src/version.js`의 `APP_BUILD`는 항상 같은 값이어야 합니다.** Service Worker가 캐시를 먼저 돌려주기 때문에, 배포해도 기기에서는 이전 빌드가 도는 시간이 있습니다. 설정 화면의 App version이 그것을 눈으로 확인하는 유일한 수단입니다.
2. **`sw.js`의 fetch 핸들러에서 크로스오리진 요청을 건드리지 마세요.** `origin !== self.location.origin` 이면 그냥 통과시켜야 합니다. 이 줄을 지우면 `api.github.com`으로 나가는 **읽기만** 실패하고 쓰기는 통과해서, 올리기가 원격 목록을 빈 값으로 덮어씁니다.
3. **`src/sync.js`에서 공용 모듈을 정적 `import` 하지 마세요.** `import(...)`로 필요할 때만 부릅니다. 정적으로 부르면 `shared/v1/sync.js` 하나를 못 받는 순간 앱 전체가 빈 화면이 됩니다.
4. **삭제 표시(`markDeleted`)는 사용자가 직접 지웠을 때만 찍습니다.** "로컬에 없으니 지워진 것"이라고 절대 추론하지 마세요. 그 추론이 2026-08-09 focus에서 데이터를 지운 원인이었습니다.

이 저장소가 직접 소유하는 `tests/*.test.mjs`를 `npm test`로 실행합니다. 현재 mode policy, model, app-shell 검사를 외부 Plan 경로 없이 재실행할 수 있습니다.
