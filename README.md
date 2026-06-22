# MathCard Personal - Capacitor APK build

개인용 문제집/오답노트 앱입니다. GitHub Actions에서 Android debug APK를 빌드합니다.

## v0.2 parser changes

PDF 파서는 아래 순서로 동작합니다.

1. PDF 텍스트 좌표를 줄 단위로 재구성합니다.
2. 문제 페이지에서는 큰 문항 번호 `1.`, `2.`, `3.` 형태만 문제 시작점으로 인식합니다.
3. 문제 시작점이 하나라도 있는 페이지에서는 해설 시작점 탐지를 완전히 건너뜁니다.
4. 해설 페이지에서는 `【1】`, `(1)`, `[1]` 후보를 모두 모은 뒤, 가장 일관적인 표지 스타일 하나를 선택합니다. 그래서 해설 본문 안의 `(1)`, `(2)` 같은 소문항 번호가 해설 카드로 잘못 잘리는 문제를 줄입니다.
5. 문항 번호가 증가하는 최적 순서를 골라 중복/오인식 후보를 제거합니다.
6. 같은 문항이 다음 단/다음 페이지로 이어지면 여러 조각을 세로로 병합합니다.
7. 문제 번호와 해설 번호가 같은 것끼리 카드로 매칭합니다.

## Build

GitHub 저장소에 파일을 올린 뒤 Actions 탭에서 **Build Android APK**를 실행하세요.

빌드 완료 후 artifact `math-card-debug-apk`를 다운로드하고 압축을 풀면 `app-debug.apk`가 있습니다.

## Local web preview

```bash
npm install
npm run dev
```
