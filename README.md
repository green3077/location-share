# location-share

그룹 위치공유 웹앱(GitHub Pages) + 안드로이드 네이티브 앱(Capacitor).

## 웹 (GitHub Pages)

저장소 루트의 `index.html`/`app.js`/`style.css`/`ui.js`/`firebase-config.js`/`kakao-config.js`가
그대로 GitHub Pages로 서빙된다. 이 파일들만 고치면 웹은 바로 반영된다.

## 안드로이드 APK 빌드

처음 클론한 PC에서:

1. `npm install`
2. `android/local.properties`를 새로 만들어 이 PC의 안드로이드 SDK 경로를 지정한다
   (gitignore 대상이라 저장소에 없음): `sdk.dir=C:/path/to/Android/Sdk`
3. 루트 웹 파일을 고쳤다면 `./build-android-www.sh`로 `www/`와 `android/`의 웹 자산을 동기화한다
   (이 스크립트를 건너뛰면 gradle이 예전 웹 코드로 APK를 만들어버린다).
4. `cd android && ./gradlew assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`
5. 배포하려면 그 apk를 저장소 루트의 `location-share.apk`로 복사하고 `version.json`의
   `versionCode`/`versionName`을 올린다(app.js 상단 `APP_VERSION_CODE`/`APP_VERSION_NAME`과
   항상 같이 맞출 것 - 앱 내 업데이트 확인 로직이 이 값들을 비교한다).

`android/app/debug.keystore`는 저장소에 커밋된 고정 디버그 서명키다 - 어느 PC에서 빌드하든
같은 서명이 나와야 기기에 이미 설치된 앱 위에 새 APK를 덮어 설치(업데이트)할 수 있다. 이 키를
바꾸거나 새로 만들지 말 것.

## 네이티브 위치 공유 로직

`android/app/src/main/java/com/green3077/locationshare/`의 `BootLocationForegroundService`가
WebView/JS와 무관하게 동작하는 순수 네이티브 서비스로, 3분마다 현재 위치를, 10분마다 위치
기록(history)을 Firebase Realtime Database REST API로 직접 기록한다. 이 값들은 `app.js` 상단의
`UPDATE_INTERVAL_MS`/`LOCATION_HISTORY_INTERVAL_MS`와 항상 같이 맞춰야 한다.
