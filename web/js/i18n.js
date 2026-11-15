(() => {
  const STORAGE_KEY = "featurehub.locale";
  const SUPPORTED = ["zh-CN", "en"];
  /** @type {Record<string, Record<string, string>>} */
  const catalogs = {};
  let locale = "zh-CN";
  let ready = false;
  /** @type {Array<() => void>} */
  const waiters = [];

  function detectLocale() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch {
      /* ignore */
    }
    const nav = String(navigator.language || "").toLowerCase();
    if (nav.startsWith("zh")) return "zh-CN";
    return "en";
  }

  function interpolate(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => {
      if (vars && Object.prototype.hasOwnProperty.call(vars, key)) {
        return String(vars[key]);
      }
      return "";
    });
  }

  function t(key, vars) {
    const primary = catalogs[locale] || {};
    const fallback = catalogs["zh-CN"] || catalogs.en || {};
    const raw = primary[key] ?? fallback[key] ?? key;
    return interpolate(raw, vars);
  }

  function applyDom(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (key) el.textContent = t(key);
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (key) el.setAttribute("placeholder", t(key));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (key) el.setAttribute("title", t(key));
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria");
      if (key) el.setAttribute("aria-label", t(key));
    });
    document.title = t("meta.title");
    document.documentElement.lang = locale === "zh-CN" ? "zh-CN" : "en";
    syncLocaleButtons();
  }

  function syncLocaleButtons() {
    document.querySelectorAll("[data-locale]").forEach((btn) => {
      const id = btn.getAttribute("data-locale");
      btn.classList.toggle("is-active", id === locale);
    });
  }

  function setLocale(next, { persist = true } = {}) {
    const id = SUPPORTED.includes(next) ? next : "zh-CN";
    locale = id;
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        /* ignore */
      }
    }
    applyDom();
    window.dispatchEvent(
      new CustomEvent("featurehub:locale-changed", { detail: { locale: id } })
    );
  }

  function getLocale() {
    return locale;
  }

  function whenReady(fn) {
    if (ready) fn();
    else waiters.push(fn);
  }

  function loadSync(url) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.send(null);
    if (xhr.status !== 200) {
      throw new Error(`failed to load ${url}`);
    }
    return JSON.parse(xhr.responseText);
  }

  function boot() {
    catalogs["zh-CN"] = loadSync("/i18n/zh-CN.json");
    catalogs.en = loadSync("/i18n/en.json");
    locale = detectLocale();
    ready = true;
    applyDom();
    waiters.splice(0).forEach((fn) => fn());
  }

  document.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("[data-locale]");
    if (!btn) return;
    const id = btn.getAttribute("data-locale");
    if (id) setLocale(id);
  });

  window.FeatureHubI18n = {
    t,
    setLocale,
    getLocale,
    applyDom,
    whenReady,
    supported: SUPPORTED,
  };

  try {
    boot();
  } catch (err) {
    console.error("[feature-hub] i18n boot failed", err);
    catalogs["zh-CN"] = catalogs["zh-CN"] || {};
    catalogs.en = catalogs.en || {};
    ready = true;
    waiters.splice(0).forEach((fn) => fn());
  }
})();
