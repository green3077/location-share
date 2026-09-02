// 이 파일 어디선가 예외가 조용히 나면(특히 네이티브 전용 코드) 그 아래 코드가 전혀 실행되지
// 않아 화면의 모든 버튼이 이유 없이 먹통이 된다("눌러도 반응 없음" - 실제로 있었던 문제).
// 그런 침묵 실패를 눈에 보이는 토스트로 바꿔서 다음엔 바로 원인을 알 수 있게 한다.
window.addEventListener("error", (e) => {
  try {
    const box = document.getElementById("toast-container");
    if (!box) return;
    const el = document.createElement("div");
    el.className = "toast show";
    el.style.background = "#c62828";
    el.textContent = "오류: " + (e.message || e.error || "알 수 없음");
    box.appendChild(el);
  } catch (ignored) {}
});

const APP_VERSION_CODE = 17; // android/app/build.gradle의 versionCode와 항상 같이 올릴 것
const APP_VERSION_NAME = "1.16";
const UPDATE_MANIFEST_URL = "https://green3077.github.io/location-share/version.json";

const GATE_KEY = "ls_gate_v1";
const ACCESS_ID = "6003";
const ACCESS_PASSWORD = "6003";
const CONSENT_KEY = "ls_consent_v1";
const PROFILE_KEY = "ls_profile_v1";
const UPDATE_INTERVAL_MS = 3 * 60 * 1000; // 3분마다 위치 갱신 (웹: 탭이 열려있을 때만. 네이티브: BootLocationForegroundService가 같은 3분 간격을 쓴다 - android/.../BootLocationForegroundService.java의 UPDATE_INTERVAL_MS와 항상 같이 맞출 것)
// 네이티브 앱은 이제(2026-08-17) 순수 네이티브 포그라운드 서비스가 "움직임과 무관하게" 이 간격대로
// 계속 위치를 보고한다(예전의 distanceFilter 기반 워처와 달리 - 그래서 안 움직여도 신호가 안 끊긴다).
// 그래도 GPS 확보 지연/일시적 네트워크 문제를 감안해 갱신 주기의 3배 정도 여유를 둔다.
const STALE_MS = UPDATE_INTERVAL_MS * 3; // 9분

const CONNECTION_LOG_INTERVAL_MS = 10 * 60 * 1000; // 10분마다 친구별 신호 수신 상태 기록
const CONNECTION_LOG_KEY = "ls_connection_log_v1";
const CONNECTION_LOG_MAX_ENTRIES = 300; // 기기 저장공간 보호용 상한 (오래된 기록부터 삭제)

// 참여자 전원의 위치를 10분 간격으로 그룹 서버의 history 노드에 자동으로 남긴다 (설정 토글 없이
// 항상 켜짐 - 안 움직여서 같은 자리에 있어도 시간이 지나면 그대로 다시 기록됨, 거리 기반이 아니라
// 순수 시간 기반이라 정지 상태에서도 끊기지 않는다). 네이티브 앱에서는
// BootLocationForegroundService.java가 같은 간격으로 별도 구현한다 (JS가 아예 실행되지 않는
// 백그라운드 상태에서도 기록되어야 하므로) - 두 값을 항상 같이 맞출 것.
const LOCATION_HISTORY_INTERVAL_MS = 10 * 60 * 1000;
const LOCATION_HISTORY_LAST_WRITE_KEY = "ls_history_last_write_v1"; // 웹 전용 스로틀 기준 (네이티브는 SharedPreferences에 별도 보관)
const LOCATION_HISTORY_MAX_ENTRIES = 500; // 기록 화면에 보여줄 최근 개수 (약 3일치)

// 네이티브 앱(APK)에서는 순수 네이티브 포그라운드 서비스(BootLocationForegroundService)가 화면이
// 꺼지거나 다른 앱으로 전환해도, 심지어 안드로이드가 앱 프로세스를 죽여도(START_STICKY로 스스로
// 재시작) 계속 위치를 공유한다 - syncNativeProfile()이 그 서비스를 시작/정지시키는 유일한 통로다.
// 순수 웹(GitHub Pages 등)에서는 이런 네이티브 서비스가 없으므로 브라우저 탭이 열려있는 동안만
// setInterval로 주기 갱신하는 기존 방식을 그대로 쓴다.
const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
// registerPlugin() 하나가 던지는 예외 때문에 이 파일 전체(버튼 바인딩 포함)가 멈추면 안 되므로
// 각각 개별적으로 감싼다.
function safeRegisterPlugin(name) {
  if (!IS_NATIVE) return null;
  try {
    return window.Capacitor.registerPlugin(name);
  } catch (e) {
    console.warn("registerPlugin failed: " + name, e);
    return null;
  }
}
const LocalNotifications = safeRegisterPlugin("LocalNotifications");
const NativeProfileBridge = safeRegisterPlugin("NativeProfileBridge");
const UpdateBridge = safeRegisterPlugin("UpdateBridge");
const BatteryOptimizationBridge = safeRegisterPlugin("BatteryOptimizationBridge");
const AutoStartBridge = safeRegisterPlugin("AutoStartBridge");
const BATTERY_OPT_ASKED_KEY = "ls_battery_opt_asked_v1";

const MAP_PROVIDER_KEY = "ls_map_provider_v1";
function getMapProvider() {
  return localStorage.getItem(MAP_PROVIDER_KEY) || "osm";
}
function setMapProvider(p) {
  localStorage.setItem(MAP_PROVIDER_KEY, p);
}

let db = null;
let map = null; // Leaflet map (오픈맵을 선택했을 때만 사용)
let markers = {}; // memberId -> L.marker
let kakaoMap = null; // kakao.maps.Map (카카오맵을 선택했을 때만 사용)
let kakaoMarkers = {}; // memberId -> { marker, overlay }
let mapHasFitOnce = false;
let membersRef = null;
let myRequestRef = null;
// 그룹을 바꿀 때마다 하나씩 올라간다 - 그룹 전환 직전에 이미 날아가 있던 비동기 요청(웹소켓
// 리스너의 뒤늦은 콜백, REST fetch의 뒤늦은 응답 등)이 나중에 도착해도, 그 요청이 시작될 때
// 캡처해둔 세대 번호가 지금 세대와 다르면 결과를 버린다 - "다른 그룹 갔다가 돌아오면 예전
// 사람이 유령처럼 겹쳐 보이는" 문제의 실제 원인(마커를 지운 직후에 옛 그룹 데이터가 뒤늦게
// 도착해 다시 그려짐)을 근본적으로 막는다.
let groupListenGeneration = 0;
let lastHandledLocationRequestAt = "__unset__";
let locationRequestPollIntervalId = null;
let shareIntervalId = null;
let profile = null;
let listRefreshIntervalId = null;
let connectionLogIntervalId = null;
let selectedMemberId = null;
let selectedMemberCheckStartUpdatedAt = null;
let lastConnectionLogAt = 0;
let awaitingLocationResponseFor = null;
let activeRequestPollTimer = null;

function $(sel) { return document.querySelector(sel); }

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  $("#" + id).classList.remove("hidden");
  // #map은 다른 화면(설정 등)이 떠 있는 동안 display:none으로 숨겨지는데, 그 사이
  // Leaflet/카카오맵이 컨테이너 크기 변화를 못 감지해서 다시 보일 때 지도가 잘려 보이는
  // 문제가 있다. display:none이 풀려 실제 레이아웃이 잡힌 다음 프레임에 크기를 다시
  // 계산시켜준다.
  if (id === "screen-main") {
    requestAnimationFrame(() => {
      if (map) map.invalidateSize();
      if (kakaoMap) kakaoMap.relayout();
    });
  }
}

