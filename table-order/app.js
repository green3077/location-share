(function () {
  "use strict";

  var UI_STRINGS = {
    ko: {
      "table.label": "테이블",
      "table.pick.title": "테이블 번호를 선택해주세요",
      "nav.order": "메뉴주문",
      "staff.call": "직원<br>호출",
      "coupon": "쿠폰",
      "orderHistory": "주문내역",
      "placeOrder": "주문하기",
      "cart.empty": "담긴 메뉴가 없습니다.",
      "cart.total": "총 결제금액",
      "cart.confirm": "주문하기",
      "coupon.empty": "사용 가능한 쿠폰이 없습니다.",
      "add": "담기",
      "won": "원",
      "toast.added": "담았습니다.",
      "toast.staffCalled": "직원을 호출했습니다.",
      "toast.orderPlaced": "주문이 접수되었습니다!",
      "toast.orderFailed": "주문 접수에 실패했습니다. 다시 시도해주세요.",
      "badge.popular": "인기",
      "badge.new": "신메뉴",
    },
    en: {
      "table.label": "TABLE",
      "table.pick.title": "Please select your table number",
      "nav.order": "Order",
      "staff.call": "Call<br>Staff",
      "coupon": "Coupon",
      "orderHistory": "Order List",
      "placeOrder": "Order",
      "cart.empty": "No items yet.",
      "cart.total": "Total",
      "cart.confirm": "Place Order",
      "coupon.empty": "No coupons available.",
      "add": "Add",
      "won": "",
      "toast.added": "Added to cart.",
      "toast.staffCalled": "Staff has been called.",
      "toast.orderPlaced": "Your order has been placed!",
      "toast.orderFailed": "Failed to place order. Please try again.",
      "badge.popular": "Popular",
      "badge.new": "New",
    },
  };

  var CONFIG = {
    tableCount: 12,
  };

  var db = null;
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
  } catch (e) {
    console.error("Firebase init failed", e);
  }

  function resolveInitialTableNumber() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = parseInt(params.get("table"), 10);
    if (fromUrl >= 1 && fromUrl <= CONFIG.tableCount) return fromUrl;
    var stored = parseInt(localStorage.getItem("tableOrderTableNumber"), 10);
    if (stored >= 1 && stored <= CONFIG.tableCount) return stored;
    return null;
  }

  var state = {
    lang: "ko",
    categoryId: MENU_DATA.categories[0].id,
    cart: {}, // itemId -> qty
    tableNumber: resolveInitialTableNumber(),
  };

  var els = {
    categoryTabs: document.getElementById("categoryTabs"),
    catPrev: document.getElementById("catPrev"),
    catNext: document.getElementById("catNext"),
    menuGrid: document.getElementById("menuGrid"),
    orderCountBadge: document.getElementById("orderCountBadge"),
    btnLang: document.getElementById("btnLang"),
    langLabel: document.getElementById("langLabel"),
    btnCallStaff: document.getElementById("btnCallStaff"),
    btnCoupon: document.getElementById("btnCoupon"),
    btnOrderHistory: document.getElementById("btnOrderHistory"),
    btnPlaceOrder: document.getElementById("btnPlaceOrder"),
    cartModalOverlay: document.getElementById("cartModalOverlay"),
    btnCloseCart: document.getElementById("btnCloseCart"),
    cartList: document.getElementById("cartList"),
    cartEmpty: document.getElementById("cartEmpty"),
    cartTotalAmount: document.getElementById("cartTotalAmount"),
    btnConfirmOrder: document.getElementById("btnConfirmOrder"),
    couponModalOverlay: document.getElementById("couponModalOverlay"),
    btnCloseCoupon: document.getElementById("btnCloseCoupon"),
    toastContainer: document.getElementById("toastContainer"),
    btnTableBadge: document.getElementById("btnTableBadge"),
    tableNumberDisplay: document.getElementById("tableNumber"),
    tableModalOverlay: document.getElementById("tableModalOverlay"),
    tablePickerGrid: document.getElementById("tablePickerGrid"),
    btnCloseTableModal: document.getElementById("btnCloseTableModal"),
  };

  function t(key) {
    return UI_STRINGS[state.lang][key] || key;
  }

  function findItem(itemId) {
    return MENU_DATA.items.find(function (it) { return it.id === itemId; });
  }

  function formatPrice(price) {
    var formatted = price.toLocaleString(state.lang === "ko" ? "ko-KR" : "en-US");
    return state.lang === "ko" ? formatted + t("won") : "₩" + formatted;
  }

  function cartCount() {
    return Object.keys(state.cart).reduce(function (sum, id) { return sum + state.cart[id]; }, 0);
  }

  function cartTotal() {
    return Object.keys(state.cart).reduce(function (sum, id) {
      var item = findItem(id);
      return sum + (item ? item.price * state.cart[id] : 0);
    }, 0);
  }

  function showToast(message) {
    var toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    els.toastContainer.appendChild(toast);
    setTimeout(function () {
      toast.remove();
    }, 2200);
  }

  // ---------- Rendering ----------

  function renderCategoryTabs() {
    var categoryBar = els.categoryTabs.closest(".category-bar");
    if (MENU_DATA.categories.length <= 1) {
      categoryBar.classList.add("hidden");
      return;
    }
    categoryBar.classList.remove("hidden");
    els.categoryTabs.innerHTML = "";
    MENU_DATA.categories.forEach(function (cat) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-tab" + (cat.id === state.categoryId ? " active" : "");
      btn.textContent = cat.name[state.lang];
      btn.addEventListener("click", function () {
        state.categoryId = cat.id;
        renderCategoryTabs();
        renderMenuGrid();
        btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      });
      els.categoryTabs.appendChild(btn);
    });
  }

  function renderMenuGrid() {
    els.menuGrid.innerHTML = "";
    var items = MENU_DATA.items.filter(function (it) { return it.categoryId === state.categoryId; });

    items.forEach(function (item) {
      var card = document.createElement("div");
      card.className = "menu-card";

      var image = document.createElement("div");
      image.className = "menu-card-image";
      if (item.image) {
        var img = document.createElement("img");
        img.src = item.image;
        img.alt = item.name[state.lang];
        image.appendChild(img);
      } else {
        image.textContent = item.emoji;
      }
      if (item.badge) {
        var badge = document.createElement("span");
        badge.className = "menu-card-badge" + (item.badge === "new" ? " new" : "");
        badge.textContent = t("badge." + item.badge);
        image.appendChild(badge);
      }

      var body = document.createElement("div");
      body.className = "menu-card-body";

      var name = document.createElement("div");
      name.className = "menu-card-name";
      name.textContent = item.name[state.lang];

      var price = document.createElement("div");
      price.className = "menu-card-price";
      price.textContent = formatPrice(item.price);

      var footer = document.createElement("div");
      footer.className = "menu-card-footer";
      renderCardFooter(footer, item);

      body.appendChild(name);
      body.appendChild(price);
      body.appendChild(footer);
      card.appendChild(image);
      card.appendChild(body);
      els.menuGrid.appendChild(card);
    });
  }

  function renderCardFooter(footer, item) {
    footer.innerHTML = "";
    var qty = state.cart[item.id] || 0;

    if (qty === 0) {
      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn-add";
      addBtn.textContent = t("add");
      addBtn.addEventListener("click", function () {
        addToCart(item.id);
        renderCardFooter(footer, item);
        updateOrderBadge();
        showToast(t("toast.added"));
      });
      footer.appendChild(addBtn);
    } else {
      var stepper = document.createElement("div");
      stepper.className = "qty-stepper";

      var minusBtn = document.createElement("button");
      minusBtn.type = "button";
      minusBtn.textContent = "−";
      minusBtn.addEventListener("click", function () {
        decreaseCart(item.id);
        renderCardFooter(footer, item);
        updateOrderBadge();
      });

      var value = document.createElement("span");
      value.className = "qty-value";
      value.textContent = qty;

      var plusBtn = document.createElement("button");
      plusBtn.type = "button";
      plusBtn.textContent = "+";
      plusBtn.addEventListener("click", function () {
        addToCart(item.id);
        renderCardFooter(footer, item);
        updateOrderBadge();
      });

      stepper.appendChild(minusBtn);
      stepper.appendChild(value);
      stepper.appendChild(plusBtn);
      footer.appendChild(stepper);
    }
  }

  function updateOrderBadge() {
    els.orderCountBadge.textContent = cartCount();
  }

  function renderCartModal() {
    els.cartList.innerHTML = "";
    var ids = Object.keys(state.cart).filter(function (id) { return state.cart[id] > 0; });

    if (ids.length === 0) {
      els.cartEmpty.classList.remove("hidden");
      els.cartList.classList.add("hidden");
      els.btnConfirmOrder.setAttribute("disabled", "disabled");
    } else {
      els.cartEmpty.classList.add("hidden");
      els.cartList.classList.remove("hidden");
      els.btnConfirmOrder.removeAttribute("disabled");

      ids.forEach(function (id) {
        var item = findItem(id);
        var qty = state.cart[id];
        var row = document.createElement("div");
        row.className = "cart-item";

        var emoji = document.createElement("div");
        emoji.className = "cart-item-emoji";
        emoji.textContent = item.emoji;

        var info = document.createElement("div");
        info.className = "cart-item-info";
        var name = document.createElement("div");
        name.className = "cart-item-name";
        name.textContent = item.name[state.lang];
        var unitPrice = document.createElement("div");
        unitPrice.className = "cart-item-unit-price";
        unitPrice.textContent = formatPrice(item.price);
        info.appendChild(name);
        info.appendChild(unitPrice);

        var right = document.createElement("div");
        right.className = "cart-item-right";

        var linePrice = document.createElement("div");
        linePrice.className = "cart-item-line-price";
        linePrice.textContent = formatPrice(item.price * qty);

        var stepper = document.createElement("div");
        stepper.className = "qty-stepper";
        var minusBtn = document.createElement("button");
        minusBtn.type = "button";
        minusBtn.textContent = "−";
        minusBtn.addEventListener("click", function () {
          decreaseCart(id);
          renderCartModal();
          renderMenuGrid();
          updateOrderBadge();
        });
        var value = document.createElement("span");
        value.className = "qty-value";
        value.textContent = qty;
        var plusBtn = document.createElement("button");
        plusBtn.type = "button";
        plusBtn.textContent = "+";
        plusBtn.addEventListener("click", function () {
          addToCart(id);
          renderCartModal();
          renderMenuGrid();
          updateOrderBadge();
        });
        stepper.appendChild(minusBtn);
        stepper.appendChild(value);
        stepper.appendChild(plusBtn);

        right.appendChild(linePrice);
        right.appendChild(stepper);

        row.appendChild(emoji);
        row.appendChild(info);
        row.appendChild(right);
        els.cartList.appendChild(row);
      });
    }

    els.cartTotalAmount.textContent = formatPrice(cartTotal());
  }

  function renderTablePicker() {
    els.tablePickerGrid.innerHTML = "";
    for (var n = 1; n <= CONFIG.tableCount; n++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "table-picker-btn" + (state.tableNumber === n ? " active" : "");
      btn.textContent = n;
      btn.addEventListener("click", function () {
        setTableNumber(parseInt(this.textContent, 10));
        closeTableModal();
      });
      els.tablePickerGrid.appendChild(btn);
    }
  }

  function setTableNumber(n) {
    state.tableNumber = n;
    localStorage.setItem("tableOrderTableNumber", String(n));
    els.tableNumberDisplay.textContent = n;
  }

  function openTableModal(forced) {
    renderTablePicker();
    els.btnCloseTableModal.classList.toggle("hidden", !!forced);
    els.tableModalOverlay.classList.remove("hidden");
  }

  function closeTableModal() {
    els.tableModalOverlay.classList.add("hidden");
  }

  function applyStaticI18n() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    els.langLabel.textContent = state.lang === "ko" ? "EN" : "한국어";
  }

  function renderAll() {
    applyStaticI18n();
    renderCategoryTabs();
    renderMenuGrid();
    updateOrderBadge();
    els.tableNumberDisplay.textContent = state.tableNumber || "-";
  }

  // ---------- Cart mutations ----------

  function addToCart(itemId) {
    state.cart[itemId] = (state.cart[itemId] || 0) + 1;
  }

  function decreaseCart(itemId) {
    if (!state.cart[itemId]) return;
    state.cart[itemId] -= 1;
    if (state.cart[itemId] <= 0) delete state.cart[itemId];
  }

  // ---------- Events ----------

  els.catPrev.addEventListener("click", function () {
    els.categoryTabs.scrollBy({ left: -160, behavior: "smooth" });
  });
  els.catNext.addEventListener("click", function () {
    els.categoryTabs.scrollBy({ left: 160, behavior: "smooth" });
  });

  els.btnLang.addEventListener("click", function () {
    state.lang = state.lang === "ko" ? "en" : "ko";
    renderAll();
  });

  els.btnCallStaff.addEventListener("click", function () {
    showToast(t("toast.staffCalled"));
    if (db && state.tableNumber) {
      db.ref("tableOrders/staffCalls").push({
        tableNumber: state.tableNumber,
        status: "pending",
        createdAt: firebase.database.ServerValue.TIMESTAMP,
      }).catch(function (err) {
        console.error("Staff call failed", err);
      });
    }
  });

  els.btnTableBadge.addEventListener("click", function () {
    openTableModal(false);
  });
  els.btnCloseTableModal.addEventListener("click", closeTableModal);

  els.btnCoupon.addEventListener("click", function () {
    els.couponModalOverlay.classList.remove("hidden");
  });
  els.btnCloseCoupon.addEventListener("click", function () {
    els.couponModalOverlay.classList.add("hidden");
  });

  function openCartModal() {
    renderCartModal();
    els.cartModalOverlay.classList.remove("hidden");
  }
  function closeCartModal() {
    els.cartModalOverlay.classList.add("hidden");
  }

  els.btnOrderHistory.addEventListener("click", openCartModal);
  els.btnPlaceOrder.addEventListener("click", openCartModal);
  els.btnCloseCart.addEventListener("click", closeCartModal);

  [els.cartModalOverlay, els.couponModalOverlay].forEach(function (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.classList.add("hidden");
    });
  });

  els.btnConfirmOrder.addEventListener("click", function () {
    if (cartCount() === 0) return;
    if (!state.tableNumber) {
      closeCartModal();
      openTableModal(true);
      return;
    }
    if (!db) {
      showToast(t("toast.orderFailed"));
      return;
    }

    var ids = Object.keys(state.cart).filter(function (id) { return state.cart[id] > 0; });
    var items = ids.map(function (id) {
      var item = findItem(id);
      return { id: id, name: item.name.ko, qty: state.cart[id], price: item.price };
    });
    var order = {
      tableNumber: state.tableNumber,
      items: items,
      totalAmount: cartTotal(),
      status: "pending",
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    };

    els.btnConfirmOrder.setAttribute("disabled", "disabled");
    db.ref("tableOrders/orders").push(order)
      .then(function () {
        showToast(t("toast.orderPlaced"));
        state.cart = {};
        closeCartModal();
        renderMenuGrid();
        updateOrderBadge();
      })
      .catch(function (err) {
        console.error("Order submit failed", err);
        showToast(t("toast.orderFailed"));
        els.btnConfirmOrder.removeAttribute("disabled");
      });
  });

  renderAll();
  if (!state.tableNumber) openTableModal(true);
})();
