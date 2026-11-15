(() => {
  const overlay = document.getElementById("newTaskOverlay");
  const form = document.getElementById("newTaskForm");
  const nameInput = document.getElementById("newTaskName");
  const repoInput = document.getElementById("newTaskRepo");
  const reposEl = document.getElementById("newTaskRepos");
  const previewEl = document.getElementById("newTaskPreview");
  const repoStatusEl = document.getElementById("newTaskRepoStatus");
  const errorEl = document.getElementById("newTaskError");
  const openBtn = document.getElementById("newTaskBtn");
  const closeBtn = document.getElementById("newTaskCloseBtn");
  const cancelBtn = document.getElementById("newTaskCancelBtn");
  const saveBtn = document.getElementById("newTaskSaveBtn");
  const browseBtn = document.getElementById("newTaskBrowseBtn");

  if (!overlay || !form || !nameInput || !openBtn) return;

  let nextPrefix = "";
  let saving = false;
  /** @type {string[]} */
  let repos = [];
  /** @type {string[]} */
  let repoRootPool = [];

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

  function updatePreview() {
    const title = nameInput.value.trim();
    if (!nextPrefix) {
      previewEl.textContent = t("newTask.preview");
      return;
    }
    previewEl.className = "field-status ok";
    previewEl.textContent = title
      ? t("newTask.previewNamed", { name: `${nextPrefix}-${title}` })
      : t("newTask.previewEmpty", { prefix: nextPrefix });
  }

  function renderRepos() {
    if (!reposEl) return;
    reposEl.innerHTML = "";
    if (!repos.length) {
      reposEl.innerHTML = `<div class="repo-empty">${escapeHtml(t("newTask.noneRepos"))}</div>`;
      syncRepoStatus();
      return;
    }
    for (const path of repos) {
      const chip = document.createElement("div");
      chip.className = "repo-chip";
      chip.innerHTML = `
        <span class="repo-chip-path" title="${escapeHtml(path)}">${escapeHtml(path)}</span>
        <button type="button" class="repo-chip-remove" aria-label="${escapeHtml(
          t("newTask.removeRepo")
        )}">×</button>`;
      chip.querySelector(".repo-chip-remove")?.addEventListener("click", () => {
        repos = repos.filter((p) => p !== path);
        renderRepos();
      });
      reposEl.appendChild(chip);
    }
    syncRepoStatus();
  }

  function syncRepoStatus() {
    if (!repoStatusEl) return;
    if (!repos.length) {
      repoStatusEl.className = "field-status";
      repoStatusEl.textContent = "";
      return;
    }
    repoStatusEl.className = "field-status ok";
    repoStatusEl.textContent = t("newTask.repoCount", { count: repos.length });
  }

  function addRepos(paths) {
    const next = [...repos];
    for (const raw of paths || []) {
      const path = String(raw || "").trim();
      if (!path || next.includes(path)) continue;
      next.push(path);
    }
    repos = next;
    renderRepos();
  }

  async function refreshNextId() {
    const data = await api("/api/tasks/next-id");
    nextPrefix = data.nextPrefix || "";
    updatePreview();
  }

  async function addRepoFromInput() {
    const raw = repoInput.value.trim();
    if (!raw) return false;
    const status = await api("/api/config/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: raw, requireExists: true }),
    });
    if (!status.ok) {
      repoStatusEl.className = "field-status err";
      repoStatusEl.textContent = status.error || t("settings.pathInvalid");
      return false;
    }
    addRepos([status.resolved || raw]);
    repoInput.value = "";
    return true;
  }

  async function open() {
    setError("");
    nameInput.value = "";
    repoInput.value = "";
    repos = [];
    repoRootPool = [];
    renderRepos();
    updatePreview();
    overlay.hidden = false;
    try {
      const [_, cfg] = await Promise.all([
        refreshNextId(),
        api("/api/config").catch(() => null),
      ]);
      if (cfg && Array.isArray(cfg.repoRoots)) {
        repoRootPool = cfg.repoRoots.filter(Boolean);
      }
      nameInput.focus();
    } catch (err) {
      setError(err.message || t("newTask.nextIdFailed"));
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
    const title = nameInput.value.trim();
    if (!title) {
      setError(t("newTask.needTitle"));
      nameInput.focus();
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    setError("");
    try {
      if (repoInput.value.trim()) {
        const ok = await addRepoFromInput();
        if (!ok) {
          setError(t("newTask.fixRepo"));
          return;
        }
      }
      const body = { title, repos };
      const data = await api("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      window.dispatchEvent(
        new CustomEvent("featurehub:task-created", {
          detail: data.task,
        })
      );
      close();
    } catch (err) {
      setError(err.message || t("newTask.createFailed"));
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  }

  openBtn.addEventListener("click", () => {
    if (isOpen()) close();
    else open();
  });
  closeBtn?.addEventListener("click", close);
  cancelBtn?.addEventListener("click", close);
  form.addEventListener("submit", save);
  nameInput.addEventListener("input", updatePreview);
  repoInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      addRepoFromInput().catch((err) => setError(err.message || t("newTask.createFailed")));
    }
  });
  browseBtn?.addEventListener("click", () => {
    if (!window.FeatureHubFsPicker) {
      setError(t("newTask.pickerMissing"));
      return;
    }
    window.FeatureHubFsPicker.open({
      multi: true,
      selected: repos,
      path: repos[0] || repoRootPool[0] || "",
      onPick: (paths) => {
        addRepos(Array.isArray(paths) ? paths : [paths]);
      },
    });
  });
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && isOpen() && !window.FeatureHubFsPicker?.isOpen?.()) {
      ev.preventDefault();
      close();
    }
  });
  window.addEventListener("featurehub:locale-changed", () => {
    updatePreview();
    renderRepos();
  });

  window.FeatureHubNewTask = { open, close, isOpen };
})();