// ---------- 화면 이동 기록 (안드로이드 하드웨어 뒤로가기 버튼용) ----------
// 예전에는 history.pushState/popstate(웹뷰 자체 히스토리)에 의존했는데, 안드로이드
// WebView가 SPA의 pushState를 canGoBack()/goBack()에 항상 안정적으로 반영해주는 것이
// 아니라서 실제 기기에서 하드웨어 뒤로가기를 누르면 곧바로 앱이 종료되는 문제가 있었다.
// 그래서 웹뷰 히스토리에 전혀 기대지 않고, 화면 이동 스택을 순수 JS 배열로 직접 관리한다.
// MainActivity.onBackPressed()가 하드웨어 뒤로가기 시 window.handleHardwareBack()을
// 직접 호출해서 결과(true=이 화면에서 처리함 / false=더 돌아갈 화면 없음, 앱 종료)를 받는다.
let screenStack = [];

function pushScreen(id) {
  screenStack.push(id);
  showScreen(id);
}

// 이 화면을 스택의 새 바닥으로 만든다 (여기서 뒤로가기를 누르면 곧장 앱 종료) - 로그인/
// 동의/설정 같은 온보딩을 마치고 메인 화면에 진입하는 것처럼, 이전 단계로 돌아갈 필요가
// 없어진 시점에 쓴다.
function resetScreenStack(id) {
  screenStack = [id];
  showScreen(id);
}

function goBackScreen() {
  if (screenStack.length <= 1) return;
  screenStack.pop();
  showScreen(screenStack[screenStack.length - 1]);
}

window.handleHardwareBack = function () {
  if (screenStack.length <= 1) return false;
  goBackScreen();
  return true;
};

function getGatePassed() {
  return localStorage.getItem(GATE_KEY) === "1";
}
function setGatePassed() {
  localStorage.setItem(GATE_KEY, "1");
}

function getConsent() {
  return localStorage.getItem(CONSENT_KEY) === "1";
}
function setConsent() {
  localStorage.setItem(CONSENT_KEY, "1");
}

function getProfile() {
  const raw = localStorage.getItem(PROFILE_KEY);
  return raw ? JSON.parse(raw) : null;
}
function saveProfile(p) {
  profile = p;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  syncNativeProfile();
}

// 재부팅 직후 BootReceiver(순수 네이티브, WebView 없음)가 이 값을 읽어 공유를 자동 재개할 수 있도록
// SharedPreferences에 그대로 미러링한다. localStorage는 그 시점에 접근 불가능하므로 별도 통로가 필요하다.
// saveProfile()과 startSharingLoop() 양쪽 모두 상태가 바뀔 때마다 이 함수를 부르는데, 토글
// 한 번에 두 곳에서 연달아(같은 tick에 동기적으로) 호출되는 경우가 있다(예: sharingToggle
// change 핸들러가 saveProfile()->startSharingLoop() 순으로 호출, 앱 시작 시 startApp()도
// 동일). NativeProfileBridge.save()가 내부적으로 안드로이드 권한 다이얼로그를 띄우는데,
// 이 요청이 응답을 받기 전에 똑같은 내용으로 또 호출되면 Capacitor 쪽에서 두 호출이 서로의
// 콜백을 밀어내며 권한 요청 자체가 영영 응답을 못 받는 문제가 있었다(공유를 켜도 서비스가
// 시작되지 않아 본인 포함 전원이 "신호 없음"으로 보이던 실제 원인). 직전과 완전히 같은
// 내용이면 다시 호출하지 않는다.
let lastSyncedProfileJSON = null;
function syncNativeProfile() {
  if (!IS_NATIVE || !NativeProfileBridge || !profile) return;
  const wasSharing = !!profile.sharingEnabled;
  const payload = {
    sharingEnabled: wasSharing,
    memberId: profile.memberId,
    name: profile.name,
    groupCode: profile.groupCode,
    databaseURL: firebaseConfig.databaseURL,
  };
  const payloadJSON = JSON.stringify(payload);
  if (payloadJSON === lastSyncedProfileJSON) return;
  lastSyncedProfileJSON = payloadJSON;
  NativeProfileBridge.save(payload).catch((e) => {
    console.warn("syncNativeProfile failed", e);
    lastSyncedProfileJSON = null; // 실패했으니 다음 시도는 막지 않는다
    // 예전엔 여기서 조용히 무시해서, 위치 권한을 거부해도 사용자는 "공유 켜짐" 토글만 보고
    // 실제로는 아무것도 공유되지 않는 걸 몰랐다(친구들이 전부 "신호 없음"으로 보이던 원인).
    if (wasSharing) {
      toast("위치 공유를 시작하지 못했습니다 - 위치 권한을 허용했는지 확인해주세요.");
      profile.sharingEnabled = false;
      saveProfile(profile);
      if ($("#sharingToggle")) $("#sharingToggle").checked = false;
    }
  });
}

function generateMemberId() {
  return "m_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function formatRelativeTime(ts) {
  if (!ts) return "위치 없음";
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return "방금 전";
  if (diffSec < 3600) return Math.floor(diffSec / 60) + "분 전";
  if (diffSec < 86400) return Math.floor(diffSec / 3600) + "시간 전";
  return Math.floor(diffSec / 86400) + "일 전";
}

// ---------- 초기화 ----------

function init() {
  // 버튼 클릭 바인딩은 아래 firebase 초기화가 실패하더라도(네트워크 문제 등) 항상 먼저
  // 끝나야 한다 - 순서가 바뀌어 있으면 firebase 쪽에서 던진 예외 하나 때문에 로그인
  // 화면을 포함한 모든 버튼이 조용히 죽어버린다(눌러도 아무 반응 없음 - 실제로 있었던 문제).
  bindStaticHandlers();

  if (!firebaseConfig.apiKey) {
    resetScreenStack("screen-no-config");
    return;
  }
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
  } catch (e) {
    console.warn("firebase init failed", e);
    toast("초기화에 실패했습니다: " + (e && e.message ? e.message : e));
    return;
  }

  if (!getGatePassed()) {
    resetScreenStack("screen-login");
    return;
  }
  proceedAfterGate();
}

// 접속 화면(공용 아이디/비밀번호) 통과 후 항상 이 경로를 거친다.
function proceedAfterGate() {
  if (!getConsent()) {
    pushScreen("screen-consent");
    return;
  }
  profile = getProfile();
  if (!profile) {
    pushScreen("screen-setup");
    return;
  }
  resetScreenStack("screen-main");
  startApp();
}

