# Grove 사용 안내

## 설치와 저장

Grove는 인터넷 없이도 동작하도록 설계된 PWA입니다. 처음 한 번 온라인으로 연 뒤 iPhone/iPad에서는 공유(Share) → 홈 화면에 추가(Add to Home Screen)로 설치하세요. Home Screen 앱과 Safari 탭은 저장소가 분리될 수 있으므로, 설치한 앱을 주 사용 환경으로 정해 사용하세요.

맵은 이 브라우저의 IndexedDB에 자동 저장됩니다. `Saved` 표시는 현재 기기에 저장되었다는 뜻일 뿐, 백업은 아닙니다.

## 편집

- Node 탭: 선택 / 선택 도구 막대의 `Edit` 또는 더블 탭: 이름 편집 / 드래그: 이동
- 다른 Node 위로 드래그해 놓기: 부모 변경 (Root는 이동 불가)
- 빈 캔버스 드래그 또는 트랙패드 스크롤: 화면 이동
- 핀치 또는 `Ctrl/⌘ + 스크롤`: 확대·축소. 오른쪽 아래 `−`/`+` 버튼으로도 단계별 조절
- Enter: 형제 추가 / Tab: 자식 추가 / Delete: 선택 Node와 하위 가지 삭제
- Read: 편집 잠금. 화면 이동, 확대·축소, 검색, 접기·펼치기는 계속 됩니다.
- 선택 Node의 `More` → `Style, memo & note`에서 Inspector를 엽니다. Memo는 짧은 일반 텍스트, Note는 Markdown을 지원하는 긴 글이며 HTML은 허용하지 않습니다.
- 선택 Node의 도구 막대에서 이름 수정, 자식 추가, 이동, Cross-link, 접기·펼치기, More 메뉴를 실행합니다. More에는 상세 편집, 순서 이동, 복제, 삭제가 있습니다.
- Outline은 전체 트리를 키보드로 탐색하는 보조 화면입니다. Search는 Node text, Memo, Note를 함께 검색합니다.
- `Fit to screen`은 현재 맵 전체를 보이게 하고 배율 표시 버튼은 선택 Node를 100%로 중앙에 둡니다.

## 읽기와 파일 미리보기

- Library의 map row `…` 메뉴에서 **View (Read Mode)**를 선택하면 저장된 맵을 편집하지 않고 Fit to screen 상태로 엽니다.
- Read Mode에서는 맵 제목, Branch spacing, node 추가·삭제·이동·편집, Undo/Redo가 차단됩니다. pan, zoom, fit, 검색, 선택, Outline, Note preview와 export만 사용할 수 있습니다.
- 단일 `grove-map` JSON을 Import하면 **Preview only / Import & View / Import & Edit**를 선택합니다. Preview only는 Library, backup, sync, 기기 view에 기록하지 않습니다. 편집하려면 확인 후 Library에 한 번 가져옵니다.
- Grove는 Grove native JSON 작성·편집·열람용입니다. HTML, standalone SVG, HTML+asset ZIP package는 [Folio](../../folio/)에서 여세요. 전체 `grove-backup`은 기존 restore 흐름을 사용하며 Preview only 대상이 아닙니다.

## 노드와 연결선 꾸미기

- Style에서 Fill, Border, Text, Shape, Font, Size, Weight, Align을 바꿉니다.
- Width/Height를 직접 바꾸면 수동 크기가 되며 `Use auto size`로 자동 크기를 다시 켤 수 있습니다.
- Parent edge에서 부모 연결선의 Color, Type, Width, Line을 설정합니다.
- Cross-link 버튼을 누른 뒤 다른 Node를 선택해 자유 연결을 추가합니다. 연결 순환은 허용되지만 자기 연결과 중복 연결은 거부됩니다.

백업·복원은 [백업·복원 안내](BACKUP-RESTORE-KO.md), 캐시와 저장 문제는 [문제 해결 안내](TROUBLESHOOTING-KO.md)를 확인하세요.

## 동기화 (Sync)

