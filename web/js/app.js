(() => {
  const viewBrowse = document.getElementById("view-browse");
  const viewRead = document.getElementById("view-read");
  const navBar = document.getElementById("navBar");
  const crumbsEl = document.getElementById("crumbs");
  const homeHeading = document.getElementById("homeHeading");
  const topTaskMeta = document.getElementById("topTaskMeta");
  const topNavActions = document.getElementById("topNavActions");
  const settingsBtn = document.getElementById("settingsBtn");
  const filterAllBtn = document.getElementById("filterAllBtn");
  const filterActiveBtn = document.getElementById("filterActiveBtn");
  const filterDoneBtn = document.getElementById("filterDoneBtn");
  const refreshIndexBtn = document.getElementById("refreshIndexBtn");
  const entryFilter = document.getElementById("entryFilter");
  const browseHeader = document.getElementById("browseHeader");
  const fileList = document.getElementById("fileList");
  const outlineEl = document.getElementById("outline");
  const outlinePane = document.getElementById("outlinePane");
  const outlineToggle = document.getElementById("outlineToggle");
  const readerEl = document.getElementById("reader");
  const floatNav = document.getElementById("floatNav");
  const toTopBtn = document.getElementById("toTopBtn");
  const toBottomBtn = document.getElementById("toBottomBtn");
  const OUTLINE_COLLAPSE_KEY = "featurehub:outline-collapsed";
  const appFooterBrand = document.getElementById("appFooterBrand");

  /** @type {any[]} */
  let currentEntries = [];
  /** @type {any[]} */
  let homeEntries = [];
  /** @type {{root:string,path:string}|null} */
  let browseState = null;
  /** @type {{root:string,path:string}|null} */
  let currentFile = null;
  /** @type {number|null} */
  let currentMtimeNs = null;
  /** @type {string|null} */
  let currentContent = null;
  /** @type {string|null} */
  let pendingSearch = null;
  /** @type {"all"|"active"|"done"} */
  let homeFilter = "all";
  let pollTimer = null;
  let ignoreScrollSpyUntil = 0;
  let refreshing = false;

  const POLL_MS = 1200;
  const READING_WPM = 400;

  function t(key, vars) {
    return window.FeatureHubI18n?.t?.(key, vars) ?? key;
  }

  function syncFooterBrand() {
    if (!appFooterBrand) return;
    appFooterBrand.textContent = t("footer.product", {
      year: new Date().getFullYear(),
    });
  }

  marked.setOptions({ gfm: true, breaks: false });

  let mermaidReady = null;

  function isMermaidBlock(codeEl) {
    const cls = codeEl.className || "";
    return (
      /\blanguage-mermaid\b/i.test(cls) ||
      /\blang-mermaid\b/i.test(cls) ||
      codeEl.getAttribute("data-lang") === "mermaid"
    );
  }

  function ensureMermaid() {
    if (typeof mermaid !== "undefined") {
      if (!mermaidReady) {
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "strict",
          fontFamily: "PingFang SC, Hiragino Sans GB, Noto Sans SC, sans-serif",
        });
        mermaidReady = Promise.resolve(true);
      }
      return mermaidReady;
    }
    if (mermaidReady) return mermaidReady;

    mermaidReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/mermaid.min.js";
      script.async = true;
      script.onload = () => {
        try {
          mermaid.initialize({
            startOnLoad: false,
            theme: "neutral",
            securityLevel: "strict",
            fontFamily: "PingFang SC, Hiragino Sans GB, Noto Sans SC, sans-serif",
          });
          resolve(true);
        } catch (err) {
          reject(err);
        }
      };
      script.onerror = () => reject(new Error("failed to load /vendor/mermaid.min.js"));
      document.head.appendChild(script);
    });
    return mermaidReady;
  }

  async function renderMermaidBlocks() {
    const blocks = [...readerEl.querySelectorAll("pre code")].filter(isMermaidBlock);
    if (!blocks.length) return;

    try {
      await ensureMermaid();
    } catch (err) {
      for (const code of blocks) {
        const pre = code.closest("pre") || code.parentElement;
        if (!pre) continue;
        const box = document.createElement("div");
        box.className = "mermaid-error";
        box.textContent = t("reader.mermaidMissing", { message: err.message || err });
        pre.replaceWith(box);
      }
      return;
    }

    const nodes = [];
    for (const code of blocks) {
      const pre = code.closest("pre") || code.parentElement;
      if (!pre) continue;
      const source = code.textContent || "";
      const wrap = document.createElement("div");
      wrap.className = "mermaid";
      wrap.textContent = source;
      pre.replaceWith(wrap);
      nodes.push(wrap);
    }

    if (!nodes.length) return;

    try {
      await mermaid.run({ nodes });
    } catch (err) {
      for (const node of nodes) {
        if (node.querySelector("svg")) continue;
        const source = node.textContent || "";
        try {
          const id = `mmd-${Math.random().toString(36).slice(2, 9)}`;
          const { svg } = await mermaid.render(id, source);
          node.innerHTML = svg;
        } catch (inner) {
          const box = document.createElement("div");
          box.className = "mermaid-error";
          box.innerHTML = `<div>${escapeHtml(
            t("reader.mermaidFail", { message: inner.message || String(inner) })
          )}</div>`;
          const pre = document.createElement("pre");
          pre.textContent = source;
          box.appendChild(pre);
          node.replaceWith(box);
        }
      }
    }
  }

  async function api(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function decodePathSegment(seg) {
    let cur = String(seg || "");
    // Peel accidental double/triple percent-encoding until stable.
    for (let i = 0; i < 3; i++) {
      if (!/%[0-9A-Fa-f]{2}/.test(cur)) break;
      try {
        const next = decodeURIComponent(cur);
        if (next === cur) break;
        cur = next;
      } catch {
        break;
      }
    }
    return cur;
  }

  function encodePath(path) {
    return String(path || "")
      .split("/")
      .filter(Boolean)
      .map((seg) => encodeURIComponent(decodePathSegment(seg)))
      .join("/");
  }

  function measureChromeHeight() {
    const bar = document.querySelector(".topbar");
    const topH = bar ? bar.getBoundingClientRect().height : 56;
    let navH = 0;
    if (document.getElementById("app")?.classList.contains("is-read") && navBar) {
      navH = navBar.getBoundingClientRect().height || 44;
    }
    const chrome = topH + navH;
    document.documentElement.style.setProperty("--topbar-h", `${Math.round(topH)}px`);
    document.documentElement.style.setProperty("--nav-h", `${Math.round(navH || 44)}px`);
    document.documentElement.style.setProperty("--chrome-h", `${Math.round(chrome)}px`);
    return chrome;
  }

  function topbarOffset() {
    return measureChromeHeight() + 14;
  }

  function isOutlineCollapsed() {
    return viewRead.classList.contains("is-outline-collapsed");
  }

  function syncOutlineToggleUi() {
    if (!outlineToggle) return;
    const collapsed = isOutlineCollapsed();
    outlineToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    outlineToggle.textContent = collapsed ? "›" : "‹";
    const label = collapsed ? t("reader.outlineExpand") : t("reader.outlineCollapse");
    outlineToggle.title = label;
    outlineToggle.setAttribute("aria-label", label);
  }

  function setOutlineCollapsed(collapsed, { persist = true } = {}) {
    viewRead.classList.toggle("is-outline-collapsed", Boolean(collapsed));
    syncOutlineToggleUi();
    if (persist) {
      try {
        localStorage.setItem(OUTLINE_COLLAPSE_KEY, collapsed ? "1" : "0");
      } catch {
        /* ignore */
      }
    }
    measureChromeHeight();
  }

  function loadOutlineCollapsedPref() {
    try {
      return localStorage.getItem(OUTLINE_COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function syncHomeFilterButtons() {
    for (const btn of [filterAllBtn, filterActiveBtn, filterDoneBtn]) {
      if (!btn) continue;
      btn.classList.toggle("is-active", btn.dataset.filter === homeFilter);
    }
  }

  function setHomeFilter(next) {
    homeFilter = next === "active" || next === "done" ? next : "all";
    syncHomeFilterButtons();
    const hash = location.hash || "#/";
    const onHome = hash === "#/" || hash === "#" || hash === "";
    if (!onHome || browseState != null) {
      location.hash = "#/";
      return;
    }
    renderEntries();
  }

  function updateTaskStatsMeta() {
    if (!topTaskMeta) return;
    const total = homeEntries.length;
    const done = homeEntries.filter((e) => isDoneEntry(e)).length;
    const active = total - done;
    topTaskMeta.textContent = t("home.meta", { total, active, done });
  }

  function syncHomeOnlyChrome(isHome) {
    navBar?.classList.toggle("is-home", Boolean(isHome));
    if (homeHeading) homeHeading.hidden = !isHome;
    if (topNavActions) topNavActions.hidden = !isHome;
    if (isHome) {
      crumbsEl.innerHTML = "";
      syncHomeFilterButtons();
      updateTaskStatsMeta();
    }
    if (!isHome) {
      window.FeatureHubSettings?.close?.();
      window.FeatureHubNewTask?.close?.();
      window.FeatureHubFsPicker?.close?.();
      window.FeatureHubTaskWorkspace?.close?.();
    }
  }

  function isDoneEntry(entry) {
    return normalizeStatus(entry.status || statusForKind(entry.rootKind)) === "done";
  }

  function normalizeStatus(status) {
    const raw = String(status || "");
    if (raw === "done" || raw === "已完成") return "done";
    return "active";
  }

  function statusLabel(status) {
    return normalizeStatus(status) === "done" ? t("status.done") : t("status.active");
  }

  function showView(name) {
    viewBrowse.hidden = name !== "browse";
    viewRead.hidden = name !== "read";
    document.getElementById("app")?.classList.toggle("is-read", name === "read");
    if (name !== "read") {
      floatNav.hidden = true;
      floatNav.classList.remove("visible");
      stopPolling();
    } else {
      floatNav.hidden = false;
      setOutlineCollapsed(loadOutlineCollapsedPref(), { persist: false });
    }
    requestAnimationFrame(() => measureChromeHeight());
  }

  function setCrumbs(parts) {
    if (!parts.length) {
      crumbsEl.innerHTML = "";
      return;
    }
    crumbsEl.innerHTML = parts
      .map((part, i) => {
        const isLast = i === parts.length - 1;
        const sep = i === 0 ? "" : `<span class="sep">/</span>`;
        if (isLast || !part.href) {
          return `${sep}<span class="current">${escapeHtml(part.label)}</span>`;
        }
        return `${sep}<a href="${part.href}">${escapeHtml(part.label)}</a>`;
      })
      .join("");
  }

  function homeCrumb() {
    return { label: t("home.all"), href: "#/" };
  }

  function taskTitle(root) {
    const name = String(root || "");
    return name.includes("-") ? name.slice(name.indexOf("-") + 1) : name;
  }

  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) {
      const kb = n / 1024;
      return `${kb >= 10 ? kb.toFixed(0) : kb.toFixed(1)} KB`;
    }
    if (n < 1024 * 1024 * 1024) {
      const mb = n / (1024 * 1024);
      return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
    }
    const gb = n / (1024 * 1024 * 1024);
    return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  }

  function formatTaskMeta(entry) {
    const md = entry.mdCount;
    const files = entry.fileCount;
    if (typeof md === "number" && typeof files === "number") {
      return t("file.meta", { md, files });
    }
    return entry.name || "";
  }

  function setBrowseHeader(state) {
    if (!browseHeader) return;
    if (!state) {
      browseHeader.hidden = true;
      browseHeader.innerHTML = "";
      return;
    }
    const status = normalizeStatus(state.status || statusForKind(state.kind));
    const done = status === "done";
    const atRoot = !state.path;
    const title = atRoot
      ? taskTitle(state.root)
      : state.path.split("/").filter(Boolean).pop() || taskTitle(state.root);
    const kind = normalizeKind(state.kind);
    const actions = atRoot
      ? `<div class="browse-actions">
          ${
            kind !== "archive"
              ? `<button type="button" class="btn ghost compact" data-task-ws-edit>${escapeHtml(
                  t("taskWs.edit")
                )}</button>`
              : ""
          }
          <button type="button" class="btn ghost compact" data-task-ws-open>${escapeHtml(
            t("taskWs.openCursor")
          )}</button>
        </div>`
      : "";
    browseHeader.hidden = false;
    browseHeader.innerHTML = `
      <span class="status-pill${done ? " is-done" : ""}">${escapeHtml(statusLabel(status))}</span>
      <h1 class="browse-title">${escapeHtml(title)}</h1>
      ${actions}`;

    if (!atRoot) return;

    browseHeader.querySelector("[data-task-ws-edit]")?.addEventListener("click", () => {
      if (!window.FeatureHubTaskWorkspace) {
        alert(t("taskWs.loadFailed"));
        return;
      }
      window.FeatureHubTaskWorkspace.open({ root: state.root, kind });
    });
    browseHeader.querySelector("[data-task-ws-open]")?.addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      if (!window.FeatureHubTaskWorkspace?.openInCursor) {
        alert(t("taskWs.openFailed"));
        return;
      }
      const prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = t("taskWs.opening");
      try {
        await window.FeatureHubTaskWorkspace.openInCursor({ root: state.root, kind });
      } catch (err) {
        alert(err.message || t("taskWs.openFailed"));
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
  }

  function applyPendingSearch() {
    if (pendingSearch == null) {
      entryFilter.value = "";
      return;
    }
    entryFilter.value = pendingSearch;
    pendingSearch = null;
  }

  function normalizeKind(kind) {
    return kind === "archive" ? "archive" : "workspace";
  }

  function statusForKind(kind) {
    return normalizeKind(kind) === "archive" ? "done" : "active";
  }

  function browseHref(root, path, kind = "workspace") {
    const k = normalizeKind(kind);
    const base = `#/browse/${encodeURIComponent(k)}/${encodeURIComponent(
      decodePathSegment(root)
    )}`;
    if (!path) return base;
    return `${base}/${encodePath(path)}`;
  }

  function readHref(root, path, kind = "workspace") {
    const k = normalizeKind(kind);
    return `#/read/${encodeURIComponent(k)}/${encodeURIComponent(
      decodePathSegment(root)
    )}/${encodePath(path)}`;
  }

  function parseRoute() {
    const hash = (location.hash || "#/").replace(/^#/, "") || "/";
    const segs = hash.split("/").filter(Boolean).map(decodePathSegment);

    if (segs.length === 0) return { name: "home" };

    if (segs[0] === "task" && segs[1]) {
      return {
        name: "browse",
        kind: "workspace",
        root: segs[1],
        path: segs.slice(2).join("/"),
      };
    }

    if (segs[0] === "browse" && segs[1]) {
      if ((segs[1] === "workspace" || segs[1] === "archive") && segs[2]) {
        return {
          name: "browse",
          kind: segs[1],
          root: segs[2],
          path: segs.slice(3).join("/"),
        };
      }
      return {
        name: "browse",
        kind: "workspace",
        root: segs[1],
        path: segs.slice(2).join("/"),
      };
    }

    if ((segs[0] === "read" || segs[0] === "file") && segs[1]) {
      if ((segs[1] === "workspace" || segs[1] === "archive") && segs[2] && segs.length >= 4) {
        return {
          name: "read",
          kind: segs[1],
          root: segs[2],
          path: segs.slice(3).join("/"),
        };
      }
      if (segs.length >= 3) {
        return {
          name: "read",
          kind: "workspace",
          root: segs[1],
          path: segs.slice(2).join("/"),
        };
      }
    }

    return { name: "home" };
  }

  function crumbsForBrowse(root, path, kind = "workspace") {
    const parts = [
      homeCrumb(),
      { label: root, href: path ? browseHref(root, "", kind) : null },
    ];
    if (!path) return parts;
    const segs = path.split("/").filter(Boolean);
    segs.forEach((seg, i) => {
      const sub = segs.slice(0, i + 1).join("/");
      parts.push({
        label: seg,
        href: i === segs.length - 1 ? null : browseHref(root, sub, kind),
      });
    });
    return parts;
  }

  function crumbsForRead(root, path, kind = "workspace") {
    const segs = path.split("/").filter(Boolean);
    const parts = [
      homeCrumb(),
      { label: root, href: browseHref(root, "", kind) },
    ];
    segs.forEach((seg, i) => {
      const isLast = i === segs.length - 1;
      const sub = segs.slice(0, i + 1).join("/");
      parts.push({
        label: seg,
        href: isLast ? null : browseHref(root, sub, kind),
      });
    });
    return parts;
  }

  function makeHomeCard(entry) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "folder-card";
    const prefix = entry.prefix || entry.name.split("-", 1)[0];
    const title =
      entry.title ||
      (entry.name.includes("-") ? entry.name.slice(entry.name.indexOf("-") + 1) : entry.name);
    const kind = normalizeKind(entry.rootKind);
    const status = normalizeStatus(entry.status || statusForKind(kind));
    const done = status === "done";
    card.innerHTML = `
      <div class="card-top">
        <span class="prefix">${escapeHtml(prefix)}</span>
        <span class="status-pill${done ? " is-done" : ""}">${escapeHtml(statusLabel(status))}</span>
      </div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="meta">${escapeHtml(formatTaskMeta(entry))}</div>`;
    card.addEventListener("click", () => {
      location.hash = browseHref(entry.name, "", kind);
    });
    return card;
  }

  function renderEntries() {
    const isHome = browseState == null;
    const q = entryFilter.value.trim().toLowerCase();
    let list = currentEntries.filter((e) => {
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || String(e.path || "").toLowerCase().includes(q);
    });

    if (isHome) {
      fileList.className = "card-grid";
      setBrowseHeader(null);
      updateTaskStatsMeta();
      if (homeFilter === "active") list = list.filter((e) => !isDoneEntry(e));
      else if (homeFilter === "done") list = list.filter((e) => isDoneEntry(e));
      else {
        const active = list.filter((e) => !isDoneEntry(e)).reverse();
        const done = list.filter((e) => isDoneEntry(e)).reverse();
        list = [...active, ...done];
      }
      if (homeFilter !== "all") list = [...list].reverse();
    } else {
      fileList.className = "file-list file-panel";
      setBrowseHeader(browseState);
    }

    if (!list.length) {
      fileList.innerHTML = `<div class="empty-hint">${
        q ? t("empty.noMatch") : t("empty.folder")
      }</div>`;
      return;
    }

    fileList.innerHTML = "";
    if (isHome) {
      for (const entry of list) fileList.appendChild(makeHomeCard(entry));
      return;
    }

    const kind = normalizeKind(browseState.kind);
    for (const entry of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `file-row ${entry.type}${entry.markdown ? " md" : ""}`;

      if (entry.type === "dir") {
        const count = t("file.items", {
          count: Number.isFinite(Number(entry.itemCount)) ? Number(entry.itemCount) : 0,
        });
        btn.innerHTML = `
          <span class="icon type-dir">DIR</span>
          <span class="name">${escapeHtml(entry.name)}${entry.name.endsWith("/") ? "" : "/"}</span>
          <span class="tag">${escapeHtml(count)}</span>`;
        btn.addEventListener("click", () => {
          location.hash = browseHref(browseState.root, entry.path, kind);
        });
      } else {
        const viewerType = entry.viewer?.type || (entry.markdown ? "markdown" : "");
        const icon =
          viewerType === "markdown"
            ? "MD"
            : viewerType === "json"
              ? "JSON"
              : viewerType === "code"
                ? "CODE"
                : entry.readable
                  ? "TXT"
                  : "FILE";
        const typeClass =
          viewerType === "markdown"
            ? "type-md"
            : viewerType === "json"
              ? "type-json"
              : viewerType === "code"
                ? "type-code"
                : "type-file";
        btn.className = `file-row ${entry.type}${
          viewerType === "markdown" ? " md" : viewerType ? ` viewer-${viewerType}` : ""
        }`;
        const right = formatSize(entry.size);
        btn.innerHTML = `
          <span class="icon ${typeClass}">${icon}</span>
          <span class="name">${escapeHtml(entry.name)}</span>
          <span class="tag">${escapeHtml(right)}</span>`;
        btn.addEventListener("click", () => {
          if (!entry.readable) {
            alert(t("file.unsupported"));
            return;
          }
          location.hash = readHref(browseState.root, entry.path, kind);
        });
      }

      fileList.appendChild(btn);
    }
  }

  async function loadHome() {
    browseState = null;
    currentFile = null;
    currentMtimeNs = null;
    currentContent = null;
    showView("browse");
    syncHomeOnlyChrome(true);
    setCrumbs([]);
    setBrowseHeader(null);
    applyPendingSearch();
    const data = await api("/api/roots");
    currentEntries = data.entries || [];
    homeEntries = currentEntries;
    updateTaskStatsMeta();
    renderEntries();
  }

  async function loadBrowse(root, path, kind = "workspace") {
    const rootKind = normalizeKind(kind);
    browseState = {
      root,
      path: path || "",
      kind: rootKind,
      status: statusForKind(rootKind),
    };
    currentFile = null;
    currentMtimeNs = null;
    currentContent = null;
    showView("browse");
    syncHomeOnlyChrome(false);
    setCrumbs(crumbsForBrowse(root, path || "", rootKind));
    applyPendingSearch();
    const qs = new URLSearchParams({ root, kind: rootKind });
    if (path) qs.set("path", path);
    const data = await api(`/api/ls?${qs.toString()}`);
    if (data.rootKind) browseState.kind = normalizeKind(data.rootKind);
    if (data.status) browseState.status = data.status;
    currentEntries = data.entries || [];
    setCrumbs(crumbsForBrowse(root, path || "", browseState.kind));
    renderEntries();
  }

  function slugify(text, used) {
    let base = String(text)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\u4e00-\u9fff-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!base) base = "section";
    let id = base;
    let i = 2;
    while (used.has(id)) id = `${base}-${i++}`;
    used.add(id);
    return id;
  }

  function setActiveOutline(id) {
    outlineEl.querySelectorAll("a").forEach((a) => {
      const active = a.dataset.targetId === id;
      a.classList.toggle("active", active);
      if (active) {
        const pane = outlinePane;
        if (!pane) return;
        const aTop = a.offsetTop;
        const aBottom = aTop + a.offsetHeight;
        if (aTop < pane.scrollTop + 8) pane.scrollTop = Math.max(0, aTop - 8);
        else if (aBottom > pane.scrollTop + pane.clientHeight - 8) {
          pane.scrollTop = aBottom - pane.clientHeight + 8;
        }
      }
    });
  }

  function scrollToHeading(el, behavior = "smooth") {
    if (!el) return;
    const offset = topbarOffset();
    const y = el.getBoundingClientRect().top + window.scrollY - offset;
    ignoreScrollSpyUntil = Date.now() + (behavior === "smooth" ? 700 : 50);
    window.scrollTo({ top: Math.max(0, y), behavior });
    if (el.id) setActiveOutline(el.id);
  }

  function headingLabel(h) {
    const clone = h.cloneNode(true);
    clone.querySelectorAll(".reading-meta").forEach((el) => el.remove());
    return (clone.textContent || "").trim();
  }

  function readingStats(md) {
    const text = String(md || "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]*`/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, "");
    const chars = text.length;
    const minutes = Math.max(1, Math.ceil(chars / READING_WPM));
    return { chars, minutes };
  }

  function injectReadingMeta(md) {
    const h =
      readerEl.querySelector("h1") ||
      readerEl.querySelector("h1,h2,h3,h4,h5,h6");
    if (!h) return;
    h.querySelectorAll(".reading-meta").forEach((el) => el.remove());
    const { chars, minutes } = readingStats(md);
    h.classList.add("has-reading-meta");
    const meta = document.createElement("span");
    meta.className = "reading-meta";
    meta.textContent = t("reader.meta", { chars, minutes });
    h.appendChild(meta);
  }

  function buildOutlineFromReader() {
    const used = new Set();
    const headings = [...readerEl.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    outlineEl.innerHTML = "";
    if (!headings.length) {
      outlineEl.innerHTML = `<div class="empty-hint" style="padding:0.4rem 0.55rem">${escapeHtml(
        t("reader.outlineEmpty")
      )}</div>`;
      return;
    }
    for (const h of headings) {
      const label = headingLabel(h) || "section";
      if (!h.id) h.id = slugify(label, used);
      else used.add(h.id);
      const level = Number(h.tagName.slice(1));
      const a = document.createElement("a");
      a.href = `#${encodeURIComponent(h.id)}`;
      a.dataset.targetId = h.id;
      a.className = `lv-${level}`;
      a.textContent = label || h.id;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (!currentFile) return;
        const target = document.getElementById(h.id);
        if (!target) return;
        scrollToHeading(target, "smooth");
        history.replaceState(
          null,
          "",
          readHref(currentFile.root, currentFile.path, currentFile.kind || "workspace")
        );
      });
      outlineEl.appendChild(a);
    }
  }

  function normalizeRel(path) {
    const parts = [];
    for (const seg of path.replaceAll("\\", "/").split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        if (parts.length) parts.pop();
        continue;
      }
      parts.push(seg);
    }
    return parts.join("/");
  }

  function rewriteRelativeUrls(html, root, filePath, kind = "workspace") {
    const rootKind = normalizeKind(kind);
    const baseDir = filePath.includes("/")
      ? filePath.slice(0, filePath.lastIndexOf("/") + 1)
      : "";
    const doc = new DOMParser().parseFromString(html, "text/html");

    doc.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (/^(https?:|data:|\/\/)/i.test(src)) return;
      const decoded = src
        .split("/")
        .map(decodePathSegment)
        .join("/");
      const joined = normalizeRel(baseDir + decoded);
      img.setAttribute(
        "src",
        `/api/asset?root=${encodeURIComponent(root)}&kind=${encodeURIComponent(
          rootKind
        )}&path=${encodeURIComponent(joined)}`
      );
    });

    doc.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (/^(https?:|mailto:|#|\/\/)/i.test(href)) return;
      if (/\.(md|markdown|mdown|mkd)(#.*)?$/i.test(href)) {
        const [pathPart] = href.split("#");
        const decoded = pathPart
          .split("/")
          .map(decodePathSegment)
          .join("/");
        const joined = normalizeRel(baseDir + decoded);
        a.setAttribute("href", readHref(root, joined, rootKind));
      }
    });

    return doc.body.innerHTML;
  }

  function captureViewport() {
    const offset = topbarOffset();
    const headings = [...readerEl.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    let anchorId = null;
    let anchorText = null;
    let delta = 0;

    for (const h of headings) {
      const top = h.getBoundingClientRect().top;
      if (top <= offset + 4) {
        anchorId = h.id;
        anchorText = headingLabel(h);
        delta = top - offset;
      } else {
        break;
      }
    }

    const docHeight = Math.max(
      document.documentElement.scrollHeight - window.innerHeight,
      1
    );

    return {
      anchorId,
      anchorText,
      delta,
      scrollY: window.scrollY,
      scrollRatio: window.scrollY / docHeight,
    };
  }

  function restoreViewport(snap) {
    if (!snap) return;
    requestAnimationFrame(() => {
      let target = snap.anchorId ? document.getElementById(snap.anchorId) : null;
      if (!target && snap.anchorText) {
        target =
          [...readerEl.querySelectorAll("h1,h2,h3,h4,h5,h6")].find(
            (h) => headingLabel(h) === snap.anchorText
          ) || null;
      }

      ignoreScrollSpyUntil = Date.now() + 80;
      if (target) {
        const offset = topbarOffset();
        const y =
          target.getBoundingClientRect().top +
          window.scrollY -
          offset -
          (typeof snap.delta === "number" ? snap.delta : 0);
        window.scrollTo(0, Math.max(0, y));
        if (target.id) setActiveOutline(target.id);
        return;
      }

      if (typeof snap.scrollRatio === "number") {
        const docHeight = Math.max(
          document.documentElement.scrollHeight - window.innerHeight,
          0
        );
        window.scrollTo(0, snap.scrollRatio * docHeight);
        return;
      }

      if (typeof snap.scrollY === "number") {
        window.scrollTo(0, snap.scrollY);
      }
    });
  }

  function resolveViewer(data) {
    if (data.viewer && data.viewer.type) return data.viewer;
    if (data.markdown) return { type: "markdown" };
    return { type: "plain" };
  }

  function showOutlinePane() {
    viewRead.classList.remove("no-outline");
  }

  function renderOutlinePlaceholder() {
    showOutlinePane();
    outlineEl.innerHTML = `<div class="empty-hint" style="padding:0.4rem 0.55rem">${escapeHtml(
      t("reader.outlineEmpty")
    )}</div>`;
  }

  function renderCodeDocument(content, language) {
    readerEl.className = "reader code-doc";
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    if (language) code.className = `language-${language}`;
    code.textContent = content;
    pre.appendChild(code);
    readerEl.innerHTML = "";
    readerEl.appendChild(pre);
    try {
      hljs.highlightElement(code);
    } catch {
      /* ignore unknown language */
    }
  }

  function renderJsonDocument(content) {
    let pretty = content;
    let ok = false;
    try {
      pretty = JSON.stringify(JSON.parse(content), null, 2);
      ok = true;
    } catch {
      ok = false;
    }
    renderCodeDocument(pretty, "json");
    if (!ok) {
      const note = document.createElement("div");
      note.className = "parse-note";
      note.textContent = t("reader.jsonFail");
      readerEl.prepend(note);
    }
  }

  /** Strip BOM and split leading YAML frontmatter from Markdown body. */
  function parseMarkdownFrontmatter(content) {
    let src = String(content || "");
    if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
    const match = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!match) return { body: src, raw: null, fields: null };
    const raw = match[1];
    return {
      body: src.slice(match[0].length),
      raw,
      fields: parseFrontmatterFields(raw),
    };
  }

  function unquoteYamlScalar(value) {
    const text = String(value ?? "");
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      return text.slice(1, -1);
    }
    return text;
  }

  function dedentYamlBlock(lines) {
    const indents = lines
      .filter((line) => line.trim().length)
      .map((line) => (line.match(/^[ \t]*/)?.[0] || "").length);
    const trim = indents.length ? Math.min(...indents) : 0;
    return lines
      .map((line) => (trim ? line.slice(trim) : line))
      .join("\n")
      .replace(/\s+$/g, "");
  }

  /**
   * Best-effort flat YAML field parse for common frontmatter.
   * Returns null when structure is nested/unsupported — caller shows raw YAML.
   */
  function parseFrontmatterFields(raw) {
    const lines = String(raw || "").split(/\r?\n/);
    const fields = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim() || /^\s*#/.test(line)) {
        i += 1;
        continue;
      }
      if (/^\s/.test(line)) return null;
      const km = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
      if (!km) return null;
      const key = km[1];
      const rest = km[2];
      if (/^[>|][+-]?$/.test(rest.trim())) {
        i += 1;
        const block = [];
        while (i < lines.length) {
          const next = lines[i];
          if (next === "" || /^\s/.test(next)) {
            block.push(next);
            i += 1;
            continue;
          }
          break;
        }
        fields.push({ key, value: dedentYamlBlock(block) });
        continue;
      }
      fields.push({ key, value: unquoteYamlScalar(rest.trim()) });
      i += 1;
    }
    return fields;
  }

  function buildFrontmatterBlock(raw, fields) {
    const details = document.createElement("details");
    details.className = "md-frontmatter";

    const summary = document.createElement("summary");
    summary.className = "md-frontmatter-summary";
    if (fields && fields.length) {
      const keys = fields.map((f) => f.key);
      const preview = keys.slice(0, 4).join(", ");
      summary.textContent = t("reader.frontmatterSummary", {
        count: fields.length,
        keys: preview,
      });
    } else {
      summary.textContent = t("reader.frontmatterRaw");
    }
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "md-frontmatter-body";

    if (fields && fields.length) {
      const table = document.createElement("table");
      table.className = "md-frontmatter-table";
      const tbody = document.createElement("tbody");
      for (const field of fields) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = field.key;
        const td = document.createElement("td");
        td.textContent = field.value;
        tr.appendChild(th);
        tr.appendChild(td);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      body.appendChild(table);
    } else {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = "language-yaml";
      code.textContent = raw;
      pre.appendChild(code);
      body.appendChild(pre);
      try {
        hljs.highlightElement(code);
      } catch {
        /* ignore */
      }
    }

    details.appendChild(body);
    return details;
  }

  async function renderDocument(data, { preserveViewport = false } = {}) {
    const snap = preserveViewport ? captureViewport() : null;
    const root = data.root;
    const path = data.path;
    const viewer = resolveViewer(data);

    // Keep the left contents pane for every supported detail viewer.
    showOutlinePane();

    if (viewer.type === "markdown") {
      const { body, raw: fmRaw, fields: fmFields } = parseMarkdownFrontmatter(
        data.content
      );
      const rawHtml = marked.parse(body);
      const safe = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
      readerEl.className = "reader markdown-body";
      readerEl.innerHTML = rewriteRelativeUrls(
        safe,
        root,
        path,
        data.rootKind || currentFile?.kind || "workspace"
      );
      if (fmRaw != null) {
        readerEl.prepend(buildFrontmatterBlock(fmRaw, fmFields));
      }
      readerEl.querySelectorAll("pre code").forEach((block) => {
        if (isMermaidBlock(block)) return;
        if (block.closest(".md-frontmatter")) return;
        hljs.highlightElement(block);
      });
      buildOutlineFromReader();
      injectReadingMeta(body);
      await renderMermaidBlocks();
    } else if (viewer.type === "json") {
      renderJsonDocument(data.content);
      renderOutlinePlaceholder();
    } else if (viewer.type === "code") {
      renderCodeDocument(data.content, viewer.language || "plaintext");
      renderOutlinePlaceholder();
    } else {
      readerEl.className = "reader plain";
      readerEl.textContent = data.content;
      renderOutlinePlaceholder();
    }

    currentMtimeNs = data.mtimeNs ?? null;
    currentContent = data.content;

    if (preserveViewport) restoreViewport(snap);
    else window.scrollTo(0, 0);
  }

  async function loadRead(root, path, kind = "workspace") {
    const rootKind = normalizeKind(kind);
    browseState = {
      root,
      path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
      kind: rootKind,
      status: statusForKind(rootKind),
    };
    currentFile = { root, path, kind: rootKind };
    showView("read");
    syncHomeOnlyChrome(false);
    setCrumbs(crumbsForRead(root, path, rootKind));

    const data = await api(
      `/api/file?root=${encodeURIComponent(root)}&kind=${encodeURIComponent(
        rootKind
      )}&path=${encodeURIComponent(path)}`
    );
    if (data.rootKind) {
      currentFile.kind = normalizeKind(data.rootKind);
      browseState.kind = currentFile.kind;
      browseState.status = data.status || statusForKind(currentFile.kind);
      setCrumbs(crumbsForRead(root, path, currentFile.kind));
    }
    await renderDocument(data, { preserveViewport: false });
    startPolling();
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      refreshIfChanged().catch(() => {});
    }, POLL_MS);
  }

  async function refreshIfChanged() {
    if (!currentFile || viewRead.hidden || refreshing || document.hidden) return;
    refreshing = true;
    try {
      const data = await api(
        `/api/file?root=${encodeURIComponent(currentFile.root)}&kind=${encodeURIComponent(
          normalizeKind(currentFile.kind)
        )}&path=${encodeURIComponent(currentFile.path)}`
      );
      const changed =
        (data.mtimeNs != null && data.mtimeNs !== currentMtimeNs) ||
        (data.content != null && data.content !== currentContent);
      if (!changed) return;
      await renderDocument(data, { preserveViewport: true });
    } finally {
      refreshing = false;
    }
  }

  function syncOutlineActive() {
    if (viewRead.hidden) return;
    if (Date.now() < ignoreScrollSpyUntil) return;
    const offset = topbarOffset();
    const headings = [...readerEl.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    if (!headings.length) return;
    let current = headings[0].id;
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= offset + 2) current = h.id;
      else break;
    }
    if (current) setActiveOutline(current);
  }

  function updateFloatNavVisibility(clientX, clientY) {
    if (viewRead.hidden) {
      floatNav.classList.remove("visible");
      return;
    }
    const outlineW =
      outlinePane && !viewRead.classList.contains("no-outline")
        ? outlinePane.getBoundingClientRect().width
        : 0;
    const inRight = clientX >= outlineW;
    const nearBottom = window.innerHeight - clientY <= 150;
    const nearRight = window.innerWidth - clientX <= 130;
    floatNav.classList.toggle("visible", inRight && nearBottom && nearRight);
  }

  async function renderRoute() {
    const route = parseRoute();
    try {
      if (route.name === "home") {
        await loadHome();
        return;
      }
      if (route.name === "browse") {
        await loadBrowse(route.root, route.path || "", route.kind || "workspace");
        return;
      }
      if (route.name === "read") {
        await loadRead(route.root, route.path, route.kind || "workspace");
      }
    } catch (err) {
      showView("browse");
      syncHomeOnlyChrome(true);
      setCrumbs([]);
      setBrowseHeader(null);
      fileList.innerHTML = `<div class="empty-hint">${escapeHtml(
        t("empty.loadFailed", { message: err.message })
      )}</div>`;
    }
  }

  window.addEventListener("featurehub:locale-changed", () => {
    window.FeatureHubI18n?.applyDom?.();
    syncFooterBrand();
    syncOutlineToggleUi();
    if (browseState == null) {
      setCrumbs([]);
      updateTaskStatsMeta();
      renderEntries();
      return;
    }
    if (currentFile) {
      setCrumbs(
        crumbsForRead(currentFile.root, currentFile.path, currentFile.kind || "workspace")
      );
      setBrowseHeader(browseState);
      return;
    }
    setCrumbs(
      crumbsForBrowse(browseState.root, browseState.path || "", browseState.kind || "workspace")
    );
    setBrowseHeader(browseState);
    renderEntries();
  });

  outlineToggle?.addEventListener("click", () => {
    setOutlineCollapsed(!isOutlineCollapsed());
  });
  setOutlineCollapsed(loadOutlineCollapsedPref(), { persist: false });
  window.addEventListener("resize", () => {
    if (!viewRead.hidden) measureChromeHeight();
  });

  for (const btn of [filterAllBtn, filterActiveBtn, filterDoneBtn]) {
    btn?.addEventListener("click", () => {
      setHomeFilter(btn.dataset.filter || "all");
    });
  }

  let refreshingIndex = false;
  refreshIndexBtn?.addEventListener("click", async () => {
    if (refreshingIndex) return;
    refreshingIndex = true;
    const prev = refreshIndexBtn.textContent;
    refreshIndexBtn.disabled = true;
    refreshIndexBtn.textContent = t("nav.refreshing");
    try {
      const data = await api("/api/tasks/rebuild", { method: "POST" });
      await loadHome();
      const count = Number(data.taskCount ?? data.entryCount ?? 0);
      refreshIndexBtn.title = t("nav.refreshOk", { count });
    } catch (err) {
      alert(t("nav.refreshFailed", { message: err.message || String(err) }));
    } finally {
      refreshingIndex = false;
      refreshIndexBtn.disabled = false;
      refreshIndexBtn.textContent = prev || t("nav.refresh");
    }
  });

  entryFilter.addEventListener("input", () => {
    if (!viewBrowse.hidden) {
      renderEntries();
      return;
    }
    pendingSearch = entryFilter.value;
    const hash = location.hash || "#/";
    if (hash === "#/" || hash === "#" || hash === "") {
      loadHome().catch(() => {});
      return;
    }
    location.hash = "#/";
  });
  window.addEventListener("hashchange", renderRoute);
  window.addEventListener("featurehub:config-saved", () => {
    const route = parseRoute();
    if (route.name === "home" || route.name === "browse" || route.name === "read") {
      renderRoute().catch(() => {});
    }
  });
  window.addEventListener("featurehub:task-created", (ev) => {
    const task = ev.detail;
    if (task?.id) {
      location.hash = browseHref(task.id, "", task.rootKind || "workspace");
      return;
    }
    loadHome().catch(() => {});
  });
  window.addEventListener("scroll", syncOutlineActive, { passive: true });
  window.addEventListener(
    "mousemove",
    (ev) => updateFloatNavVisibility(ev.clientX, ev.clientY),
    { passive: true }
  );
  window.addEventListener(
    "mouseleave",
    () => floatNav.classList.remove("visible"),
    { passive: true }
  );
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshIfChanged().catch(() => {});
  });

  toTopBtn.addEventListener("click", () => {
    ignoreScrollSpyUntil = Date.now() + 700;
    window.scrollTo({ top: 0, behavior: "smooth" });
    const first = outlineEl.querySelector("a");
    if (first?.dataset.targetId) setActiveOutline(first.dataset.targetId);
  });

  toBottomBtn.addEventListener("click", () => {
    ignoreScrollSpyUntil = Date.now() + 700;
    const top =
      document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    const links = outlineEl.querySelectorAll("a");
    const last = links[links.length - 1];
    if (last?.dataset.targetId) setActiveOutline(last.dataset.targetId);
  });

  syncFooterBrand();
  renderRoute();
})();