function bindStaticHandlers() {
  $("#btnLoginSubmit").addEventListener("click", () => {
    const id = $("#loginId").value.trim();
    const password = $("#loginPassword").value;
    if (id !== ACCESS_ID || password !== ACCESS_PASSWORD) {
      toast("아이디 또는 비밀번호가 올바르지 않습니다.");
      return;
    }
    setGatePassed();
    proceedAfterGate();
  });

  $("#consentCheckbox").addEventListener("change", (e) => {
    $("#btnConsent").disabled = !e.target.checked;
  });
  $("#btnConsent").addEventListener("click", () => {
    setConsent();
    pushScreen("screen-setup");
  });

  $("#btnSetupSave").addEventListener("click", () => {
    const name = $("#setupName").value.trim();
    const groupCode = $("#setupGroupCode").value.trim();
    if (!name || !groupCode) {
      toast("이름과 그룹 코드를 모두 입력해주세요.");
      return;
    }
    saveProfile({
      memberId: generateMemberId(),
      name,
      groupCode,
      sharingEnabled: true,
    });
    resetScreenStack("screen-main");
    startApp();
  });

  $("#btnSettings").addEventListener("click", () => {
    $("#settingsName").value = profile.name;
    $("#settingsGroupCode").value = profile.groupCode;
    $("#sharingToggle").checked = profile.sharingEnabled;
    $("#mapProviderSelect").value = getMapProvider();
    if (IS_NATIVE) {
      $("#updateCard").classList.remove("hidden");
      $("#appVersionText").textContent = "현재 버전: " + APP_VERSION_NAME;
      refreshBatteryCard();
      $("#autoStartCard").classList.remove("hidden");
    }
    pushScreen("screen-settings");
  });
  $("#btnSettingsBack").addEventListener("click", goBackScreen);

  $("#btnCheckUpdate").addEventListener("click", checkForUpdate);
  $("#btnBatteryOptExempt").addEventListener("click", async () => {
    try {
      await BatteryOptimizationBridge.requestExemption();
    } catch (e) {
      console.warn("requestExemption failed", e);
    }
  });
  $("#btnAutoStartSettings").addEventListener("click", async () => {
    try {
      await AutoStartBridge.openAutoStartSettings();
    } catch (e) {
      console.warn("openAutoStartSettings failed", e);
    }
  });

  $("#mapProviderSelect").addEventListener("change", (e) => {
    if (e.target.value === "kakao" && !KAKAO_APP_KEY) {
      toast("카카오맵 키가 아직 설정되지 않았습니다.");
      e.target.value = "osm";
      return;
    }
    setMapProvider(e.target.value);
    toast("지도를 변경합니다...");
    setTimeout(() => location.reload(), 500);
  });

  $("#sharingToggle").addEventListener("change", (e) => {
    profile.sharingEnabled = e.target.checked;
    saveProfile(profile);
    if (profile.sharingEnabled) {
      startSharingLoop();
      toast("위치 공유를 시작합니다.");
    } else {
      stopSharingLoop();
      removeOwnLocation();
      toast("위치 공유를 껐습니다.");
    }
  });

  $("#btnSettingsSave").addEventListener("click", async () => {
    const name = $("#settingsName").value.trim();
    const groupCode = $("#settingsGroupCode").value.trim();
    if (!name || !groupCode) {
      toast("이름과 그룹 코드를 모두 입력해주세요.");
      return;
    }
    const groupChanged = groupCode !== profile.groupCode;
    if (groupChanged) {
      const ok = await confirmDialog("그룹 코드를 변경하면 기존 그룹에서는 더 이상 보이지 않습니다. 계속할까요?");
      if (!ok) return;
      removeOwnLocation();
      stopListening();
    }
    profile.name = name;
    profile.groupCode = groupCode;
    saveProfile(profile);
    $("#groupCodeDisplay").textContent = profile.groupCode;
    if (groupChanged) {
      // markers/kakaoMarkers를 그냥 {}로 비우면 레지스트리만 지워질 뿐 지도 위 마커
      // 레이어는 그대로 남아 고아가 된다 - 나중에 같은 그룹으로 돌아오면 새 마커가
      // 또 생겨서 같은 사람이 두 개로 겹쳐 보이는 원인이었다. removeMarker로 실제
      // 레이어까지 지운 뒤 레지스트리를 비운다.
      Object.keys(kakaoMap ? kakaoMarkers : markers).forEach(removeMarker);
      mapHasFitOnce = false; // 새 그룹 멤버들의 위치에 맞춰 지도가 다시 자동으로 맞춰지도록
      startListening();
    }
    toast("저장되었습니다.");
    goBackScreen();
  });

  $("#groupCodeDisplay").addEventListener("click", () => {
    navigator.clipboard.writeText(profile.groupCode).then(() => toast("그룹 코드를 복사했습니다."));
  });

  $("#btnConnectionLog").addEventListener("click", () => {
    renderConnectionLog();
    pushScreen("screen-connection-log");
  });
  $("#btnConnectionLogBack").addEventListener("click", goBackScreen);
  $("#btnConnectionLogClear").addEventListener("click", async () => {
    const ok = await confirmDialog("연결 기록을 모두 삭제할까요?");
    if (!ok) return;
    localStorage.removeItem(CONNECTION_LOG_KEY);
    renderConnectionLog();
    toast("연결 기록을 삭제했습니다.");
  });

  $("#btnCloseAddressBox").addEventListener("click", () => {
    selectedMemberId = null;
    selectedMemberCheckStartUpdatedAt = null;
    $("#selectedAddressBox").classList.add("hidden");
  });

  $("#btnViewLocationHistory").addEventListener("click", () => {
    if (!selectedMemberId) return;
    const m = lastMembersData[selectedMemberId];
    openLocationHistory(selectedMemberId, (m && m.name) || "친구", selectedMemberId === profile.memberId);
  });
  $("#btnLocationHistoryBack").addEventListener("click", goBackScreen);
  $("#btnLocationHistoryClear").addEventListener("click", async () => {
    if (!selectedMemberId || selectedMemberId !== profile.memberId) return;
    const ok = await confirmDialog("내 위치 기록을 모두 삭제할까요?");
    if (!ok) return;
    db.ref(`groups/${profile.groupCode}/members/${profile.memberId}/history`).remove();
    $("#locationHistoryList").innerHTML = `<p class="hint-text">아직 기록이 없습니다.</p>`;
    toast("위치 기록을 삭제했습니다.");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      maybeLogConnectionStatuses(false);
      refreshOnForeground();
    }
  });
}

function startApp() {
  syncNativeProfile(); // 기존 설치본(이 필드가 생기기 전)도 네이티브 저장소에 반영
  requestNotificationPermission();
  maybeRequestBatteryOptimizationExemption();
  $("#groupCodeDisplay").textContent = profile.groupCode;
  initMap(() => {
    startListening();
    if (profile.sharingEnabled) startSharingLoop();
  });

  if (listRefreshIntervalId) clearInterval(listRefreshIntervalId);
  listRefreshIntervalId = setInterval(renderMemberListTimesOnly, 30000);

  startConnectionLogging();
}

// ---------- 지도 (오픈맵/카카오맵 중 설정 화면에서 고른 것을 사용) ----------

function initMap(onReady) {
  if (map || kakaoMap) {
    onReady && onReady();
    return;
  }
  if (getMapProvider() === "kakao") {
    if (!KAKAO_APP_KEY) {
      toast("카카오맵 키가 설정되지 않아 오픈맵으로 표시합니다.");
      setMapProvider("osm");
      initLeafletMap();
      onReady && onReady();
      return;
    }
    initKakaoMap(onReady);
  } else {
    initLeafletMap();
    onReady && onReady();
  }
}

function initLeafletMap() {
  map = L.map("map").setView([36.5, 127.8], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);
}

// 카카오맵 SDK는 앱키가 URL 쿼리스트링에 들어가야 하므로(kakao-config.js에서 런타임에 읽음)
// index.html에 정적으로 넣지 못하고, 카카오맵을 실제로 선택했을 때만 동적으로 스크립트를 삽입한다.
function loadKakaoSdk(callback) {
  if (window.kakao && window.kakao.maps) {
    callback();
    return;
  }
  const script = document.createElement("script");
  script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_APP_KEY}&autoload=false&libraries=services`;
  script.onload = () => window.kakao.maps.load(callback);
  script.onerror = () => {
    toast("카카오맵을 불러오지 못했습니다. 오픈맵으로 대신 표시합니다.");
    setMapProvider("osm");
    initLeafletMap();
  };
  document.head.appendChild(script);
}

function initKakaoMap(onReady) {
  loadKakaoSdk(() => {
    kakaoMap = new kakao.maps.Map($("#map"), {
      center: new kakao.maps.LatLng(36.5, 127.8),
      level: 13,
    });
    onReady && onReady();
  });
}

function upsertMarker(memberId, name, lat, lng, isSelf) {
  if (kakaoMap) {
    upsertKakaoMarker(memberId, name, lat, lng, isSelf);
  } else if (map) {
    upsertLeafletMarker(memberId, name, lat, lng, isSelf);
  }
}

function upsertLeafletMarker(memberId, name, lat, lng, isSelf) {
  if (markers[memberId]) {
    markers[memberId].setLatLng([lat, lng]);
  } else {
    const icon = L.divIcon({
      className: "member-marker" + (isSelf ? " member-marker-self" : ""),
      html: `<div class="marker-dot"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    markers[memberId] = L.marker([lat, lng], { icon })
      .bindTooltip((isSelf ? "나 (" + name + ")" : name), { permanent: true, direction: "top", offset: [0, -10] })
      .addTo(map);
  }
}

