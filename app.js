const GATE_KEY = "ls_gate_v1";
const ACCESS_ID = "6003";
const ACCESS_PASSWORD = "6003";
const CONSENT_KEY = "ls_consent_v1";
const PROFILE_KEY = "ls_profile_v1";
const UPDATE_INTERVAL_MS = 3 * 60 * 1000; // 3분마다 위치 갱신 (웹 브라우저 탭이 열려있을 때만, foreground 전용)
const STALE_MS = UPDATE_INTERVAL_MS * 3; // 이 시간 이상 갱신 없으면 "오프라인" 표시
const NATIVE_DISTANCE_FILTER_M = 30; // 네이티브 앱: 이 거리(m) 이상 이동해야 새 위치를 기록 (배터리 절약)

// 네이티브 앱(APK)에서는 Capacitor의 백그라운드 위치 플러그인을 통해 화면이 꺼지거나
// 다른 앱으로 전환해도 계속 위치를 공유한다. 순수 웹(GitHub Pages 등)에서는 이 플러그인이
// 없으므로 브라우저 탭이 열려있는 동안만 setInterval로 주기 갱신하는 기존 방식을 그대로 쓴다.
const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const BackgroundGeolocation = IS_NATIVE ? window.Capacitor.registerPlugin("BackgroundGeolocation") : null;
const LocalNotifications = IS_NATIVE ? window.Capacitor.registerPlugin("LocalNotifications") : null;
const NativeProfileBridge = IS_NATIVE ? window.Capacitor.registerPlugin("NativeProfileBridge") : null;
let bgWatcherId = null;

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
let shareIntervalId = null;
let profile = null;
let listRefreshIntervalId = null;

function $(sel) { return document.querySelector(sel); }

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  $("#" + id).classList.remove("hidden");
}

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
function syncNativeProfile() {
  if (!IS_NATIVE || !NativeProfileBridge || !profile) return;
  NativeProfileBridge.save({
    sharingEnabled: !!profile.sharingEnabled,
    memberId: profile.memberId,
    name: profile.name,
    groupCode: profile.groupCode,
    databaseURL: firebaseConfig.databaseURL,
  }).catch((e) => console.warn("syncNativeProfile failed", e));
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
  if (!firebaseConfig.apiKey) {
    showScreen("screen-no-config");
    return;
  }
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();

  bindStaticHandlers();

  if (!getGatePassed()) {
    showScreen("screen-login");
    return;
  }
  proceedAfterGate();
}

// 접속 화면(공용 아이디/비밀번호) 통과 후 항상 이 경로를 거친다.
function proceedAfterGate() {
  if (!getConsent()) {
    showScreen("screen-consent");
    return;
  }
  profile = getProfile();
  if (!profile) {
    showScreen("screen-setup");
    return;
  }
  showScreen("screen-main");
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
    showScreen("screen-setup");
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
    showScreen("screen-main");
    startApp();
  });

  $("#btnSettings").addEventListener("click", () => {
    $("#settingsName").value = profile.name;
    $("#settingsGroupCode").value = profile.groupCode;
    $("#sharingToggle").checked = profile.sharingEnabled;
    $("#mapProviderSelect").value = getMapProvider();
    showScreen("screen-settings");
  });
  $("#btnSettingsBack").addEventListener("click", () => showScreen("screen-main"));

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
    if (groupChanged) {
      markers = {};
      kakaoMarkers = {};
      startListening();
    }
    toast("저장되었습니다.");
    showScreen("screen-main");
  });

  $("#groupCodeDisplay").addEventListener("click", () => {
    navigator.clipboard.writeText(profile.groupCode).then(() => toast("그룹 코드를 복사했습니다."));
  });
}

