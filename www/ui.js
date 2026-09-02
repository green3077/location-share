function toast(message, duration = 2500) {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function confirmDialog(message, { okText = "확인", cancelText = "취소" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("confirm-overlay");
    overlay.innerHTML = `
      <div class="confirm-box">
        <p>${message}</p>
        <div class="confirm-actions">
          <button class="btn-secondary" id="confirmCancel">${cancelText}</button>
          <button class="btn-primary" id="confirmOk">${okText}</button>
        </div>
      </div>`;
    overlay.classList.remove("hidden");
    const cleanup = (result) => {
      overlay.classList.add("hidden");
      overlay.innerHTML = "";
      resolve(result);
    };
    overlay.querySelector("#confirmOk").addEventListener("click", () => cleanup(true));
    overlay.querySelector("#confirmCancel").addEventListener("click", () => cleanup(false));
  });
}
