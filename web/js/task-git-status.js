(() => {
  const overlay = document.getElementById("taskGitOverlay");
  const listEl = document.getElementById("taskGitList");
  const errorEl = document.getElementById("taskGitError");
  const closeBtn = document.getElementById("taskGitCloseBtn");
  const doneBtn = document.getElementById("taskGitDoneBtn");
  const refreshBtn = document.getElementById("taskGitRefreshBtn");

  if (!overlay || !listEl) return;

  let root = "";
  let kind = "workspace";
  let loading = false;
  /** @type {any[]} */
  let folders = [];
  /** @type {string | null} */
  let openMenuPath = null;
  /** @type {string | null} */
  let switchingPath = null;

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

  function setLoading(on) {
    loading = on;
    if (refreshBtn) refreshBtn.disabled = on || !!switchingPath;
  }

  function closeMenu() {
    openMenuPath = null;
  }

  function folderKey(item) {
    return String(item.path || item.resolved || "");
  }

  function dirtyLabel(item) {
    const count = typeof item.dirtyCount === "number" ? item.dirtyCount : null;
    return count != null ? t("taskGit.dirtyCount", { count }) : t("taskGit.dirty");
  }

  function renderList() {
    if (loading && !folders.length) {
      listEl.innerHTML = `<div class="task-git-empty">${escapeHtml(t("taskGit.loading"))}</div>`;
      return;
    }
    if (!folders.length) {
      listEl.innerHTML = `<div class="task-git-empty">${escapeHtml(t("taskGit.noRepos"))}</div>`;
      return;
    }
    listEl.innerHTML = "";
    for (const item of folders) {
      const key = folderKey(item);
      const isSwitching = switchingPath === key;
      const menuOpen = openMenuPath === key;
      const branchLabel = item.detached
        ? `${item.branch || "—"} · ${t("taskGit.detached")}`
        : item.branch || "—";
      const branches = Array.isArray(item.branches) ? item.branches : [];
      const dirty = !!item.dirty;
      const rowClass = [
        "task-git-row",
        dirty ? "is-dirty" : "is-clean",
        isSwitching ? "is-switching" : "",
        menuOpen ? "is-menu-open" : "",
      ]
        .filter(Boolean)
        .join(" ");

      let stateHtml = "";
      if (item.error && item.dirty == null) {
        stateHtml = `<span class="task-git-badge is-err" title="${escapeHtml(item.error)}">${escapeHtml(
          item.error
        )}</span>`;
      } else if (dirty) {
        stateHtml = `<span class="task-git-badge is-dirty">${escapeHtml(dirtyLabel(item))}</span>`;
      } else {
        stateHtml = `<span class="task-git-badge is-clean">${escapeHtml(t("taskGit.clean"))}</span>`;
      }

      const branchBtnDisabled = isSwitching || loading;
      const branchBtnTitle = dirty
        ? t("taskGit.switchBlocked")
        : t("taskGit.switchHint");

      let menuHtml = "";
      if (menuOpen) {
        if (!branches.length) {
          menuHtml = `<div class="task-git-menu" role="listbox">
            <div class="task-git-menu-empty">${escapeHtml(t("taskGit.noBranches"))}</div>
          </div>`;
        } else {
          const items = branches
            .map((b) => {
              const current = !item.detached && b === item.branch;
              const disabled = current || dirty || isSwitching;
              return `<button type="button" class="task-git-menu-item${
                current ? " is-current" : ""
              }" data-branch="${escapeHtml(b)}" ${disabled ? "disabled" : ""}>
                <span>${escapeHtml(b)}</span>
                ${
                  current
                    ? `<span class="task-git-menu-tag">${escapeHtml(t("taskGit.currentBranch"))}</span>`
                    : ""
                }
              </button>`;
            })
            .join("");
          menuHtml = `<div class="task-git-menu" role="listbox">${items}</div>`;
        }
      }

      const row = document.createElement("div");
      row.className = rowClass;
      row.dataset.path = key;
      const pathTitle = escapeHtml(item.resolved || item.path || "");
      row.innerHTML = `
        <div class="task-git-row-top">
          <div class="task-git-main">
            <span class="task-git-name">${escapeHtml(item.name || item.path)}</span>
            <span class="task-git-path" title="${pathTitle}">${escapeHtml(item.path || "")}</span>
          </div>
          <div class="task-git-meta">
            <button
              type="button"
              class="task-git-branch${menuOpen ? " is-open" : ""}"
              data-branch-toggle
              ${branchBtnDisabled ? "disabled" : ""}
              title="${escapeHtml(branchBtnTitle)}"
              aria-expanded="${menuOpen ? "true" : "false"}"
            >${escapeHtml(isSwitching ? t("taskGit.switching") : branchLabel)} ▾</button>
            ${stateHtml}
          </div>
        </div>
        ${menuHtml}`;

      row.querySelector("[data-branch-toggle]")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (branchBtnDisabled) return;
        if (dirty) {
          setError(t("taskGit.switchBlocked"));
          return;
        }
        setError("");
        openMenuPath = menuOpen ? null : key;
        renderList();
      });

      row.querySelectorAll("[data-branch]").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const branch = btn.getAttribute("data-branch") || "";
          if (!branch || btn.disabled) return;
          checkoutBranch(item, branch);
        });
      });

      listEl.appendChild(row);
    }
  }

  async function checkoutBranch(item, branch) {
    const key = folderKey(item);
    if (switchingPath || loading) return;
    if (item.dirty) {
      setError(t("taskGit.switchBlocked"));
      closeMenu();
      renderList();
      return;
    }
    setError("");
    switchingPath = key;
    closeMenu();
    renderList();
    try {
      const data = await api("/api/task/git-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root,
          kind,
          path: item.path,
          branch,
        }),
      });
      const next = data.folder;
      if (next && next.isGit) {
        folders = folders.map((f) => (folderKey(f) === key ? next : f));
      } else {
        await load({ quiet: true });
        return;
      }
      renderList();
    } catch (err) {
      setError(err.message || t("taskGit.switchFailed"));
      renderList();
    } finally {
      switchingPath = null;
      renderList();
    }
  }

  async function load(opts = {}) {
    if (!root) return;
    if (!opts.quiet) setError("");
    setLoading(true);
    closeMenu();
    if (!folders.length) renderList();
    try {
      const data = await api(
        `/api/task/git-status?root=${encodeURIComponent(root)}&kind=${encodeURIComponent(kind)}`
      );
      folders = Array.isArray(data.folders) ? data.folders : [];
      renderList();
    } catch (err) {
      setError(err.message || t("taskGit.loadFailed"));
      if (!folders.length) {
        listEl.innerHTML = "";
      }
    } finally {
      setLoading(false);
      renderList();
    }
  }

  async function open(opts = {}) {
    root = String(opts.root || "");
    kind = opts.kind === "archive" ? "archive" : "workspace";
    if (!root) return;
    folders = [];
    switchingPath = null;
    closeMenu();
    setError("");
    overlay.hidden = false;
    renderList();
    await load();
  }

  function close() {
    overlay.hidden = true;
    closeMenu();
    switchingPath = null;
    setError("");
  }

  function isOpen() {
    return !overlay.hidden;
  }

  closeBtn?.addEventListener("click", close);
  doneBtn?.addEventListener("click", close);
  refreshBtn?.addEventListener("click", () => {
    if (!loading && !switchingPath) load();
  });
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) {
      close();
      return;
    }
    if (openMenuPath && !ev.target.closest?.(".task-git-row.is-menu-open")) {
      closeMenu();
      renderList();
    }
  });
  window.addEventListener("keydown", (ev) => {
    if (!isOpen()) return;
    if (ev.key === "Escape") {
      if (window.FeatureHubFsPicker?.isOpen?.()) return;
      if (window.FeatureHubTaskWorkspace?.isOpen?.()) return;
      ev.preventDefault();
      if (openMenuPath) {
        closeMenu();
        renderList();
        return;
      }
      close();
    }
  });
  window.addEventListener("featurehub:locale-changed", () => {
    if (isOpen()) renderList();
  });

  window.FeatureHubTaskGit = {
    open,
    close,
    isOpen,
  };
})();
