# MathCard Personal APK Source

This is a personal MathCard app source package.

It is designed for the GitHub Actions route:

1. Create a GitHub repository.
2. Upload every file in this folder to the repository root.
3. Open the Actions tab.
4. Run `Build Android APK`.
5. Download the `math-card-debug-apk` artifact.
6. Install `app-debug.apk` on your Android phone.

The app itself is a Capacitor wrapper around a local web app.
It imports PDF files on the phone, parses problem anchors such as `1.` and solution anchors such as `(1)`, `[1]`, or `【1】`, and stores cards locally with IndexedDB.

Important parser rule:
If a page contains problem anchors, solution extraction is skipped for that page.
This avoids mistaking answer references inside problem pages for solution cards.

For personal use, the debug APK is usually enough.
For Play Store release, add a release-signing workflow and build an AAB.