function upsertKakaoMarker(memberId, name, lat, lng, isSelf) {
  const pos = new kakao.maps.LatLng(lat, lng);
  if (kakaoMarkers[memberId]) {
    kakaoMarkers[memberId].marker.setPosition(pos);
    kakaoMarkers[memberId].overlay.setPosition(pos);
    return;
  }
  const marker = new kakao.maps.Marker({ position: pos, map: kakaoMap });
  const label = document.createElement("div");
  label.className = "kakao-marker-label" + (isSelf ? " kakao-marker-label-self" : "");
  label.textContent = isSelf ? "나 (" + name + ")" : name;
  const overlay = new kakao.maps.CustomOverlay({
    position: pos,
    content: label,
    yAnchor: 2.2,
  });
  overlay.setMap(kakaoMap);
  kakaoMarkers[memberId] = { marker, overlay };
}

function focusMember(lat, lng) {
  if (kakaoMap) {
    kakaoMap.setLevel(Math.min(kakaoMap.getLevel(), 4)); // 카카오맵 level은 낮을수록 확대
    kakaoMap.panTo(new kakao.maps.LatLng(lat, lng));
    return;
  }
  if (!map) return;
  map.flyTo([lat, lng], Math.max(map.getZoom(), 16), { animate: true });
}

// 참여자 이름을 누르면 (회색으로 오프라인 표시 중이더라도) 곧바로 상세 패널을 띄운다.
// membersRef.on("value")는 그룹 내 누구든 위치를 쓰는 순간 실시간으로 다시 호출되므로,
// 별도의 개별 리스너 없이 renderMembers가 돌 때마다 renderConnectionCheck를 갱신해주면
// 그 자체로 "지금 이 사람 신호가 실제로 살아있는지"를 실시간으로 보여줄 수 있다.
function selectMember(memberId, m) {
  selectedMemberId = memberId;
  selectedMemberCheckStartUpdatedAt = m.updatedAt || null;
  const hasLocation = typeof m.lat === "number" && typeof m.lng === "number";
  const isStale = !m.updatedAt || Date.now() - m.updatedAt > STALE_MS;
  $("#selectedAddressBox").classList.remove("hidden");
  $("#selectedAddressTitle").textContent = m.name + "님 위치";
  $("#btnViewLocationHistory").classList.remove("hidden");
  if (hasLocation) {
    focusMember(m.lat, m.lng);
    if (isStale) {
      // 오프라인 상태에서는 주소를 이 칸이 아니라 아래 연결 확인 박스에 "마지막으로 신호
      // 받은 위치"로 시각과 함께 합쳐서 보여준다 (renderConnectionCheck에서 처리).
      $("#selectedAddressText").textContent = "";
    } else {
      showMemberAddress(m.name, m.lat, m.lng);
    }
  } else {
    $("#selectedAddressText").textContent = "아직 수신된 위치가 없습니다.";
  }
  if (memberId !== profile.memberId && isStale) {
    // 회색(오프라인)인 친구는 "요청을 보내고 기다리는" 느낌 대신, 누르는 즉시 위치를 받아오는
    // 중이라는 걸 보여주고 응답이 오면 곧바로 초록색으로 바뀌도록 능동적으로 짧은 간격으로
    // 다시 확인한다(startAwaitingFreshLocation).
    startAwaitingFreshLocation(memberId, m.name, m.updatedAt || 0);
  } else {
    renderConnectionCheck(m);
    // 실시간 리스너(웹소켓)가 백그라운드 중 조용히 끊긴 채로 있으면 화면에는 회색으로만
    // 보일 뿐 자동으로는 복구되지 않을 수 있다. 이름을 누른 시점에 REST로 한 번 더 확인해서,
    // 실제로는 신호가 살아있다면 곧바로 초록색으로 갱신한다.
    forceRefreshMember(memberId);
  }
}

const LOCATION_REQUEST_POLL_MS = 3000; // 요청을 보낸 뒤 이 간격으로 응답이 왔는지 확인
const LOCATION_REQUEST_TIMEOUT_MS = 30000; // 이 시간 안에 응답이 없으면 포기하고 평소 상태 표시로 되돌아감

function stopAwaitingFreshLocation() {
  if (activeRequestPollTimer) {
    clearTimeout(activeRequestPollTimer);
    activeRequestPollTimer = null;
  }
  awaitingLocationResponseFor = null;
}

// 회색(오프라인)인 친구 이름을 누르면 "요청을 보냈다"는 안내로 끝내지 않고, 응답이 올 때까지
// 능동적으로 짧은 간격(3초)으로 다시 확인해서 받아오는 즉시 초록색으로 바꿔준다. 친구의
// Firebase 항목에 위치 요청 플래그를 남기는 것 자체는 그대로 필요하다(친구 기기가 실제로
// 새 위치를 보고하게 만드는 유일한 통로) - 이 함수는 그 응답을 최대한 빨리 붙잡아오는 역할.
function startAwaitingFreshLocation(memberId, name, baselineUpdatedAt) {
  stopAwaitingFreshLocation();
  awaitingLocationResponseFor = memberId;
  const box = $("#connectionCheckStatus");
  box.classList.remove("hidden", "connection-ok", "connection-lost");
  box.classList.add("connection-pending");
  box.textContent = `🔄 ${name}님 위치를 받아오는 중...`;

  if (profile && firebaseConfig.databaseURL) {
    const url = `${firebaseConfig.databaseURL}/groups/${encodeURIComponent(profile.groupCode)}/members/${encodeURIComponent(memberId)}.json`;
    fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationRequestedAt: { ".sv": "timestamp" },
        locationRequestedByName: profile.name,
      }),
    }).catch((e) => console.warn("location request flag failed", e));
  }

  pollAwaitingFreshLocation(memberId, baselineUpdatedAt, Date.now() + LOCATION_REQUEST_TIMEOUT_MS);
}

async function pollAwaitingFreshLocation(memberId, baselineUpdatedAt, deadline) {
  if (selectedMemberId !== memberId || awaitingLocationResponseFor !== memberId) return; // 그 사이 다른 화면/멤버로 이동함
  const myGeneration = groupListenGeneration;
  try {
    const url = `${firebaseConfig.databaseURL}/groups/${encodeURIComponent(profile.groupCode)}/members/${encodeURIComponent(memberId)}.json?t=${Date.now()}`;
    const res = await fetch(url);
    const data = await res.json();
    if (myGeneration !== groupListenGeneration) return; // 응답 오는 사이 그룹이 바뀌었으면 버린다
    if (data) {
      lastMembersData = { ...lastMembersData, [memberId]: data };
      if (data.updatedAt && data.updatedAt > baselineUpdatedAt) {
        // 응답 도착 - 대기 상태를 풀어주면 renderMembers가 평소대로 초록색 + 연결 확인 문구를 그려준다.
        awaitingLocationResponseFor = null;
        renderMembers(lastMembersData);
        return;
      }
    }
  } catch (e) {
    console.warn("pollAwaitingFreshLocation failed", e);
  }

  if (selectedMemberId !== memberId || awaitingLocationResponseFor !== memberId) return;
  if (Date.now() >= deadline) {
    awaitingLocationResponseFor = null;
    renderMembers(lastMembersData); // 평소의 회색/빨강 상태 문구로 되돌아감
    toast(`${lastMembersData[memberId]?.name || "친구"}님이 응답하지 않았습니다. 친구가 앱을 열면 자동으로 갱신됩니다.`);
    return;
  }
  activeRequestPollTimer = setTimeout(
    () => pollAwaitingFreshLocation(memberId, baselineUpdatedAt, deadline),
    LOCATION_REQUEST_POLL_MS
  );
}

