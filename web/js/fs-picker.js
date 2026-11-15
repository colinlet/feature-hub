(() => {
  const overlay = document.getElementById("fsPickerOverlay");
  const titleEl = document.getElementById("fsPickerTitle");
  const listEl = document.getElementById("fsPickerList");
  const shortcutsEl = document.getElementById("fsPickerShortcuts");
  const pathInput = document.getElementById("fsPickerPath");
  const errorEl = document.getElementById("fsPickerError");
  const upBtn = document.getElementById("fsPickerUpBtn");
  const goBtn = document.getElementById("fsPickerGoBtn");
  const closeBtn = document.getElementById("fsPickerCloseBtn");
  const cancelBtn = document.getElementById("fsPickerCancelBtn");
  const confirmBtn = document.getElementById("fsPickerConfirmBtn");

  if (!overlay || !listEl || !pathInput) return;

  let currentPath = "";
  let parentPath = null;
  let multi = true;
  /** @type {any[]} */
  let lastEntries = [];
  /** @type {any[]} */
  let lastShortcuts = [];
  /** @type {Set<string>} */
  let selected = new Set();
  /** @type {null | ((paths: string[]) => void)} */
  let onPick = null;

  function t(key, vars) {
    return window.FeatureHubI18n?.t?.(key, vars) ?? key;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  async function api(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function setError(message) {
    if (!errorEl) return;
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function syncConfirmLabel() {
    if (!confirmBtn) return;
    if (!multi) {
      confirmBtn.textContent = t("fs.confirm");
      return;
    }
    const n = selected.size;
    confirmBtn.textContent = n
      ? t("fs.confirmMulti", { count: n })
      : t("fs.confirmCurrent");
  }

  function syncTitle() {
    if (!titleEl) return;
    titleEl.textContent = multi ? t("fs.title") : t("fs.titleSingle");
  }

  function renderShortcuts(items) {
    lastShortcuts = items || [];
    if (!shortcutsEl) return;
    shortcutsEl.innerHTML = "";
    for (const item of lastShortcuts) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fs-chip";
      btn.textContent = item.label;
      btn.addEventListener("click", () => load(item.path).catch(() => {}));
      shortcutsEl.appendChild(btn);
    }
  }

  function toggleSelect(path) {
    if (selected.has(path)) selected.delete(path);
    else selected.add(path);
    syncConfirmLabel();
  }

  function renderEntries(entries) {
    lastEntries = entries || [];
    listEl.innerHTML = "";
    if (!lastEntries.length) {
      listEl.innerHTML = `<div class="empty-hint">${escapeHtml(t("fs.empty"))}</div>`;
      return;
    }
    for (const entry of lastEntries) {
      const row = document.createElement("div");
      row.className = `fs-row${selected.has(entry.path) ? " is-selected" : ""}`;

      if (multi) {
        const check = document.createElement("input");
        check.type = "checkbox";
        check.className = "fs-check";
        check.checked = selected.has(entry.path);
        check.title = t("fs.checkTitle");
        check.addEventListener("click", (ev) => ev.stopPropagation());
        check.addEventListener("change", () => {
          if (check.checked) selected.add(entry.path);
          else selected.delete(entry.path);
          row.classList.toggle("is-selected", check.checked);
          syncConfirmLabel();
        });
        row.appendChild(check);
      }

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "fs-open";
      openBtn.innerHTML = `<span class="icon type-dir">DIR</span><span class="name">${escapeHtml(
        entry.name
      )}</span>`;
      openBtn.addEventListener("click", () => load(entry.path).catch(() => {}));
      row.appendChild(openBtn);

      if (multi) {
        const pickBtn = document.createElement("button");
        pickBtn.type = "button";
        pickBtn.className = "btn ghost compact nowrap";
        pickBtn.textContent = selected.has(entry.path) ? t("fs.selected") : t("fs.select");
        pickBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          toggleSelect(entry.path);
          renderEntries(lastEntries);
        });
        row.appendChild(pickBtn);
      }

      listEl.appendChild(row);
    }
  }

  async function load(path) {
    setError("");
    const qs = new URLSearchParams();
    if (path) qs.set("path", path);
    const data = await api(`/api/fs/ls?${qs.toString()}`);
    currentPath = data.path || "";
    parentPath = data.parent || null;
    pathInput.value = currentPath;
    upBtn.disabled = !parentPath;
    renderShortcuts(data.shortcuts || []);
    renderEntries(data.entries || []);
    syncConfirmLabel();
  }

  function close() {
    overlay.hidden = true;
    onPick = null;
    selected = new Set();
    setError("");
  }

  function isOpen() {
    return !overlay.hidden;
  }

  async function open(options = {}) {
    multi = options.multi !== false;
    selected = new Set(
      Array.isArray(options.selected) ? options.selected.filter(Boolean) : []
    );
    onPick = typeof options.onPick === "function" ? options.onPick : null;
    syncTitle();
    overlay.hidden = false;
    syncConfirmLabel();
    try {
      await load(options.path || "");
      pathInput.focus();
    } catch (err) {
      setError(err.message || t("fs.openFailed"));
    }
  }

  function confirm() {
    const cb = onPick;
    let paths = [];
    if (multi) {
      paths = selected.size ? [...selected] : currentPath ? [currentPath] : [];
    } else {
      paths = currentPath ? [currentPath] : [];
    }
    if (!paths.length) {
      setError(t("fs.needSelect"));
      return;
    }
    close();
    if (cb) cb(paths);
  }

  upBtn?.addEventListener("click", () => {
    if (parentPath) load(parentPath).catch((err) => setError(err.message));
  });
  goBtn?.addEventListener("click", () => {
    load(pathInput.value.trim()).catch((err) => setError(err.message));
  });
  pathInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      load(pathInput.value.trim()).catch((err) => setError(err.message));
    }
  });
  closeBtn?.addEventListener("click", close);
  cancelBtn?.addEventListener("click", close);
  confirmBtn?.addEventListener("click", confirm);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && isOpen()) {
      ev.preventDefault();
      close();
    }
  });
  window.addEventListener("featurehub:locale-changed", () => {
    if (!isOpen()) return;
    syncTitle();
    syncConfirmLabel();
    renderShortcuts(lastShortcuts);
    renderEntries(lastEntries);
  });

  window.FeatureHubFsPicker = { open, close, isOpen };
})();