function startApp() {
  syncNativeProfile(); // 기존 설치본(이 필드가 생기기 전)도 네이티브 저장소에 반영
  $("#groupCodeDisplay").textContent = profile.groupCode;
  initMap(() => {
    startListening();
    if (profile.sharingEnabled) startSharingLoop();
  });

  if (listRefreshIntervalId) clearInterval(listRefreshIntervalId);
  listRefreshIntervalId = setInterval(renderMemberListTimesOnly, 30000);
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
  script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_APP_KEY}&autoload=false`;
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
  membersRef = db.ref(`groups/${profile.groupCode}/members`);
  membersRef.on("value", (snapshot) => renderMembers(snapshot.val() || {}));
}

function stopListening() {
  if (membersRef) membersRef.off();
  membersRef = null;
}

let lastMembersData = {};

function renderMembers(data) {
  lastMembersData = data;
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
    const hasLocation = typeof m.lat === "number" && typeof m.lng === "number";
    const row = document.createElement("div");
    row.className = "member-row";
    row.innerHTML = `
      <span class="member-dot ${isStale ? "member-dot-offline" : "member-dot-online"}"></span>
      <span class="member-name${hasLocation ? " member-name-clickable" : ""}">${m.name}${isSelf ? " (나)" : ""}</span>
      <span class="member-time" data-updated="${m.updatedAt || 0}">${formatRelativeTime(m.updatedAt)}</span>
    `;
    if (hasLocation) {
      row.querySelector(".member-name").addEventListener("click", () => focusMember(m.lat, m.lng));
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

function renderMemberListTimesOnly() {
  document.querySelectorAll(".member-time").forEach((el) => {
    const ts = Number(el.dataset.updated) || 0;
    el.textContent = formatRelativeTime(ts);
  });
}

// Realtime Database REST API로 직접 PUT한다 (Firebase JS SDK의 웹소켓 대신).
// 안드로이드 WebView는 화면이 꺼지거나 앱이 백그라운드로 간 지 몇 분이 지나면
// 자체적으로 네트워크 요청을 지연시키는데, capacitor.config.json에서 켠
// CapacitorHttp가 fetch를 네이티브 네트워킹으로 우회시켜주므로 백그라운드에서도
// 안정적으로 위치가 기록된다 (SDK의 웹소켓 연결은 이 우회의 혜택을 받지 못한다).
function writeLocation(lat, lng, accuracy) {
  const url = `${firebaseConfig.databaseURL}/groups/${encodeURIComponent(profile.groupCode)}/members/${encodeURIComponent(profile.memberId)}.json`;
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

function startSharingLoop() {
  if (IS_NATIVE) {
    startNativeBackgroundSharing();
    return;
  }
  if (shareIntervalId) return;
  requestLocationOnce();
  shareIntervalId = setInterval(requestLocationOnce, UPDATE_INTERVAL_MS);
}

function stopSharingLoop() {
  if (IS_NATIVE) {
    stopNativeBackgroundSharing();
    return;
  }
  if (shareIntervalId) {
    clearInterval(shareIntervalId);
    shareIntervalId = null;
  }
}

// ---------- 네이티브 백그라운드 위치 공유 (안드로이드 APK 전용) ----------
// @capacitor-community/background-geolocation은 안드로이드에서 포그라운드 서비스 +
// 지속 알림을 통해 화면이 꺼지거나 다른 앱으로 전환해도 위치 갱신을 계속 받을 수 있게 해준다.
// 알림 표시 권한(POST_NOTIFICATIONS, 안드로이드 13+)은 이 플러그인이 직접 요청하지 않으므로
// LocalNotifications로 먼저 요청한다 (플러그인 공식 문서 권장 방식).
async function startNativeBackgroundSharing() {
  if (bgWatcherId) return;
  try {
    await LocalNotifications.requestPermissions();
  } catch (e) {
    console.warn("notification permission request failed", e);
  }
  try {
    bgWatcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: "가족/지인에게 내 위치를 공유하고 있습니다. 취소하면 배터리 소모를 줄일 수 있습니다.",
        backgroundTitle: "위치 공유 중",
        requestPermissions: true,
        stale: false,
        distanceFilter: NATIVE_DISTANCE_FILTER_M,
      },
      (location, error) => {
        if (error) {
          console.warn("background geolocation error", error);
          if (error.code === "NOT_AUTHORIZED") {
            toast("위치 권한이 필요합니다. 설정에서 위치 권한을 허용해주세요.");
          }
          return;
        }
        if (location) {
          writeLocation(location.latitude, location.longitude, location.accuracy);
        }
      }
    );
  } catch (e) {
    console.error("failed to start background watcher", e);
    toast("백그라운드 위치 공유를 시작하지 못했습니다.");
  }
}

function stopNativeBackgroundSharing() {
  if (!bgWatcherId) return;
  BackgroundGeolocation.removeWatcher({ id: bgWatcherId });
  bgWatcherId = null;
}

window.addEventListener("load", init);