// 특정 멤버 한 명의 최신 상태만 Realtime Database REST API로 즉시 조회해서 반영한다.
// (membersRef.on("value") 리스너와 별개의 통로 - 그 리스너가 백그라운드 중 멈춰있어도
// 이 요청은 일반 fetch라서 영향받지 않는다.)
async function forceRefreshMember(memberId) {
  if (!profile || !firebaseConfig.databaseURL) return;
  const myGeneration = groupListenGeneration;
  try {
    const url = `${firebaseConfig.databaseURL}/groups/${encodeURIComponent(profile.groupCode)}/members/${encodeURIComponent(memberId)}.json?t=${Date.now()}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data) return;
    if (myGeneration !== groupListenGeneration) return; // 응답 오는 사이 그룹이 바뀌었으면 버린다
    lastMembersData = { ...lastMembersData, [memberId]: data };
    renderMembers(lastMembersData);
  } catch (e) {
    console.warn("forceRefreshMember failed", e);
  }
}

function renderConnectionCheck(m) {
  const box = $("#connectionCheckStatus");
  box.classList.remove("hidden", "connection-ok", "connection-lost");
  const isStale = !m.updatedAt || Date.now() - m.updatedAt > STALE_MS;
  const gotFresherSinceOpen =
    selectedMemberCheckStartUpdatedAt != null && m.updatedAt && m.updatedAt > selectedMemberCheckStartUpdatedAt;
  if (!isStale) {
    box.classList.add("connection-ok");
    box.textContent = gotFresherSinceOpen
      ? "🟢 방금 새 신호를 수신했습니다. 실시간 연결이 정상입니다."
      : "🟢 실시간 연결이 정상입니다.";
    return;
  }
  box.classList.add("connection-lost");
  const minutesSince = m.updatedAt ? Math.floor((Date.now() - m.updatedAt) / 60000) : null;
  const timeText = minutesSince != null ? minutesSince + "분 전" : "기록 없음";
  box.textContent = "🔴 신호 없음 (마지막 갱신: " + timeText + "). 새 신호가 오면 이 화면이 자동으로 갱신됩니다.";
  if (typeof m.lat !== "number" || typeof m.lng !== "number") return;
  // 주소는 역지오코딩이 필요해 바로 못 채우므로, 시간 정보를 먼저 보여준 뒤 주소가
  // 도착하면 "마지막으로 신호 받은 위치"로 합쳐서 보여준다.
  const checkedMemberId = selectedMemberId;
  reverseGeocodeCached(m.lat, m.lng).then((address) => {
    // 그 사이 다른 사람을 선택했거나 온라인으로 바뀌었으면 늦게 도착한 결과를 반영하지 않는다.
    if (selectedMemberId !== checkedMemberId || !box.classList.contains("connection-lost")) return;
    box.textContent =
      "🔴 신호 없음 (마지막 갱신: " +
      timeText +
      ")\n마지막으로 신호 받은 위치: " +
      (address || "주소를 찾을 수 없습니다.");
  });
}

// 이름 클릭 시 지도 이동과 별개로, 해당 위치의 사람이 읽을 수 있는 주소도 함께 보여준다.
async function showMemberAddress(name, lat, lng) {
  const box = $("#selectedAddressBox");
  $("#selectedAddressTitle").textContent = name + "님 위치";
  $("#selectedAddressText").textContent = "주소를 불러오는 중...";
  box.classList.remove("hidden");
  const address = await reverseGeocode(lat, lng);
  // 그 사이에 다른 이름을 눌러 제목이 바뀌었다면 늦게 도착한 결과를 덮어쓰지 않는다.
  if ($("#selectedAddressTitle").textContent !== name + "님 위치") return;
  $("#selectedAddressText").textContent = address || "주소를 찾을 수 없습니다.";
}

// 카카오맵을 쓰는 중이면 카카오의 좌표->주소 변환(Geocoder)을, 오픈맵이면 무료 공개 서비스인
// Nominatim(OpenStreetMap)의 역지오코딩 API를 사용한다 - 둘 다 별도 결제 없이 쓸 수 있다.
function reverseGeocode(lat, lng) {
  if (kakaoMap && window.kakao && kakao.maps.services) {
    return new Promise((resolve) => {
      const geocoder = new kakao.maps.services.Geocoder();
      geocoder.coord2Address(lng, lat, (result, status) => {
        if (status === kakao.maps.services.Status.OK && result[0]) {
          const road = result[0].road_address;
          const jibun = result[0].address;
          resolve((road && road.address_name) || (jibun && jibun.address_name) || null);
        } else {
          resolve(null);
        }
      });
    });
  }
  return fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`)
    .then((r) => r.json())
    .then((data) => (data && data.display_name) || null)
    .catch(() => null);
}

function removeMarker(memberId) {
  if (kakaoMap) {
    const entry = kakaoMarkers[memberId];
    if (entry) {
      entry.marker.setMap(null);
      entry.overlay.setMap(null);
      delete kakaoMarkers[memberId];
    }
  } else if (markers[memberId]) {
    map.removeLayer(markers[memberId]);
    delete markers[memberId];
  }
}

// ---------- Firebase 연동 ----------

function startListening() {
  groupListenGeneration++;
  const myGeneration = groupListenGeneration;
  lastMembersData = {}; // 이전 그룹의 캐시된 데이터가 그대로 남아 다음 렌더링에 섞이지 않도록 비운다

  membersRef = db.ref(`groups/${profile.groupCode}/members`);
  membersRef.on("value", (snapshot) => {
    if (myGeneration !== groupListenGeneration) return; // 그룹이 바뀐 뒤 뒤늦게 도착한 옛 그룹 값은 버린다
    renderMembers(snapshot.val() || {});
  });

  // 위치 요청 감지는 두 경로를 함께 쓴다: (1) 실시간 리스너(포그라운드에서는 거의 즉시 반응)와
  // (2) 1분마다 REST로 직접 확인하는 폴링. 실시간 리스너(SDK 웹소켓)만 쓰면 화면이 꺼진 채
  // 오래 백그라운드에 있을 때 조용히 끊겨서 요청을 영영 못 받는 경우가 있었다 - writeLocation을
  // REST로 바꾼 것과 같은 이유. 두 경로가 같은 요청에 동시에 반응하지 않도록
  // lastHandledLocationRequestAt으로 중복을 막는다.
  lastHandledLocationRequestAt = "__unset__";
  myRequestRef = db.ref(`groups/${profile.groupCode}/members/${profile.memberId}/locationRequestedAt`);
  myRequestRef.on("value", (snapshot) => {
    if (myGeneration !== groupListenGeneration) return;
    handleLocationRequestValue(snapshot.val());
  });

  if (locationRequestPollIntervalId) clearInterval(locationRequestPollIntervalId);
  locationRequestPollIntervalId = setInterval(pollForLocationRequest, 60 * 1000);
}

function stopListening() {
  if (membersRef) membersRef.off();
  membersRef = null;
  if (myRequestRef) myRequestRef.off();
  myRequestRef = null;
  if (locationRequestPollIntervalId) {
    clearInterval(locationRequestPollIntervalId);
    locationRequestPollIntervalId = null;
  }
}

// 실시간 리스너가 백그라운드 중 끊겨있을 수 있으므로, REST로도 1분마다 직접 확인한다
// (writeLocation과 같은 이유로 fetch는 CapacitorHttp의 네이티브 네트워킹 우회 혜택을 받아
// 백그라운드에서도 안정적으로 동작한다).
async function pollForLocationRequest() {
  if (!profile || !firebaseConfig.databaseURL) return;
  try {
    const url = `${firebaseConfig.databaseURL}/groups/${encodeURIComponent(profile.groupCode)}/members/${encodeURIComponent(profile.memberId)}/locationRequestedAt.json?t=${Date.now()}`;
    const res = await fetch(url);
    const requestedAt = await res.json();
    handleLocationRequestValue(requestedAt);
  } catch (e) {
    console.warn("pollForLocationRequest failed", e);
  }
}

