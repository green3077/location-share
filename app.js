const CONSENT_KEY = "ls_consent_v1";
const PROFILE_KEY = "ls_profile_v1";
const UPDATE_INTERVAL_MS = 3 * 60 * 1000; // 3분마다 위치 갱신
const STALE_MS = UPDATE_INTERVAL_MS * 3; // 이 시간 이상 갱신 없으면 "오프라인" 표시

let db = null;
let map = null;
let markers = {}; // memberId -> L.marker
let membersRef = null;
let shareIntervalId = null;
let profile = null;
let listRefreshIntervalId = null;

function $(sel) { return document.querySelector(sel); }

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  $("#" + id).classList.remove("hidden");
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
    showScreen("screen-settings");
  });
  $("#btnSettingsBack").addEventListener("click", () => showScreen("screen-main"));

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
  $("#groupCodeDisplay").textContent = profile.groupCode;
  initMap();
  startListening();
  if (profile.sharingEnabled) startSharingLoop();

  if (listRefreshIntervalId) clearInterval(listRefreshIntervalId);
  listRefreshIntervalId = setInterval(renderMemberListTimesOnly, 30000);
}

// ---------- 지도 ----------

function initMap() {
  if (map) return;
  map = L.map("map").setView([36.5, 127.8], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);
}

function upsertMarker(memberId, name, lat, lng, isSelf) {
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

function removeMarker(memberId) {
  if (markers[memberId]) {
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
    const row = document.createElement("div");
    row.className = "member-row";
    row.innerHTML = `
      <span class="member-dot ${isStale ? "member-dot-offline" : "member-dot-online"}"></span>
      <span class="member-name">${m.name}${isSelf ? " (나)" : ""}</span>
      <span class="member-time" data-updated="${m.updatedAt || 0}">${formatRelativeTime(m.updatedAt)}</span>
    `;
    listEl.appendChild(row);
  });

  Object.keys(markers).forEach((id) => {
    if (!seenIds.has(id)) removeMarker(id);
  });

  if (bounds.length > 0 && !map._hasFitOnce) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    map._hasFitOnce = true;
  }
}

function renderMemberListTimesOnly() {
  document.querySelectorAll(".member-time").forEach((el) => {
    const ts = Number(el.dataset.updated) || 0;
    el.textContent = formatRelativeTime(ts);
  });
}

function writeLocation(lat, lng, accuracy) {
  db.ref(`groups/${profile.groupCode}/members/${profile.memberId}`).set({
    name: profile.name,
    lat,
    lng,
    accuracy,
    updatedAt: firebase.database.ServerValue.TIMESTAMP,
  });
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
  if (shareIntervalId) return;
  requestLocationOnce();
  shareIntervalId = setInterval(requestLocationOnce, UPDATE_INTERVAL_MS);
}

function stopSharingLoop() {
  if (shareIntervalId) {
    clearInterval(shareIntervalId);
    shareIntervalId = null;
  }
}

window.addEventListener("load", init);
