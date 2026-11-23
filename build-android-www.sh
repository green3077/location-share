#!/bin/bash
# 루트의 웹 소스 파일들을 www/로 동기화하고 android/의 실제 빌드 자산까지 반영한다.
# GitHub Pages는 이 저장소 루트를 그대로 서빙하므로, 웹 코드는 항상 루트 파일을 고쳐야 하고
# (index.html/app.js/style.css/ui.js/firebase-config.js/kakao-config.js), 이 스크립트가
# 그 결과를 www/에 복사한 뒤 'cap copy'로 android/app/src/main/assets/public까지 반영한다 -
# 이 마지막 단계를 건너뛰면 gradle이 예전 www/ 내용 그대로 APK를 만들어버린다.
set -e
cd "$(dirname "$0")"

mkdir -p www
cp index.html style.css app.js ui.js firebase-config.js kakao-config.js www/

# 앱(APK)에서는 @capacitor/core(capacitor.js)가 있어야 window.Capacitor.registerPlugin이 생긴다 -
# 안드로이드가 주입하는 native-bridge.js에는 registerPlugin이 없다. 이게 빠지면 네이티브 기능
# (위치 공유 서비스 시작 등)을 하나도 못 불러서 내 위치가 아예 안 올라간다(v1.17~1.19의 실제 원인).
# 웹(GitHub Pages)용 루트 index.html에는 넣지 않고, APK용 www/index.html에만 주입한다.
cp node_modules/@capacitor/core/dist/capacitor.js www/
python3 - <<'PY'
p = "www/index.html"
s = open(p, encoding="utf-8").read()
tag = '<script src="capacitor.js"></script>'
if tag not in s:
    s = s.replace('<script src="firebase-config.js"></script>', tag + '\n<script src="firebase-config.js"></script>', 1)
    assert tag in s, "capacitor.js 삽입 위치를 찾지 못했습니다"
open(p, "w", encoding="utf-8").write(s)
PY

npx cap copy android

echo "www/ synced for Android build, and copied into android/app/src/main/assets/public via 'cap copy'."
