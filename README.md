# Grove

개인용 오프라인 우선 Mind Map PWA입니다. Library View, immutable Read Mode, 저장하지 않는 단일 Grove JSON Preview only, 편집, JSON 백업·복원, SVG/PNG export를 제공합니다. HTML·SVG·HTML ZIP 열람은 Folio의 역할로 분리합니다.

## 배포

1. GitHub 저장소의 **Settings → Pages**에서 Source를 **GitHub Actions**로 선택합니다.
2. `main`에 push하면 테스트 후 allowlist artifact가 배포됩니다.
3. `https://jennie-verse.github.io/grove/`에서 온라인·오프라인 실행과 build를 확인합니다.

세부 절차는 [GitHub Pages 배포 안내](docs/GITHUB-PAGES-KO.md)를 보세요.

## 사용

- Library에서 맵을 만들고 열어 편집합니다.
- Node를 한 번 탭하면 선택하고, 선택 도구 막대의 `Edit` 또는 더블 탭으로 이름을 편집합니다.
- Node를 드래그하면 위치를 바꾸며, 다른 Node 위에 놓으면 부모를 바꿉니다.
- 트랙패드 스크롤은 화면을 이동하고, 핀치 또는 `Ctrl/⌘ + 스크롤`은 확대·축소합니다.
- `Enter`는 형제, `Tab`은 자식 Node를 추가합니다. `⌘/Ctrl+Z`로 실행 취소합니다.
- 데이터는 현재 브라우저의 IndexedDB에 저장됩니다. **7일마다 Backup을 내보내 iCloud Drive 등에 보관하세요.**
- Journal을 켜면 편집 화면을 실제로 사용한 시작·종료 시각과 활성 분량을 기록하며, 90일 세션 원장은 로컬/GitHub 백업과 함께 복원됩니다.

자세한 조작은 [사용 안내](docs/USER-GUIDE-KO.md), 데이터 이동은 [백업·복원 안내](docs/BACKUP-RESTORE-KO.md), 문제 해결은 [문제 해결 안내](docs/TROUBLESHOOTING-KO.md)에 있습니다.

## 로컬 확인

정적 서버로 이 폴더를 열어 확인합니다. `file://`로 직접 열면 ES Modules와 Service Worker가 동작하지 않습니다.

Node.js 18 이상에서 저장소 소유 전체 테스트를 실행합니다.

```sh
npm test
npm run test:syntax
```

## 구성

`src/` 앱 코드 · `assets/` 스타일과 로컬 글꼴 · `icons/` PWA 아이콘 · `docs/` 한국어 안내 · `tests/` 모델 테스트 · `manifest.webmanifest` · `sw.js` · `.nojekyll`

실제 사용자 맵 데이터는 저장소에 커밋하지 마세요. 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)와 `licenses/`에 있습니다.
