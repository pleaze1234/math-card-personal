# MathCard Personal v4

개인용 문제집/오답노트 앱입니다. GitHub Actions에서 Capacitor Android debug APK를 빌드하도록 구성되어 있습니다.

## v4 변경점

- 풀이 화면 하단 탭을 고정형 조작 버튼으로 변경했습니다.
  - 문제를 보는 중: `이전 문제 / 해설보기`
  - 해설을 본 뒤: `이전 문제 / 다음 문제`
  - 사이클 풀이 중 해설을 본 뒤 `다음 문제`를 누르면 맞음/틀림 선택창이 떠서 스크롤 없이 다음 문제로 넘어갈 수 있습니다.
- 카드 상세 화면에서도 하단 탭이 `이전 문제 / 다음 문제`로 바뀝니다.
- `뒤로` 버튼으로 문제집/사이클 메인 화면에 돌아오면 하단 버튼은 다시 `문제집 / 사이클`로 돌아옵니다.
- v3 파서의 안내문 오인식 방지 로직은 유지했습니다.

## GitHub에 올리는 방법

저장소 최상단에 아래 파일/폴더가 바로 보여야 합니다.

```text
.github/
src/
package.json
capacitor.config.ts
tsconfig.json
index.html
README.md
```

ZIP 안의 폴더 자체를 저장소 안에 넣지 말고, 폴더 안 내용물을 기존 저장소에 덮어쓴 뒤 Commit/Push 하세요.

## APK 빌드

GitHub 저장소에서:

```text
Actions → Build Android APK → Run workflow
```

빌드 완료 후 artifact `math-card-debug-apk`를 받아 압축을 풀면 `app-debug.apk`가 나옵니다.

## 데이터 주의

새 APK를 설치해도 이미 잘못 잘린 기존 문제집 데이터는 자동 수정되지 않습니다. 파서 변경을 적용하려면 앱 안에서 기존 문제집을 삭제하고 PDF를 다시 넣어야 합니다.