// 다른 참여자가 회색(오프라인)인 내 이름을 눌러 위치를 요청하면(requestFreshLocationFrom),
// 실시간 리스너 또는 폴링 중 먼저 감지한 쪽이 이 함수를 불러 지금 위치를 곧바로 다시 보낸다.
// 리스너/폴링을 새로 시작할 때 오는 첫 값은 예전 세션에 남아있던 오래된 요청일 수 있으므로
// 반응하지 않고 기준선으로만 저장한다 - 그렇지 않으면 앱을 열 때마다 과거 요청에 계속
// 재반응하게 된다. 그 이후로는 값이 실제로 바뀔 때만(=새 요청) 반응한다.
function handleLocationRequestValue(requestedAt) {
  if (lastHandledLocationRequestAt === "__unset__") {
    lastHandledLocationRequestAt = requestedAt || null;
    return;
  }
  if (!requestedAt || requestedAt === lastHandledLocationRequestAt) return;
  lastHandledLocationRequestAt = requestedAt;
  if (!profile || !profile.sharingEnabled) return;
  toast("친구가 내 위치를 요청해서 다시 보냅니다.");
  // navigator.geolocation은 네이티브 WebView에서도 그대로 동작하는 표준 웹 API라, 백그라운드
  // 서비스를 건드리지 않고도 즉시 한 번 위치를 받아와 바로 보낼 수 있다.
  requestLocationOnce();
}

// 앱이 오래 백그라운드에 있다 다시 화면에 나타났을 때, Firebase SDK의 실시간(웹소켓)
// 리스너가 조용히 끊긴 채로 재연결되지 않은 상태일 수 있다 - 그러면 다른 참여자들이
// 실제로는 계속 신호를 보내고 있어도 이 기기 화면에서는 영원히 회색으로 멈춰 보이게 된다.
// 화면이 다시 보일 때마다 (1) REST로 그룹 전체 최신 상태를 즉시 한 번 받아와 화면에 반영하고
// (2) 리스너 자체도 껐다 켜서 웹소켓 연결을 새로 맺어, 이후 실시간 갱신도 다시 정상 동작하게 한다.
async function refreshOnForeground() {
  if (!profile || !membersRef) return;
  const myGeneration = groupListenGeneration;
  try {
    const url = `${firebaseConfig.databaseURL}/groups/${encodeURIComponent(profile.groupCode)}/members.json?t=${Date.now()}`;
    const res = await fetch(url);
    const data = await res.json();
    if (myGeneration !== groupListenGeneration) return; // 응답 오는 사이 그룹이 바뀌었으면 버린다
    renderMembers(data || {});
  } catch (e) {
    console.warn("refreshOnForeground: REST refresh failed", e);
  }
  if (myGeneration !== groupListenGeneration) return; // startListening을 이미 다른 그룹으로 다시 호출했을 것
  stopListening();
  startListening();
}

let lastMembersData = {};
let previousOnlineStatus = {}; // memberId -> 지난 렌더링에서 온라인(회색이 아니었는지) 여부

function renderMembers(data) {
  lastMembersData = data;
  maybeLogConnectionStatuses(false);
  const listEl = $("#memberList");
  listEl.innerHTML = "";

  const seenIds = new Set();
  const bounds = [];

  Object.entries(data).forEach(([memberId, m]) => {
    seenIds.add(memberId);
    const isSelf = memberId === profile.memberId;
    if (typeof m.lat === "number" && typeof m.lng === "number") {
      upsertMarker(memberId, m.name, m.lat, m.lng, isSelf);
      bounds.push([m.lat, m.lng]);
    }

    const isStale = !m.updatedAt || Date.now() - m.updatedAt > STALE_MS;
    // 회색(오프라인) -> 초록(온라인)으로 바뀌는 순간에만 알림. 최초 로딩 시(이전 상태를 모를 때)는 울리지 않는다.
    if (!isSelf) {
      if (previousOnlineStatus[memberId] === false && !isStale) {
        notifyMemberBackOnline(m.name);
      }
      previousOnlineStatus[memberId] = !isStale;
    }
    const row = document.createElement("div");
    row.className = "member-row";
    row.innerHTML = `
      <span class="member-dot ${isStale ? "member-dot-offline" : "member-dot-online"}"></span>
      <span class="member-name member-name-clickable">${m.name}${isSelf ? " (나)" : ""}</span>
      <span class="member-time" data-updated="${m.updatedAt || 0}">${formatRelativeTime(m.updatedAt)}</span>
    `;
    // 회색(오프라인)으로 보이는 친구를 눌러도 곧바로 실시간 연결 확인 패널이 뜨도록,
    // 위치 유무와 무관하게 항상 클릭 가능하게 한다 (위치가 있으면 지도 이동도 함께).
    row.querySelector(".member-name").addEventListener("click", () => selectMember(memberId, m));
    if (memberId === selectedMemberId && awaitingLocationResponseFor !== memberId) {
      renderConnectionCheck(m);
    }
    listEl.appendChild(row);
  });

  Object.keys(kakaoMap ? kakaoMarkers : markers).forEach((id) => {
    if (!seenIds.has(id)) removeMarker(id);
  });

  if (bounds.length > 0 && !mapHasFitOnce) {
    if (kakaoMap) {
      const kakaoBounds = new kakao.maps.LatLngBounds();
      bounds.forEach(([lat, lng]) => kakaoBounds.extend(new kakao.maps.LatLng(lat, lng)));
      kakaoMap.setBounds(kakaoBounds);
    } else if (map) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
    mapHasFitOnce = true;
  }
}

// 참여자 온라인 복귀 알림을 실제로 띄우려면 미리 권한이 있어야 하므로, 앱 진입(사용자 액션 직후)
// 시점에 한 번 요청해둔다. 이미 허용/거부된 상태면 브라우저가 다시 묻지 않으므로 매번 호출해도 안전.
function requestNotificationPermission() {
  if (IS_NATIVE) {
    if (LocalNotifications) LocalNotifications.requestPermissions().catch(() => {});
    return;
  }
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

// 삼성 등 일부 제조사의 배터리 최적화는 위치 공유용 포그라운드 서비스를 조용히 죽여버릴 수
// 있다. 앱 시작마다(설치 이후 딱 한 번만 사용자에게 물어봄 - BATTERY_OPT_ASKED_KEY) 이미
// 제외돼있는지 확인하고, 아니라면 이유를 설명하는 확인창을 띄운 뒤 시스템 설정 화면으로
// 안내한다. 설정 화면에도 언제든 다시 열 수 있는 버튼을 별도로 둔다(아래 refreshBatteryCard).
async function maybeRequestBatteryOptimizationExemption() {
  if (!IS_NATIVE || !BatteryOptimizationBridge) return;
  if (localStorage.getItem(BATTERY_OPT_ASKED_KEY) === "1") return;
  let ignoring = true;
  try {
    ({ ignoring } = await BatteryOptimizationBridge.isIgnoringBatteryOptimizations());
  } catch (e) {
    console.warn("isIgnoringBatteryOptimizations failed", e);
    return;
  }
  localStorage.setItem(BATTERY_OPT_ASKED_KEY, "1");
  if (ignoring) return;
  const ok = await confirmDialog(
    "위치 공유가 중간에 끊기지 않도록, 이 앱을 배터리 최적화 대상에서 제외해주세요. 다음 화면에서 '허용'을 눌러주세요."
  );
  if (!ok) return;
  try {
    await BatteryOptimizationBridge.requestExemption();
  } catch (e) {
    console.warn("requestExemption failed", e);
  }
}

// 설정 화면을 열 때마다 현재 배터리 최적화 제외 상태를 다시 확인해서 카드 문구를 갱신한다
// (사용자가 시스템 설정에서 직접 바꿨을 수도 있으므로 캐시하지 않고 매번 새로 확인).
async function refreshBatteryCard() {
  if (!IS_NATIVE || !BatteryOptimizationBridge) return;
  $("#batteryCard").classList.remove("hidden");
  $("#batteryOptStatusText").textContent = "확인 중...";
  try {
    const { ignoring } = await BatteryOptimizationBridge.isIgnoringBatteryOptimizations();
    $("#batteryOptStatusText").textContent = ignoring
      ? "✅ 이미 배터리 최적화 대상에서 제외되어 있습니다."
      : "⚠️ 아직 배터리 최적화 대상입니다. 절전 기능이 백그라운드 위치 공유를 중간에 끊을 수 있어요.";
  } catch (e) {
    console.warn("refreshBatteryCard failed", e);
    $("#batteryOptStatusText").textContent = "상태를 확인하지 못했습니다.";
  }
}

// 다른 참여자가 오프라인(회색)에서 다시 온라인(초록)으로 바뀌면 시스템 알림을 띄운다.
// 이 알림은 지금 이 기기에서 앱이 실행 중이고(포그라운드 또는 화면이 꺼진 채 백그라운드 서비스가
// 살아있는 상태) 그룹 데이터를 실시간으로 듣고 있을 때만 울린다 - 서버(Cloud Functions/FCM)를
// 거치는 진짜 푸시가 아니라서, 아무도 앱을 열어두지 않은 상태라면 아무 기기에도 알림이 가지 않는다.
async function notifyMemberBackOnline(name) {
  const title = "위치 공유";
  const body = `${name}님이 다시 온라인 상태가 되었습니다.`;
  if (IS_NATIVE && LocalNotifications) {
    try {
      await LocalNotifications.schedule({
        notifications: [{ title, body, id: Date.now() % 2147483647 }],
      });
    } catch (e) {
      console.warn("local notification failed", e);
    }
    return;
  }
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission !== "denied") {
    const permission = await Notification.requestPermission();
    if (permission === "granted") new Notification(title, { body });
  }
}

