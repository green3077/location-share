# 추억정리 (Photo Organizer)

매년 같은 날짜에 찍은 사진을 자동으로 모아서 보여주고, 그 자리에서 골라 정리(삭제)할 수 있는
안드로이드 네이티브 앱입니다.

## 주요 기능

- **홈 화면**: 갤러리 전체를 스캔해서 "몇 개 연도에 걸쳐 같은 월/일에 찍힌 사진들"만 추려
  다가오는 날짜순으로 보여줍니다. (예: 8월 25일 · 4개 연도 · 총 23장)
- **날짜 상세 화면**: 특정 날짜를 열면 연도별로 사진이 묶여서 나오고, 길게 눌러 여러 장을
  선택한 뒤 한 번에 삭제할 수 있습니다.
- **사진 뷰어**: 사진을 탭하면 같은 연도의 사진들을 옆으로 넘기며 볼 수 있고, 보면서 바로
  삭제할 수 있습니다.
- **오른쪽 위 달력 아이콘**: 아직 1개 연도밖에 없는 날짜도 직접 골라 확인할 수 있습니다.
- **정리 챌린지 알림**: 매일 오전 9시경, 오늘 날짜에 과거 사진이 있으면 "오늘의 정리 챌린지"
  알림을 보내고, 탭하면 바로 그 날짜의 정리 화면으로 이동합니다. 하루라도 정리(삭제)하면
  연속일수(스트릭)가 올라가고, 홈 화면 상단에 "🔥 N일 연속 정리 챌린지 중!"으로 표시됩니다.

## 기술 스택

- Kotlin, MediaStore(`MediaStore.Images`)로 기기 갤러리의 촬영일자(EXIF `DATE_TAKEN`)를 읽어
  연도 구분 없이 `MonthDay`(월/일) 기준으로 그룹핑
- 삭제는 Android 11+(API 30) scoped storage용 `MediaStore.createDeleteRequest`로 처리 (시스템
  확인 다이얼로그가 뜬 뒤 실제 삭제) — 그래서 `minSdk = 30`으로 설정했습니다.
- 알림은 `WorkManager`의 1일 주기 `PeriodicWorkRequest`로 예약(재부팅에도 안전)
- Coil(이미지 로딩), ViewBinding, Coroutines

## 빌드 방법

⚠️ 이 프로젝트는 **이 세션(클라우드 샌드박스) 안에서는 빌드/실행이 불가능**합니다. 안드로이드
SDK와 Google의 Maven 저장소(`dl.google.com`)에 대한 네트워크 접근이 이 환경에서 막혀 있어서,
AndroidX/AGP 의존성을 받아올 수 없기 때문입니다. (`location-share.apk`는 이 저장소가 아닌 별도
환경에서 빌드된 것으로 보입니다.)

로컬에서 빌드하려면:

1. [Android Studio](https://developer.android.com/studio) 설치 (SDK, Gradle 자동 세팅됨)
2. `photo-organizer/` 폴더를 "Open" 으로 열기
3. 첫 동기화(Gradle Sync)가 끝나면 기기/에뮬레이터에서 실행(▶) — 또는
   `Build > Generate Signed App Bundle / APK`로 APK 생성
4. 커맨드라인으로는 `./gradlew assembleDebug` (Android Studio가 최초 1회 SDK를 세팅해준 뒤 사용 가능)

## 알아두면 좋은 점

- `minSdk 30`(Android 11) 이상 기기를 대상으로 합니다. 그 이전 버전은 삭제 권한 처리 방식이
  복잡해져서(레거시 storage 예외 처리) 이번 범위에서는 제외했습니다.
- 사진 삭제는 실제로 기기에서 영구 삭제됩니다(휴지통 아님). 삭제 직전 안드로이드 시스템이
  자체 확인 다이얼로그를 띄웁니다.
