# location-share (어디고?)

가족/친구끼리 실시간 위치를 공유하는 앱. 웹(GitHub Pages)과 안드로이드 APK(Capacitor)로 동작한다.

## 구조
- 루트의 `index.html` / `app.js` / `ui.js` / `style.css` : 웹앱 원본 (GitHub Pages가 그대로 서빙)
- `android/` : Capacitor 안드로이드 프로젝트. 백그라운드 위치 공유는 순수 네이티브
  `BootLocationForegroundService` + `LocationWatchdog`(정확한 알람, 3분 주기)가 담당
- `location-share.apk`, `version.json` : 앱 내 "업데이트 확인"이 읽는 배포 파일

## APK 빌드
```bash
npm ci
bash build-android-www.sh   # 루트 웹 파일 -> www/ -> android assets
npx cap sync android
cd android && ./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ../location-share.apk
```
- `app.js`의 `APP_VERSION_CODE`, `android/app/build.gradle`의 `versionCode`, `version.json`을 항상 같이 올릴 것
- 서명 키는 `android/app/debug.keystore`(저장소에 고정). 이 키가 바뀌면 기존 설치본 위에
  업데이트가 설치되지 않으니 절대 바꾸지 말 것