// version.json에 적힌 최신 버전과 지금 설치된 버전(APP_VERSION_CODE)을 비교한다.
// 안드로이드는 사이드로드 앱을 자기 자신이 조용히 덮어쓸 수 없으므로(설치 자체는 항상
// 사용자 확인이 필요), 새 APK를 외부 브라우저로 열어 다운로드→설치 흐름을 대신 시작해준다.
async function checkForUpdate() {
  toast("업데이트 확인 중...");
  let info;
  try {
    const res = await fetch(UPDATE_MANIFEST_URL + "?t=" + Date.now());
    info = await res.json();
  } catch (e) {
    console.warn("update check failed", e);
    toast("업데이트 확인에 실패했습니다. 네트워크를 확인해주세요.");
    return;
  }
  if (!info || typeof info.versionCode !== "number") {
    toast("업데이트 정보를 확인하지 못했습니다.");
    return;
  }
  if (info.versionCode <= APP_VERSION_CODE) {
    toast("이미 최신 버전입니다.");
    return;
  }
  const ok = await confirmDialog(
    `새 버전(${info.versionName || info.versionCode})이 있습니다. 지금 다운로드해서 설치할까요?`
  );
  if (!ok) return;
  if (IS_NATIVE && UpdateBridge) {
    UpdateBridge.openExternal({ url: info.apkUrl }).catch((e) => {
      console.warn("openExternal failed", e);
      toast("업데이트 파일을 여는 데 실패했습니다.");
    });
  } else {
    window.open(info.apkUrl, "_blank");
  }
}

function renderMemberListTimesOnly() {
  document.querySelectorAll(".member-time").forEach((el) => {
    const ts = Number(el.dataset.updated) || 0;
    el.textContent = formatRelativeTime(ts);
  });
}

// ---------- 연결 기록 (친구들이 지도에 회색으로 겹쳐 보이는 것과 무관하게, 실제로 신호를
// 계속 받고 있는지를 10분마다 기록해서 나중에 확인할 수 있게 함) ----------