`Settings`의 `Sync`에서 켭니다. **처음에는 꺼져 있고, 꺼진 상태에서도 Grove는 전부 그대로 동작합니다.** 저장은 언제나 이 기기에 먼저 하고, 동기화는 그 위에 얹는 것입니다.

켜는 순서는 이렇습니다.

1. **Device name**을 먼저 적습니다. **영문 소문자와 숫자만** 씁니다 (예: `iphone-home`).
2. **Access token**을 붙여 넣고 `Save token`을 누릅니다.
3. `Sync with GitHub`를 켭니다.

> **기기 이름은 켜기 전에 적어야 합니다.** 이름은 켜는 순간 파일 이름으로 굳고 나중에 바꿀 수 없습니다. 비워 두고 켜면 `context-3f2a1b9c` 같은 이름이 되어 어느 기기의 기록인지 알아볼 수 없게 됩니다. 한글만 적어도 같은 결과가 됩니다.
>
> 같은 iPhone이라도 **Safari 탭과 홈 화면에 추가(Add to Home Screen)한 앱은 서로 다른 기기로 셉니다.** 각각 한 번씩 켜 주세요.

켜면 세 가지가 함께 동작합니다.

| 무엇 | 언제 | 어디에 |
|---|---|---|
| 맵 동기화 | 앱을 열 때, 그리고 저장된 뒤 4초 | 목록 1개 + 맵마다 파일 1개 |
| 호환 생성 기록 | 새 맵을 만들 때 | 보관된 Atlas·Trace 형식의 이벤트 파일에 남음 |
| 백업 | `Back up to GitHub`를 누를 때 | 최근 12개만 보관 |

### 알아 둘 것

- **맵을 지우면 다른 기기에서도 지워집니다.** 다른 앱(Focus·Loom)과 다른 점입니다. 맵은 단위가 커서 한쪽에서 지운 것이 계속 되살아나면 성가시기 때문입니다. 지우는 것은 `Delete map?` 확인을 누른 그 순간뿐이고, 앱이 알아서 "없어졌으니 지운 것"으로 판단하는 일은 없습니다.
- **아주 큰 맵은 동기화되지 않습니다.** 노드가 아주 많아 파일이 1MB를 넘으면 그 맵만 건너뛰고 이름을 알려 줍니다. 나머지 맵은 정상 동기화됩니다. 그 맵은 `Export`로 파일에 내보내 두세요.
- **테마·글자 크기 같은 표시 설정은 기기마다 따로입니다.** 백업에는 담기지만 다른 기기로 옮겨 오지는 않습니다.
- **화면 위치·확대 상태는 올라가지 않습니다.** 기기마다 화면 크기가 달라 그대로 옮기면 오히려 불편하기 때문입니다.
- 인터넷이 없으면 변경 사항이 기기에 쌓였다가 다음에 연결될 때 올라갑니다. `Sync now`로 직접 돌릴 수도 있습니다.
- `Settings` 아래쪽 **App version**이 지금 이 기기에서 실제로 돌고 있는 버전입니다. 고친 것이 반영되지 않은 것 같으면 이 값부터 확인하세요.

## Daybook Journal 활동 원장

- Journal이 꺼져 있어도 map title과 created/opened/edited/export-requested 메타데이터만 90일 로컬 보관합니다. node·memo·Markdown note는 복제하지 않습니다.
- 기존 map의 createdAt/latest updatedAt은 제한된 `inferred` 백필이고, 이 버전 이후 원장 activity는 `exact`입니다.
- Files 및 GitHub 전체 backup에 activity 원장을 optional 필드로 포함하고, 복원 시 Replace/Merge 의미를 따릅니다. **Clear captured activity**는 map과 remote Journal record를 그대로 둡니다.

---

## map 사용 세션

map을 열어 두고 5분 넘게 손을 떼었다가(idle) 다시 조작하면 새 사용 세션이 시작되어 Daybook에 반영됩니다. map을 전환하거나 라이브러리로 돌아갈 때만 세션이 완전히 종료됩니다.
