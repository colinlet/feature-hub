(() => {
  const overlay = document.getElementById("taskWsOverlay");
  const form = document.getElementById("taskWsForm");
  const foldersEl = document.getElementById("taskWsFolders");
  const errorEl = document.getElementById("taskWsError");
  const closeBtn = document.getElementById("taskWsCloseBtn");
  const cancelBtn = document.getElementById("taskWsCancelBtn");
  const saveBtn = document.getElementById("taskWsSaveBtn");
  const browseBtn = document.getElementById("taskWsBrowseBtn");
  const poolBtn = document.getElementById("taskWsPoolBtn");

  if (!overlay || !form || !foldersEl) return;

  /** @type {{ name: string, path: string, locked?: boolean, resolved?: string }[]} */
  let folders = [];
  /** @type {string[]} */
  let repoRootPool = [];
  let root = "";
  let kind = "workspace";
  let saving = false;

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

  async function api(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.payload = data;
      throw err;
    }
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

  function folderKey(item) {
    return String(item.resolved || item.path || "");
  }

  function renderFolders() {
    foldersEl.innerHTML = "";
    if (!folders.length) {
      foldersEl.innerHTML = `<div class="repo-empty">${escapeHtml(t("taskWs.empty"))}</div>`;
      return;
    }
    for (const item of folders) {
      const chip = document.createElement("div");
      chip.className = `repo-chip${item.locked ? " is-locked" : ""}`;
      const removeBtn = item.locked
        ? `<span class="repo-chip-lock" title="${escapeHtml(t("taskWs.locked"))}">*</span>`
        : `<button type="button" class="repo-chip-remove" aria-label="${escapeHtml(
            t("taskWs.remove")
          )}">×</button>`;
      chip.innerHTML = `
        <span class="repo-chip-name">${escapeHtml(item.name || item.path)}</span>
        <span class="repo-chip-path" title="${escapeHtml(item.path)}">${escapeHtml(item.path)}</span>
        ${removeBtn}`;
      if (!item.locked) {
        chip.querySelector(".repo-chip-remove")?.addEventListener("click", () => {
          const key = folderKey(item);
          folders = folders.filter((f) => folderKey(f) !== key);
          renderFolders();
        });
      }
      foldersEl.appendChild(chip);
    }
  }

  function addFolders(paths) {
    const next = [...folders];
    const seen = new Set(next.map(folderKey));
    for (const raw of paths || []) {
      const path = String(raw || "").trim();
      if (!path || path === "." || path === "./") continue;
      if (seen.has(path)) continue;
      seen.add(path);
      const name = path.split(/[/\\]/).filter(Boolean).pop() || path;
      next.push({ name, path });
    }
    folders = next;
    renderFolders();
  }

  async function open(opts = {}) {
    root = String(opts.root || "");
    kind = opts.kind === "archive" ? "archive" : "workspace";
    if (!root) return;
    setError("");
    folders = [];
    repoRootPool = [];
    renderFolders();
    overlay.hidden = false;
    try {
      const [data, cfg] = await Promise.all([
        api(
          `/api/task/workspace?root=${encodeURIComponent(root)}&kind=${encodeURIComponent(kind)}`
        ),
        api("/api/config").catch(() => null),
      ]);
      if (!data.editable) {
        setError(t("taskWs.notEditable"));
      }
      folders = (data.folders || []).map((f) => ({
        name: f.name,
        path: f.path,
        locked: !!f.locked || f.path === ".",
        resolved: f.resolved,
      }));
      if (cfg && Array.isArray(cfg.repoRoots)) {
        repoRootPool = cfg.repoRoots.filter(Boolean);
      }
      if (poolBtn) poolBtn.hidden = !repoRootPool.length;
      renderFolders();
    } catch (err) {
      setError(err.message || t("taskWs.loadFailed"));
    }
  }

  function close() {
    overlay.hidden = true;
    setError("");
  }

  function isOpen() {
    return !overlay.hidden;
  }

  async function save(ev) {
    ev.preventDefault();
    if (saving) return;
    saving = true;
    if (saveBtn) saveBtn.disabled = true;
    setError("");
    try {
      await api("/api/task/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root,
          kind,
          folders: folders.map((f) => ({ name: f.name, path: f.path })),
        }),
      });
      window.dispatchEvent(
        new CustomEvent("featurehub:task-workspace-saved", {
          detail: { root, kind },
        })
      );
      close();
    } catch (err) {
      setError(err.message || t("taskWs.saveFailed"));
    } finally {
      saving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function openInCursor(opts = {}) {
    const r = String(opts.root || "");
    const k = opts.kind === "archive" ? "archive" : "workspace";
    if (!r) throw new Error(t("taskWs.openFailed"));
    return api("/api/task/open-cursor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: r, kind: k }),
    });
  }

  form.addEventListener("submit", save);
  closeBtn?.addEventListener("click", close);
  cancelBtn?.addEventListener("click", close);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  browseBtn?.addEventListener("click", () => {
    if (!window.FeatureHubFsPicker) {
      setError(t("newTask.pickerMissing"));
      return;
    }
    const selected = folders.filter((f) => !f.locked).map((f) => f.resolved || f.path);
    window.FeatureHubFsPicker.open({
      multi: true,
      selected,
      path: selected[0] || repoRootPool[0] || "",
      onPick: (paths) => addFolders(Array.isArray(paths) ? paths : [paths]),
    });
  });
  poolBtn?.addEventListener("click", () => {
    if (!repoRootPool.length) {
      setError(t("taskWs.poolEmpty"));
      return;
    }
    addFolders(repoRootPool);
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && isOpen() && !window.FeatureHubFsPicker?.isOpen?.()) {
      ev.preventDefault();
      close();
    }
  });
  window.addEventListener("featurehub:locale-changed", () => {
    if (isOpen()) renderFolders();
  });

  window.FeatureHubTaskWorkspace = {
    open,
    close,
    isOpen,
    openInCursor,
  };
})();