function getConnectionLog() {
  try {
    const raw = localStorage.getItem(CONNECTION_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function appendConnectionLog(entries) {
  if (!entries.length) return;
  const log = getConnectionLog().concat(entries);
  const trimmed = log.length > CONNECTION_LOG_MAX_ENTRIES ? log.slice(log.length - CONNECTION_LOG_MAX_ENTRIES) : log;
  localStorage.setItem(CONNECTION_LOG_KEY, JSON.stringify(trimmed));
}

// 같은(또는 거의 같은) 위치를 반복해서 역지오코딩하지 않도록 좌표를 약 100m 단위로 뭉쳐서
// 캐싱한다 - 기록은 10분마다 남는데, 제자리에 머무는 친구라면 그때마다 같은 주소를 다시
// API에 물어볼 필요가 없다(Nominatim 등 무료 역지오코딩 서비스의 과도한 반복 호출을 피함).
const geocodeCache = new Map();
function geocodeCacheKey(lat, lng) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}
async function reverseGeocodeCached(lat, lng) {
  const key = geocodeCacheKey(lat, lng);
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  const address = await reverseGeocode(lat, lng);
  geocodeCache.set(key, address);
  return address;
}

async function logConnectionStatuses() {
  const now = Date.now();
  const entries = [];
  const targets = Object.entries(lastMembersData).filter(([memberId]) => memberId !== profile.memberId);
  // 여러 명을 한꺼번에 병렬로 지오코딩하면 짧은 시간에 요청이 몰릴 수 있어 순차로 처리한다.
  for (const [, m] of targets) {
    const minutesSince = m.updatedAt ? Math.floor((now - m.updatedAt) / 60000) : null;
    const isStale = !m.updatedAt || now - m.updatedAt > STALE_MS;
    let address = null;
    if (typeof m.lat === "number" && typeof m.lng === "number") {
      try {
        address = await reverseGeocodeCached(m.lat, m.lng);
      } catch (e) {
        address = null;
      }
    }
    entries.push({ ts: now, name: m.name, status: isStale ? "lost" : "ok", minutesSince, address });
  }
  appendConnectionLog(entries);
  lastConnectionLogAt = now;
  if (!$("#screen-connection-log").classList.contains("hidden")) renderConnectionLog();
}

// 화면이 꺼지거나 앱이 백그라운드로 가면 순수 setInterval 타이머는 안드로이드에 의해
// 지연되거나 아예 멈출 수 있어서, 그 타이머 하나에만 의존하면 "10분마다 기록"이
// 실제로는 건너뛰어지곤 했다. 그래서 타이머 틱뿐 아니라 실제로 뭔가 일어나는
// 시점들(그룹 데이터가 실시간으로 갱신될 때, 내 위치가 백그라운드에서 새로 보고될 때,
// 앱이 다시 화면에 보일 때)마다 "마지막 기록 이후 10분이 지났는지"를 확인해서,
// 지나 있으면 그 자리에서 바로 기록한다. 이 트리거들은 백그라운드 포그라운드
// 서비스가 살아있는 한 함께 살아있으므로 기록도 계속 이어지고, 한 번 놓쳐도
// 다음 신호가 오는 즉시 따라잡는다.
function maybeLogConnectionStatuses(force) {
  if (!profile) return;
  if (force || Date.now() - lastConnectionLogAt >= CONNECTION_LOG_INTERVAL_MS) {
    logConnectionStatuses();
  }
}

function startConnectionLogging() {
  if (connectionLogIntervalId) clearInterval(connectionLogIntervalId);
  logConnectionStatuses();
  // 정확히 10분마다가 아니라 1분마다 "10분이 지났는지"를 확인한다 - 확인 주기를
  // 촘촘하게 둬야 타이머가 늦게 깨어나거나 한 번 건너뛰어도 금방 따라잡는다.
  connectionLogIntervalId = setInterval(() => maybeLogConnectionStatuses(false), 60 * 1000);
}

function formatLogTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderConnectionLog() {
  const listEl = $("#connectionLogList");
  const log = getConnectionLog();
  if (!log.length) {
    listEl.innerHTML = `<p class="hint-text">아직 기록이 없습니다. 10분마다 자동으로 기록됩니다.</p>`;
    return;
  }
  listEl.innerHTML = log
    .slice()
    .reverse()
    .map((entry) => {
      const statusText =
        entry.status === "ok"
          ? "정상 수신"
          : "신호 끊김" + (entry.minutesSince != null ? ` (${entry.minutesSince}분간 갱신 없음)` : "");
      const dotClass = entry.status === "ok" ? "log-dot-ok" : "log-dot-lost";
      const statusClass = entry.status === "ok" ? "" : " log-status-lost";
      const addressHtml = entry.address ? `<div class="log-address">📍 ${entry.address}</div>` : "";
      return `
        <div class="log-row">
          <div class="log-row-top">
            <span class="log-dot ${dotClass}"></span>
            <span class="log-name">${entry.name}</span>
            <span class="log-time">${formatLogTime(entry.ts)}</span>
          </div>
          <div class="log-status${statusClass}">${statusText}</div>
          ${addressHtml}
        </div>
      `;
    })
    .join("");
}

// ---------- 지난 위치 기록 (참여자 전원이 항상 자동으로 남기고, 그룹 누구나 볼 수 있음) ----------

async function openLocationHistory(memberId, name, isSelf) {
  $("#locationHistoryTitle").textContent = name + "님 위치 기록";
  $("#btnLocationHistoryClear").classList.toggle("hidden", !isSelf);
  $("#locationHistoryList").innerHTML = `<p class="hint-text">불러오는 중...</p>`;
  pushScreen("screen-location-history");
  await loadAndRenderLocationHistory(memberId);
}

async function loadAndRenderLocationHistory(memberId) {
  if (!profile || !firebaseConfig.databaseURL) return;
  try {
    const url = `${firebaseConfig.databaseURL}/groups/${encodeURIComponent(profile.groupCode)}/members/${encodeURIComponent(memberId)}/history.json?t=${Date.now()}`;
    const res = await fetch(url);
    const data = await res.json();
    renderLocationHistoryList(data || {});
  } catch (e) {
    console.warn("loadAndRenderLocationHistory failed", e);
    $("#locationHistoryList").innerHTML = `<p class="hint-text">기록을 불러오지 못했습니다.</p>`;
  }
}

function renderLocationHistoryList(data) {
  const listEl = $("#locationHistoryList");
  const entries = Object.values(data)
    .filter((e) => typeof e.lat === "number" && typeof e.lng === "number")
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, LOCATION_HISTORY_MAX_ENTRIES);
  if (!entries.length) {
    listEl.innerHTML = `<p class="hint-text">아직 기록이 없습니다.</p>`;
    return;
  }
  listEl.innerHTML = entries
    .map(
      (e) => `
        <div class="log-row">
          <div class="log-row-top">
            <span class="log-time">${formatLogTime(e.ts)}</span>
          </div>
          <div class="log-address">주소를 불러오는 중...</div>
        </div>
      `
    )
    .join("");
  fillLocationHistoryAddresses(entries);
}

// 같은 화면에서 여러 명분 주소를 한꺼번에 요청하지 않도록 순차로 채운다 (무료 역지오코딩 서비스 과다 호출 방지).
async function fillLocationHistoryAddresses(entries) {
  const rows = $("#locationHistoryList").querySelectorAll(".log-address");
  for (let i = 0; i < entries.length; i++) {
    const address = await reverseGeocodeCached(entries[i].lat, entries[i].lng);
    if (rows[i]) rows[i].textContent = "📍 " + (address || "주소를 찾을 수 없습니다.");
  }
}

// writeLocation()이 실시간 위치를 쓸 때마다 같이 호출된다. 참여자 전원에 대해 항상,
// 10분에 한 번씩만 별도의 history 노드에 좌표를 남긴다(실시간 위치와 달리 매번 덮어쓰지 않고
// 쌓임) - 순수 시간 기준이라 그 사이 이동이 없었어도 그대로 다시 기록된다.
function maybeWriteLocationHistory(lat, lng, accuracy) {
  if (!profile || !firebaseConfig.databaseURL) return;
  const lastWrite = Number(localStorage.getItem(LOCATION_HISTORY_LAST_WRITE_KEY)) || 0;
  if (Date.now() - lastWrite < LOCATION_HISTORY_INTERVAL_MS) return;
  localStorage.setItem(LOCATION_HISTORY_LAST_WRITE_KEY, String(Date.now()));
  const url = `${firebaseConfig.databaseURL}/groups/${encodeURIComponent(profile.groupCode)}/members/${encodeURIComponent(profile.memberId)}/history.json`;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng, accuracy, ts: { ".sv": "timestamp" } }),
  }).catch((e) => console.warn("writeLocationHistory failed", e));
}

// Realtime Database REST API로 직접 PUT한다 (Firebase JS SDK의 웹소켓 대신).
// 안드로이드 WebView는 화면이 꺼지거나 앱이 백그라운드로 간 지 몇 분이 지나면
// 자체적으로 네트워크 요청을 지연시키는데, capacitor.config.json에서 켠
// CapacitorHttp가 fetch를 네이티브 네트워킹으로 우회시켜주므로 백그라운드에서도
// 안정적으로 위치가 기록된다 (SDK의 웹소켓 연결은 이 우회의 혜택을 받지 못한다).
function writeLocation(lat, lng, accuracy) {
  const url = `${firebaseConfig.databaseURL}/groups/${encodeURIComponent(profile.groupCode)}/members/${encodeURIComponent(profile.memberId)}.json`;
  maybeWriteLocationHistory(lat, lng, accuracy);
  return fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: profile.name,
      lat,
      lng,
      accuracy,
      updatedAt: { ".sv": "timestamp" },
    }),
  }).catch((err) => console.warn("writeLocation failed", err));
}

function removeOwnLocation() {
  if (!db || !profile) return;
  db.ref(`groups/${profile.groupCode}/members/${profile.memberId}`).remove();
  removeMarker(profile.memberId);
}

// ---------- 위치 공유 루프 ----------

function requestLocationOnce() {
  if (!navigator.geolocation) {
    toast("이 브라우저는 위치 기능을 지원하지 않습니다.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      writeLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    (err) => {
      console.warn("geolocation error", err);
    },
    { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 }
  );
}

// 네이티브(APK)에서는 위치 공유 루프 자체를 이 JS가 돌리지 않는다 - syncNativeProfile()이
// NativeProfileBridge.save()를 통해 BootLocationForegroundService(순수 네이티브, WebView와
// 무관하게 동작, START_STICKY라 죽어도 스스로 재시작)를 시작/정지시키는 게 유일한 통로다.
// (2026-08-17: 예전엔 여기서 @capacitor-community/background-geolocation의 addWatcher()로 직접
// 워처를 돌리고 10분마다 재시작까지 했는데, 그 경로는 앱 프로세스가 살아있을 때만 동작해서
// 안드로이드가 프로세스를 통째로 죽이면 복구할 방법이 없었다 - "친구 신호가 잘 끊긴다"는
// 문제의 실제 원인이었다. 순수 네이티브 서비스 하나로 합쳐서 이 문제를 근본적으로 없앴다.)
function startSharingLoop() {
  if (IS_NATIVE) {
    syncNativeProfile(); // profile.sharingEnabled은 이미 true로 저장된 뒤 호출되므로 서비스가 시작된다
    return;
  }
  if (shareIntervalId) return;
  requestLocationOnce();
  shareIntervalId = setInterval(requestLocationOnce, UPDATE_INTERVAL_MS);
}

function stopSharingLoop() {
  if (IS_NATIVE) {
    syncNativeProfile(); // profile.sharingEnabled이 이미 false로 저장된 뒤 호출되므로 서비스가 멈춘다
    return;
  }
  if (shareIntervalId) {
    clearInterval(shareIntervalId);
    shareIntervalId = null;
  }
}

window.addEventListener("load", init);
