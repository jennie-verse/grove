# Grove 문제 해결 안내

## `Save failed`

탭을 닫지 말고 `Retry`를 먼저 누릅니다. 계속 실패하면 `Export recovery copy`로 현재 메모리 상태를 JSON으로 저장한 뒤 저장 공간과 브라우저 설정을 확인합니다. Grove는 실패 시 기존 IndexedDB를 자동 삭제하지 않습니다.

## 업데이트가 보이지 않음

앱의 `Update available`에서 `Reload`를 누릅니다. 계속 이전 화면이면 온라인 상태에서 앱을 완전히 닫고 다시 엽니다. 사이트 데이터를 지우는 것은 최후 수단이며, 실행 전 반드시 전체 JSON Backup을 보관하세요.

## 오프라인에서 처음 열리지 않음

Service Worker는 최초 온라인 방문 때 앱 shell을 저장합니다. 온라인으로 한 번 완전히 연 뒤 다시 시도하세요. `file://` 직접 실행에서는 오프라인 기능이 동작하지 않습니다.

## Safari 탭과 Home Screen 앱의 맵이 다름

두 실행 환경의 저장소가 분리될 수 있습니다. Home Screen 앱을 주 환경으로 사용하고, 다른 환경으로 옮길 때 JSON Backup/Import를 사용하세요.

## 기기 변경

기존 기기에서 `Backup`을 iCloud Drive에 저장하고 새 기기의 Grove에서 `Import` → `Merge`를 사용합니다. 자동 동기화나 로그인은 제공하지 않습니다.
