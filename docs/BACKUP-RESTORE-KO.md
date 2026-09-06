# Grove 백업·복원 안내

`Saved`는 현재 브라우저에 저장되었다는 뜻이며 백업 완료를 뜻하지 않습니다. Library의 `Backup`을 7일마다 실행하고 JSON 파일을 iCloud Drive 등 앱 밖에 보관하세요.

## 파일 종류

- 단일 맵: `grove-map-<제목>-YYYY-MM-DD.json`
- 전체 백업: `grove-backup-YYYY-MM-DD.json`
- 저장 오류 복구본: `grove-recovery-<제목>-YYYY-MM-DD.json`

JSON은 위치·스타일·Memo·Note·Cross-link를 모두 보존하는 원본 형식입니다. SVG와 PNG는 보기·인쇄용이며 Grove 편집 데이터 복원용이 아닙니다.

## 단일 맵 가져오기

1. Library에서 `Import`를 누르고 `grove-map-…json`을 선택합니다.
2. 같은 map ID가 없으면 새 맵으로 추가됩니다.
3. 같은 ID가 있으면 기본값 `Keep both`를 선택합니다. 기존 맵을 바꾸려면 local/file 수정 시각을 확인한 뒤 `Replace`를 명시적으로 선택합니다.

## 전체 복원

1. Library에서 `Import`로 `grove-backup-…json`을 선택합니다.
2. `Merge`는 새 맵을 추가하고 충돌 항목을 선택한 정책으로 처리합니다.
3. `Replace all`은 현재 모든 맵을 백업 내용으로 바꿉니다. 실행 전 현재 `Backup`을 먼저 저장하고 재확인합니다.
4. `Restore app settings`는 기본 off입니다. 켜면 theme, UI text size, spacing만 가져옵니다.

손상 파일, 25MB 초과 파일, 미지원 신규 schema, 트리 순환·중복 ID 같은 무효 데이터는 저장 전에 거부됩니다. 실제 사용자 map JSON을 GitHub 저장소에 커밋하지 마세요.
