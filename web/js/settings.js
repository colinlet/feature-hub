(() => {
  const DIR_KEYS = [
    { key: "workspace", labelKey: "settings.dir.workspace", helpKey: "settings.dir.workspaceHelp" },
    { key: "knowledge", labelKey: "settings.dir.knowledge", helpKey: "settings.dir.knowledgeHelp" },
    { key: "archive", labelKey: "settings.dir.archive", helpKey: "settings.dir.archiveHelp" },
    { key: "tools", labelKey: "settings.dir.tools", helpKey: "settings.dir.toolsHelp" },
  ];

  const overlay = document.getElementById("settingsOverlay");
  const fieldsEl = document.getElementById("settingsFields");
  const form = document.getElementById("settingsForm");
  const errorEl = document.getElementById("settingsError");
  const saveBtn = document.getElementById("settingsSaveBtn");
  const openBtn = document.getElementById("settingsBtn");
  const closeBtn = document.getElementById("settingsCloseBtn");
  const cancelBtn = document.getElementById("settingsCancelBtn");

  if (!overlay || !fieldsEl || !form || !openBtn) return;

  /** @type {Record<string, HTMLInputElement>} */
  const inputs = {};
  /** @type {Record<string, HTMLElement>} */
  const statuses = {};
  /** @type {Record<string, HTMLElement>} */
  const fieldBoxes = {};
  /** @type {Record<string, any>} */
  let lastStatus = {};
  /** @type {string[]} */
  let repoRoots = [];
  /** @type {HTMLInputElement | null} */
  let repoInput = null;
  /** @type {HTMLElement | null} */
  let reposEl = null;
  /** @type {HTMLElement | null} */
  let repoStatusEl = null;
  let validateTimer = null;
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

  function syncRepoStatus(statusesList) {
    if (!repoStatusEl || !fieldBoxes.repoRoots) return;
    lastStatus.repoRoots = statusesList || null;
    fieldBoxes.repoRoots.classList.remove("is-invalid");
    if (statusesList && Array.isArray(statusesList)) {
      const bad = statusesList.find((item) => item && !item.ok);
      if (bad) {
        repoStatusEl.className = "field-status err";
        repoStatusEl.textContent = bad.error || t("settings.pathInvalid");
        fieldBoxes.repoRoots.classList.add("is-invalid");
        return;
      }
    }
    if (!repoRoots.length) {
      repoStatusEl.className = "field-status";
      repoStatusEl.textContent = "";
      return;
    }
    repoStatusEl.className = "field-status ok";
    repoStatusEl.textContent = t("settings.dir.reposCount", { count: repoRoots.length });
  }

  function renderRepos() {
    if (!reposEl) return;
    reposEl.innerHTML = "";
    if (!repoRoots.length) {
      reposEl.innerHTML = `<div class="repo-empty">${escapeHtml(t("settings.dir.reposEmpty"))}</div>`;
      syncRepoStatus(lastStatus.repoRoots);
      return;
    }
    for (const path of repoRoots) {
      const chip = document.createElement("div");
      chip.className = "repo-chip";
      chip.innerHTML = `
        <span class="repo-chip-path" title="${escapeHtml(path)}">${escapeHtml(path)}</span>
        <button type="button" class="repo-chip-remove" aria-label="${escapeHtml(
          t("settings.dir.reposRemove")
        )}">×</button>`;
      chip.querySelector(".repo-chip-remove")?.addEventListener("click", () => {
        repoRoots = repoRoots.filter((p) => p !== path);
        renderRepos();
      });
      reposEl.appendChild(chip);
    }
    syncRepoStatus(lastStatus.repoRoots);
  }

  function addRepos(paths) {
    const next = [...repoRoots];
    for (const raw of paths || []) {
      const path = String(raw || "").trim();
      if (!path || next.includes(path)) continue;
      next.push(path);
    }
    repoRoots = next;
    lastStatus.repoRoots = null;
    renderRepos();
  }

  async function addRepoFromInput() {
    if (!repoInput) return false;
    const raw = repoInput.value.trim();
    if (!raw) return false;
    const data = await api("/api/config/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoRoots: [raw] }),
    });
    const status = data.fields?.repoRoots?.[0];
    if (!status?.ok) {
      syncRepoStatus(status ? [status] : [{ ok: false, error: t("settings.pathInvalid") }]);
      return false;
    }
    addRepos([status.raw || raw]);
    repoInput.value = "";
    return true;
  }

  function buildDirField(meta) {
    const box = document.createElement("div");
    box.className = "settings-field";
    box.dataset.key = meta.key;
    box.innerHTML = `
      <label for="settings-${meta.key}">${escapeHtml(t(meta.labelKey))}</label>
      <div class="field-help">${escapeHtml(t(meta.helpKey))}</div>
      <input id="settings-${meta.key}" name="${meta.key}" type="text" spellcheck="false" autocomplete="off" />
      <div class="field-status" data-status-for="${meta.key}"></div>`;
    fieldsEl.appendChild(box);
    const input = box.querySelector("input");
    const status = box.querySelector(".field-status");
    inputs[meta.key] = input;
    statuses[meta.key] = status;
    fieldBoxes[meta.key] = box;
    input.addEventListener("input", () => scheduleValidate(meta.key));
    input.addEventListener("blur", () => validateOne(meta.key));
  }

  function buildReposField() {
    const box = document.createElement("div");
    box.className = "settings-field";
    box.dataset.key = "repoRoots";
    box.innerHTML = `
      <label>${escapeHtml(t("settings.dir.repos"))}</label>
      <div class="field-help">${escapeHtml(t("settings.dir.reposHelp"))}</div>
      <div class="repo-chips" id="settingsRepos"></div>
      <div class="field-row">
        <input
          id="settings-repoRoots"
          name="repoRootsInput"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="${escapeHtml(t("settings.dir.reposPlaceholder"))}"
        />
        <button type="button" class="btn ghost nowrap" id="settingsReposBrowseBtn">
          ${escapeHtml(t("settings.dir.reposBrowse"))}
        </button>
      </div>
      <div class="field-status" id="settingsReposStatus"></div>`;
    fieldsEl.appendChild(box);
    fieldBoxes.repoRoots = box;
    reposEl = box.querySelector("#settingsRepos");
    repoInput = box.querySelector("#settings-repoRoots");
    repoStatusEl = box.querySelector("#settingsReposStatus");
    repoInput?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        addRepoFromInput().catch((err) => setFormError(err.message || t("settings.saveFailed")));
      }
    });
    box.querySelector("#settingsReposBrowseBtn")?.addEventListener("click", () => {
      if (!window.FeatureHubFsPicker) {
        setFormError(t("newTask.pickerMissing"));
        return;
      }
      window.FeatureHubFsPicker.open({
        multi: true,
        selected: repoRoots,
        path: repoRoots[0] || "",
        onPick: (paths) => {
          addRepos(Array.isArray(paths) ? paths : [paths]);
        },
      });
    });
    renderRepos();
  }

  function buildFields() {
    const values = {};
    for (const meta of DIR_KEYS) {
      values[meta.key] = inputs[meta.key]?.value || "";
    }
    const keptRepos = [...repoRoots];
    fieldsEl.innerHTML = "";
    for (const key of Object.keys(inputs)) delete inputs[key];
    for (const key of Object.keys(statuses)) delete statuses[key];
    for (const key of Object.keys(fieldBoxes)) delete fieldBoxes[key];
    repoInput = null;
    reposEl = null;
    repoStatusEl = null;

    buildDirField(DIR_KEYS[0]);
    buildReposField();
    for (let i = 1; i < DIR_KEYS.length; i += 1) {
      buildDirField(DIR_KEYS[i]);
    }

    for (const meta of DIR_KEYS) {
      inputs[meta.key].value = values[meta.key] || "";
      if (lastStatus[meta.key]) applyFieldStatus(meta.key, lastStatus[meta.key]);
    }
    repoRoots = keptRepos;
    renderRepos();
  }

  function setStatus(key, kind, text) {
    const el = statuses[key];
    const box = fieldBoxes[key];
    if (!el || !box) return;
    el.className = `field-status${kind ? ` ${kind}` : ""}`;
    el.textContent = text || "";
    box.classList.toggle("is-invalid", kind === "err");
  }

  function applyFieldStatus(key, status) {
    lastStatus[key] = status || null;
    if (!status) {
      setStatus(key, "", "");
      return;
    }
    if (!status.ok) {
      setStatus(key, "err", status.error || t("settings.pathInvalid"));
      return;
    }
    if (status.exists) {
      setStatus(key, "ok", t("settings.pathOk", { path: status.resolved || "" }));
      return;
    }
    setStatus(key, "warn", t("settings.pathWarn", { path: status.resolved || "" }));
  }

  function scheduleValidate(key) {
    if (validateTimer) clearTimeout(validateTimer);
    validateTimer = setTimeout(() => {
      validateOne(key).catch(() => {});
    }, 280);
  }

  async function validateOne(key) {
    const input = inputs[key];
    if (!input) return null;
    const status = await api("/api/config/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, path: input.value }),
    });
    applyFieldStatus(key, status);
    return status;
  }

  async function validateAll() {
    if (repoInput?.value.trim()) {
      const ok = await addRepoFromInput();
      if (!ok) {
        return { ok: false, fields: { repoRoots: lastStatus.repoRoots || [] } };
      }
    }
    const body = { repoRoots };
    for (const meta of DIR_KEYS) body[meta.key] = inputs[meta.key].value;
    const data = await api("/api/config/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    for (const meta of DIR_KEYS) {
      applyFieldStatus(meta.key, data.fields?.[meta.key]);
    }
    syncRepoStatus(data.fields?.repoRoots);
    return data;
  }

  function fillFromConfig(cfg) {
    for (const meta of DIR_KEYS) {
      const dir = cfg.dirs?.[meta.key];
      inputs[meta.key].value = dir?.raw || cfg[meta.key] || "";
      applyFieldStatus(meta.key, dir);
    }
    const entries = Array.isArray(cfg.repoRootEntries)
      ? cfg.repoRootEntries
      : (cfg.repoRoots || []).map((raw) => ({ raw, ok: true }));
    repoRoots = entries.map((item) => item.raw || item).filter(Boolean);
    lastStatus.repoRoots = entries;
    renderRepos();
  }

  function setFormError(message) {
    if (!errorEl) return;
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  async function open() {
    setFormError("");
    overlay.hidden = false;
    openBtn.setAttribute("aria-expanded", "true");
    try {
      const cfg = await api("/api/config");
      fillFromConfig(cfg);
      inputs.workspace?.focus();
      inputs.workspace?.select();
    } catch (err) {
      setFormError(err.message || t("settings.loadFailed"));
    }
  }

  function close() {
    overlay.hidden = true;
    openBtn.setAttribute("aria-expanded", "false");
    setFormError("");
  }

  function isOpen() {
    return !overlay.hidden;
  }

  async function save(ev) {
    ev.preventDefault();
    if (saving) return;
    saving = true;
    saveBtn.disabled = true;
    setFormError("");
    try {
      const check = await validateAll();
      if (!check.ok) {
        setFormError(t("settings.fixInvalid"));
        return;
      }
      const body = { repoRoots };
      for (const meta of DIR_KEYS) body[meta.key] = inputs[meta.key].value.trim();
      const cfg = await api("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      fillFromConfig(cfg);
      window.dispatchEvent(
        new CustomEvent("featurehub:config-saved", {
          detail: cfg,
        })
      );
      close();
    } catch (err) {
      const fields = err.payload?.fields;
      if (fields) {
        for (const meta of DIR_KEYS) {
          if (fields[meta.key]) applyFieldStatus(meta.key, fields[meta.key]);
        }
        if (fields.repoRoots) syncRepoStatus(fields.repoRoots);
      }
      setFormError(err.message || t("settings.saveFailed"));
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  }

  buildFields();
  openBtn.addEventListener("click", () => {
    if (isOpen()) close();
    else open();
  });
  closeBtn?.addEventListener("click", close);
  cancelBtn?.addEventListener("click", close);
  form.addEventListener("submit", save);
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
    buildFields();
  });

  window.FeatureHubSettings = {
    open,
    close,
    isOpen,
  };
})();
