# GitHub Pages 배포 안내

1. GitHub에서 Public 저장소 `grove`를 만듭니다.
2. 이 폴더의 파일을 저장소 최상위에 올립니다. `.nojekyll`도 반드시 포함해야 합니다.
3. **Settings → Pages → Build and deployment**에서 Source를 **GitHub Actions**로 선택합니다. 이전 운영 방식은 `main`/`(root)` branch 기반 legacy Pages였습니다.
4. 표시된 Pages URL을 연 뒤 `https://<계정>.github.io/grove/` 형태의 하위 경로에서 Library, 새 맵, 아이콘이 모두 열리는지 확인합니다.
5. iPhone/iPad Safari에서 공유(Share) → 홈 화면에 추가(Add to Home Screen)를 실행해 설치합니다. 설치 후에는 Home Screen 앱을 주 사용 환경으로 정합니다.

`manifest.webmanifest`의 `start_url`과 `scope`, 모든 코드 경로는 `./` 상대 경로입니다. 따라서 저장소 이름이 `grove`일 때 GitHub Pages 하위 경로에서도 동작합니다.

## 업데이트

`main` push 시 `.github/workflows/test-and-deploy.yml`이 저장소 소유 테스트를 실행하고 성공한 경우에만 allowlist artifact를 배포합니다. `tests`, fixture, `node_modules`, package metadata는 artifact에서 제외됩니다. 새 버전을 올릴 때 `sw.js`의 `VERSION`과 `src/version.js`의 `APP_BUILD`를 함께 올리고 `APP_SHELL` 목록을 실제 런타임 파일과 일치시킵니다. 앱에 **Update available**이 보이면 `Reload`를 눌러 적용합니다. 중요한 변경 전에는 먼저 Backup을 보관하세요.

## 배포 전 확인

- 저장소 root에 `index.html`, `.nojekyll`, `sw.js`, `manifest.webmanifest`가 있는지 확인합니다.
- Pages URL에서 개발자 콘솔 오류와 404 요청이 0건인지 확인합니다.
- 새 맵을 만든 뒤 새로고침해 유지되는지 확인합니다.
- 온라인으로 한 번 연 뒤 네트워크를 끄고 다시 실행합니다.
- 실제 iPhone/iPad Home Screen 설치, 아이콘, standalone 표시를 확인합니다.

현재 운영 작업 트리는 `WebApp/Published/grove/`입니다. workflow 성공, Pages URL, live build와 asset hash를 배포 후 함께 확인합니다.
