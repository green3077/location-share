(function () {
  "use strict";

  // 사장님 접속 비밀번호. 필요하면 이 값을 바꾸세요.
  // (진짜 로그인 보안이 아니라, 친구들이 실수로 들어오는 것을 막는 정도의 간단한 잠금입니다.)
  var ADMIN_PIN = "0000";
  var AUTH_KEY = "tableOrderAdminAuthed";

  var els = {
    screenLogin: document.getElementById("screenLogin"),
    adminPin: document.getElementById("adminPin"),
    btnAdminLogin: document.getElementById("btnAdminLogin"),
    adminLoginError: document.getElementById("adminLoginError"),
    screenDashboard: document.getElementById("screenDashboard"),
    btnAdminLogout: document.getElementById("btnAdminLogout"),
    statTodaySales: document.getElementById("statTodaySales"),
    statUnpaid: document.getElementById("statUnpaid"),
    statPendingCount: document.getElementById("statPendingCount"),
    staffCallBanner: document.getElementById("staffCallBanner"),
    tableSummary: document.getElementById("tableSummary"),
    filterTabs: document.getElementById("filterTabs"),
    orderList: document.getElementById("orderList"),
    orderListEmpty: document.getElementById("orderListEmpty"),
    toastContainer: document.getElementById("toastContainer"),
  };

  var db = null;
  var ordersData = {};
  var staffCallsData = {};
  var currentFilter = "all";
  var listenersAttached = false;

  function showToast(message) {
    var toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    els.toastContainer.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 2200);
  }

  function formatPrice(n) {
    return (n || 0).toLocaleString("ko-KR") + "원";
  }

  function formatTime(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    var hh = String(d.getHours()).padStart(2, "0");
    var mm = String(d.getMinutes()).padStart(2, "0");
    return hh + ":" + mm;
  }

  function isToday(ts) {
    if (!ts) return false;
    var d = new Date(ts);
    var now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  // ---------- Auth ----------

  function tryLogin() {
    var val = els.adminPin.value.trim();
    if (val && val === ADMIN_PIN) {
      localStorage.setItem(AUTH_KEY, "1");
      els.adminLoginError.classList.add("hidden");
      showDashboard();
    } else {
      els.adminLoginError.classList.remove("hidden");
    }
  }

  els.btnAdminLogin.addEventListener("click", tryLogin);
  els.adminPin.addEventListener("keydown", function (e) {
    if (e.key === "Enter") tryLogin();
  });

  els.btnAdminLogout.addEventListener("click", function () {
    localStorage.removeItem(AUTH_KEY);
    window.location.reload();
  });

  function showDashboard() {
    els.screenLogin.classList.add("hidden");
    els.screenDashboard.classList.remove("hidden");
    renderAll();
    initFirebase();
  }

  // ---------- Firebase ----------

  function initFirebase() {
    if (listenersAttached) return;
    listenersAttached = true;
    try {
      firebase.initializeApp(firebaseConfig);
      db = firebase.database();
    } catch (e) {
      console.error("Firebase init failed", e);
      showToast("데이터베이스 연결에 실패했습니다.");
      return;
    }

    db.ref("tableOrders/orders").on("value", function (snap) {
      ordersData = snap.val() || {};
      renderAll();
    });

    db.ref("tableOrders/staffCalls").on("value", function (snap) {
      staffCallsData = snap.val() || {};
      renderStaffCallBanner();
    });
  }

  function ordersArray() {
    return Object.keys(ordersData).map(function (id) {
      var o = ordersData[id];
      o.id = id;
      return o;
    });
  }

  // ---------- Rendering ----------

  function renderStaffCallBanner() {
    var pending = Object.keys(staffCallsData).map(function (id) {
      var c = staffCallsData[id];
      c.id = id;
      return c;
    }).filter(function (c) { return c.status === "pending"; });

    if (pending.length === 0) {
      els.staffCallBanner.classList.add("hidden");
      els.staffCallBanner.innerHTML = "";
      return;
    }

    els.staffCallBanner.classList.remove("hidden");
    els.staffCallBanner.innerHTML = "";

    var label = document.createElement("span");
    label.textContent = "🔔 직원 호출";
    els.staffCallBanner.appendChild(label);

    pending
      .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); })
      .forEach(function (call) {
        var chip = document.createElement("span");
        chip.className = "staff-call-chip";
        chip.textContent = "테이블 " + call.tableNumber + " ";

        var resolveBtn = document.createElement("button");
        resolveBtn.type = "button";
        resolveBtn.textContent = "✓";
        resolveBtn.addEventListener("click", function () {
          db.ref("tableOrders/staffCalls/" + call.id).update({
            status: "resolved",
            resolvedAt: firebase.database.ServerValue.TIMESTAMP,
          }).catch(function (err) { console.error(err); });
        });

        chip.appendChild(resolveBtn);
        els.staffCallBanner.appendChild(chip);
      });
  }

  function computeStats(orders) {
    var todaySales = 0, unpaid = 0, pendingCount = 0;
    orders.forEach(function (o) {
      if (o.status === "done" && isToday(o.createdAt)) todaySales += o.totalAmount || 0;
      if (o.status === "pending") {
        unpaid += o.totalAmount || 0;
        pendingCount += 1;
      }
    });
    return { todaySales: todaySales, unpaid: unpaid, pendingCount: pendingCount };
  }

  function renderTableSummary(orders) {
    var byTable = {};
    orders.forEach(function (o) {
      if (o.status !== "pending") return;
      var key = o.tableNumber;
      byTable[key] = byTable[key] || { total: 0, ids: [] };
      byTable[key].total += o.totalAmount || 0;
      byTable[key].ids.push(o.id);
    });

    var tableNumbers = Object.keys(byTable).map(Number).sort(function (a, b) { return a - b; });
    els.tableSummary.innerHTML = "";

    if (tableNumbers.length === 0) {
      var empty = document.createElement("div");
      empty.className = "table-summary-empty";
      empty.textContent = "미결제 테이블이 없습니다.";
      els.tableSummary.appendChild(empty);
      return;
    }

    tableNumbers.forEach(function (n) {
      var info = byTable[n];
      var card = document.createElement("div");
      card.className = "table-summary-card";

      var title = document.createElement("div");
      title.className = "table-summary-title";
      title.textContent = "테이블 " + n;

      var amount = document.createElement("div");
      amount.className = "table-summary-amount";
      amount.textContent = formatPrice(info.total);

      var payBtn = document.createElement("button");
      payBtn.type = "button";
      payBtn.className = "table-summary-pay-btn";
      payBtn.textContent = "결제완료 처리";
      payBtn.addEventListener("click", function () {
        if (!window.confirm("테이블 " + n + "의 주문 " + info.ids.length + "건을 결제완료 처리할까요?")) return;
        var updates = {};
        info.ids.forEach(function (id) {
          updates["tableOrders/orders/" + id + "/status"] = "done";
          updates["tableOrders/orders/" + id + "/doneAt"] = firebase.database.ServerValue.TIMESTAMP;
        });
        db.ref().update(updates)
          .then(function () { showToast("테이블 " + n + " 결제완료 처리했습니다."); })
          .catch(function (err) { console.error(err); showToast("처리에 실패했습니다."); });
      });

      card.appendChild(title);
      card.appendChild(amount);
      card.appendChild(payBtn);
      els.tableSummary.appendChild(card);
    });
  }

  function renderOrderList(orders) {
    var filtered = orders.filter(function (o) {
      if (currentFilter === "pending") return o.status === "pending";
      if (currentFilter === "done") return o.status === "done";
      return true;
    }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

    els.orderList.innerHTML = "";
    els.orderListEmpty.classList.toggle("hidden", filtered.length > 0);

    filtered.forEach(function (o) {
      var card = document.createElement("div");
      card.className = "order-card" + (o.status === "done" ? " done" : "");

      var top = document.createElement("div");
      top.className = "order-card-top";

      var topLeft = document.createElement("div");
      topLeft.style.display = "flex";
      topLeft.style.gap = "10px";
      topLeft.style.alignItems = "center";

      var tableEl = document.createElement("div");
      tableEl.className = "order-card-table";
      tableEl.textContent = "테이블 " + o.tableNumber;

      var timeEl = document.createElement("div");
      timeEl.className = "order-card-time";
      timeEl.textContent = formatTime(o.createdAt);

      topLeft.appendChild(tableEl);
      topLeft.appendChild(timeEl);

      var statusEl = document.createElement("div");
      statusEl.className = "order-status-badge" + (o.status === "done" ? " done" : "");
      statusEl.textContent = o.status === "done" ? "완료" : "미완료";

      top.appendChild(topLeft);
      top.appendChild(statusEl);

      var itemsEl = document.createElement("div");
      itemsEl.className = "order-card-items";
      itemsEl.innerHTML = (o.items || []).map(function (it) {
        return it.name + " x" + it.qty;
      }).join("<br>");

      var bottom = document.createElement("div");
      bottom.className = "order-card-bottom";

      var totalEl = document.createElement("div");
      totalEl.className = "order-card-total";
      totalEl.textContent = formatPrice(o.totalAmount);

      var actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = "order-card-action" + (o.status === "done" ? " undo" : "");
      actionBtn.textContent = o.status === "done" ? "미완료로 되돌리기" : "완료 처리";
      actionBtn.addEventListener("click", function () {
        var newStatus = o.status === "done" ? "pending" : "done";
        db.ref("tableOrders/orders/" + o.id).update({
          status: newStatus,
          doneAt: newStatus === "done" ? firebase.database.ServerValue.TIMESTAMP : null,
        }).catch(function (err) { console.error(err); showToast("처리에 실패했습니다."); });
      });

      bottom.appendChild(totalEl);
      bottom.appendChild(actionBtn);

      card.appendChild(top);
      card.appendChild(itemsEl);
      card.appendChild(bottom);
      els.orderList.appendChild(card);
    });
  }

  function renderAll() {
    var orders = ordersArray();
    var stats = computeStats(orders);
    els.statTodaySales.textContent = formatPrice(stats.todaySales);
    els.statUnpaid.textContent = formatPrice(stats.unpaid);
    els.statPendingCount.textContent = stats.pendingCount + "건";
    renderTableSummary(orders);
    renderOrderList(orders);
  }

  Array.prototype.slice.call(els.filterTabs.querySelectorAll(".filter-tab")).forEach(function (btn) {
    btn.addEventListener("click", function () {
      currentFilter = btn.getAttribute("data-filter");
      Array.prototype.slice.call(els.filterTabs.querySelectorAll(".filter-tab")).forEach(function (b) {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      renderOrderList(ordersArray());
    });
  });

  // ---------- Init ----------

  if (localStorage.getItem(AUTH_KEY) === "1") {
    showDashboard();
  }
})();
