/* ==========================================================================
   HOUSE OF ALDEN — the live catalogue
   --------------------------------------------------------------------------
   Products, prices, stock and the shop settings are now edited in /admin and
   kept in Firebase. This file keeps PRODUCTS and BUSINESS (js/config.js) in
   step with them, so every other script goes on reading the same two names it
   always has, and none of them needs to know where the data came from.

   Three sources, best first:
     1. Firebase. A change saved in the admin reaches a page that is already
        open within a second or two.
     2. The last copy this browser saw (localStorage) — shown at once on the
        next visit, then quietly refreshed.
     3. js/config.js itself. If Firebase cannot be reached — offline, the
        security rules not yet published, the page opened straight off the
        disk — the shop still works exactly as it did before there was an
        admin. config.js is the safety net now, not the source.

   Depends on: config.js, firebase-config.js. Load right after them and
   before cart.js. Add data-live="realtime" to the <script> tag on pages that
   show products, so they keep a live connection open; other pages fetch once.

   Fires "hoa:live" on document whenever PRODUCTS or BUSINESS change.
   ========================================================================== */

const Live = (() => {
  const SDK = "https://www.gstatic.com/firebasejs/12.19.0";
  const CACHE_KEY = "hoa.live.v1";
  const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // older than this is not worth showing
  const FETCH_TIMEOUT = 6000;
  const MAX_QTY = 99; // the ceiling js/cart.js enforces
  const CATEGORIES = new Set(["watches", "earrings"]);
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  /* An absolute https address, or a path inside this site ("images/x.webp"). */
  const IMAGE = /^(https:\/\/[^\s"'<>]+|\/?[A-Za-z0-9][\w\-./]*)$/;
  const PLACEHOLDER = "images/logo-mark.webp";

  /* Only these fields reach the shop — and the cache. */
  const PRODUCT_FIELDS = ["name", "status", "category", "price", "compareAtPrice", "images", "trackInventory",
    "quantity", "continueSelling", "badge", "blurb", "description", "specs", "seoTitle", "seoDescription", "position"];
  const SETTING_FIELDS = ["whatsapp", "email", "instagram", "pinterest", "shipping"];

  const script = document.currentScript;
  const realtime = !!(script && script.dataset.live === "realtime");
  const cfg = window.HOA_FIREBASE && window.HOA_FIREBASE.projectId && window.HOA_FIREBASE.apiKey
    ? window.HOA_FIREBASE
    : null;

  /* What the static pages were written with, so links in the markup can be
     found again and pointed at whatever the admin sets instead. */
  const shown = {
    whatsapp: BUSINESS.whatsapp,
    email: BUSINESS.email,
    instagram: BUSINESS.social ? BUSINESS.social.instagram : "",
    pinterest: BUSINESS.social ? BUSINESS.social.pinterest : "",
  };

  const raw = { products: null, settings: null }; // latest from Firebase, trimmed
  let lastSig = "";
  let pending = false;
  let source = "seed";

  /* --- Shapes ----------------------------------------------------------- */

  const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const int = (v) => {
    const n = Number(v);
    return v !== null && v !== "" && Number.isFinite(n) ? Math.round(n) : null;
  };
  const pick = (obj, fields) => {
    const out = {};
    fields.forEach((k) => {
      if (obj && obj[k] !== undefined) out[k] = obj[k];
    });
    return out;
  };

  /* A Firestore product → the shape js/config.js has always used, plus
     maxQty (how many one cart may hold) and compareAtPrice. Anything malformed
     is dropped rather than allowed to break a page. */
  function toProduct(id, d) {
    if (!d || d.status !== "active" || typeof id !== "string") return null;
    const name = text(d.name, 140).trim();
    const price = int(d.price);
    if (!name || price === null || price < 0 || !CATEGORIES.has(d.category)) return null;

    const images = (Array.isArray(d.images) ? d.images : []).filter(
      (img) => img && typeof img.url === "string" && IMAGE.test(img.url) && !img.url.includes("..")
    );
    const tracked = d.trackInventory === true;
    const oversell = d.continueSelling === true;
    const onHand = int(d.quantity) || 0;
    const compare = int(d.compareAtPrice);

    return {
      id,
      name,
      category: d.category,
      price,
      compareAtPrice: compare !== null && compare > price ? compare : null,
      image: images.length ? images[0].url : PLACEHOLDER,
      images: images.map((img) => img.url),
      alt: images.length ? text(images[0].alt, 300) : `${name} — photograph to follow.`,
      stock: !tracked || oversell || onHand > 0,
      maxQty: tracked && !oversell ? Math.max(0, Math.min(MAX_QTY, onHand)) : MAX_QTY,
      badge: text(d.badge, 24),
      blurb: text(d.blurb, 400),
      description: text(d.description, 8000),
      specs: (Array.isArray(d.specs) ? d.specs : [])
        .filter((s) => s && typeof s.label === "string" && s.label.trim())
        .map((s) => [text(s.label, 80), text(s.value, 200)]),
      seoTitle: text(d.seoTitle, 160),
      seoDescription: text(d.seoDescription, 400),
      position: int(d.position) || 0,
    };
  }

  function catalogue(list) {
    return list
      .map((p) => toProduct(p.id, p.data))
      .filter(Boolean)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }

  function settingsFrom(s) {
    if (!s) return null;
    const out = {};
    const wa = typeof s.whatsapp === "string" ? s.whatsapp.replace(/\D/g, "") : "";
    if (wa.length >= 8 && wa.length <= 15) out.whatsapp = wa;
    if (typeof s.email === "string" && EMAIL.test(s.email)) out.email = s.email;
    ["instagram", "pinterest"].forEach((k) => {
      if (typeof s[k] === "string" && (s[k] === "" || /^https:\/\/[^\s"'<>]+$/.test(s[k]))) out[k] = s[k];
    });
    const ship = s.shipping && typeof s.shipping === "object" ? s.shipping : {};
    const flat = int(ship.flatRate);
    const free = int(ship.freeAbove);
    out.shipping = {
      flatRate: flat !== null && flat >= 0 ? flat : BUSINESS.shipping.flatRate,
      freeAbove: free !== null && free >= 0 ? free : BUSINESS.shipping.freeAbove,
    };
    return out;
  }

  /* --- Applying --------------------------------------------------------- */

  function commit(from) {
    const products = raw.products ? catalogue(raw.products) : null;
    const settings = settingsFrom(raw.settings);
    const sig = JSON.stringify([products, settings]);
    const wasPending = pending;
    pending = false;
    if (sig === lastSig && !wasPending) return;
    lastSig = sig;
    source = from;

    if (products) {
      PRODUCTS.length = 0;
      products.forEach((p) => PRODUCTS.push(p));
    }
    if (settings) {
      if (settings.whatsapp) BUSINESS.whatsapp = settings.whatsapp;
      if (settings.email) BUSINESS.email = settings.email;
      BUSINESS.social = { ...(BUSINESS.social || {}) };
      if ("instagram" in settings) BUSINESS.social.instagram = settings.instagram;
      if ("pinterest" in settings) BUSINESS.social.pinterest = settings.pinterest;
      BUSINESS.shipping = settings.shipping;
    }

    if (from === "live") save();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => syncLinks(), { once: true });
    } else {
      syncLinks();
    }
    document.dispatchEvent(new CustomEvent("hoa:live", { detail: { source: from } }));
  }

  /* Nothing more to wait for: let the page draw whatever it has (config.js). */
  function settle() {
    if (!pending) return;
    pending = false;
    document.dispatchEvent(new CustomEvent("hoa:live", { detail: { source } }));
  }

  /* The footer and contact links are written into the HTML so they work with
     JavaScript off. Point them at the admin's settings once those are known. */
  function syncLinks() {
    const next = {
      whatsapp: BUSINESS.whatsapp,
      email: BUSINESS.email,
      instagram: BUSINESS.social ? BUSINESS.social.instagram : "",
      pinterest: BUSINESS.social ? BUSINESS.social.pinterest : "",
    };
    const wa = `https://wa.me/${shown.whatsapp}`;
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (next.whatsapp !== shown.whatsapp && (href === wa || href.startsWith(`${wa}?`))) {
        a.setAttribute("href", `https://wa.me/${next.whatsapp}${href.slice(wa.length)}`);
      } else if (next.email !== shown.email && href === `mailto:${shown.email}`) {
        a.setAttribute("href", `mailto:${next.email}`);
        if (a.textContent.trim() === shown.email) a.textContent = next.email;
      } else {
        ["instagram", "pinterest"].forEach((k) => {
          if (next[k] === shown[k] || !shown[k] || href !== shown[k]) return;
          const item = a.closest("li");
          if (next[k]) {
            a.setAttribute("href", next[k]);
            if (item) item.hidden = false;
          } else if (item) {
            item.hidden = true; // no account set: hide the link rather than point nowhere
          }
        });
      }
    });
    /* Remember a hidden link by its old address so it can come back. */
    Object.keys(next).forEach((k) => {
      if (next[k] || k === "whatsapp" || k === "email") shown[k] = next[k];
    });
  }

  /* --- Cache ------------------------------------------------------------- */

  function save() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ v: 1, at: Date.now(), ...raw }));
    } catch {
      /* Private browsing / quota. The page still has the data. */
    }
  }

  function restore() {
    let c;
    try {
      c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    } catch {
      return false;
    }
    if (!c || c.v !== 1 || !Array.isArray(c.products) || !(Date.now() - c.at < CACHE_MAX_AGE)) return false;
    raw.products = c.products;
    raw.settings = c.settings && typeof c.settings === "object" ? c.settings : null;
    commit("cache");
    return true;
  }

  /* --- Fetch once (REST — small, fast, no SDK) --------------------------- */

  /* Firestore's REST answer, typed values and all → plain values. */
  function decode(v) {
    if (!v || typeof v !== "object") return null;
    if ("stringValue" in v) return v.stringValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return Number(v.doubleValue);
    if ("booleanValue" in v) return v.booleanValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
    if ("mapValue" in v) return fields(v.mapValue.fields);
    return null;
  }
  function fields(f) {
    const out = {};
    Object.keys(f || {}).forEach((k) => {
      if (!k.startsWith("__")) out[k] = decode(f[k]);
    });
    return out;
  }

  async function fetchOnce() {
    const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/(default)/documents`;
    const key = `key=${encodeURIComponent(cfg.apiKey)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    try {
      const [productsRes, settingsRes] = await Promise.all([
        fetch(`${base}:runQuery?${key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: "products" }],
              where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "active" } } },
            },
          }),
          signal: ctrl.signal,
        }),
        fetch(`${base}/settings/store?${key}`, { signal: ctrl.signal }),
      ]);
      if (!productsRes.ok) return { ok: false, status: productsRes.status };
      const rows = await productsRes.json();
      raw.products = (Array.isArray(rows) ? rows : [])
        .filter((r) => r && r.document && typeof r.document.name === "string")
        .map((r) => ({ id: r.document.name.split("/").pop(), data: pick(fields(r.document.fields), PRODUCT_FIELDS) }));
      if (settingsRes.ok) raw.settings = pick(fields((await settingsRes.json()).fields), SETTING_FIELDS);
      return { ok: true };
    } catch {
      return { ok: false, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  /* --- Stay connected (Firestore SDK, loaded only where it pays) --------- */

  async function listen() {
    try {
      const [appMod, fs] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-firestore.js`),
      ]);
      const app = appMod.getApps().find((a) => a.name === "storefront") || appMod.initializeApp(cfg, "storefront");
      const db = fs.getFirestore(app);
      const quiet = (err) => console.warn("House of Alden — live updates paused:", err && err.code);

      fs.onSnapshot(
        fs.query(fs.collection(db, "products"), fs.where("status", "==", "active")),
        (snap) => {
          raw.products = snap.docs.map((d) => ({ id: d.id, data: pick(d.data(), PRODUCT_FIELDS) }));
          commit("live");
        },
        quiet
      );
      fs.onSnapshot(
        fs.doc(db, "settings", "store"),
        (snap) => {
          raw.settings = snap.exists() ? pick(snap.data(), SETTING_FIELDS) : null;
          if (raw.products) commit("live");
        },
        quiet
      );
    } catch (err) {
      console.warn("House of Alden — live updates unavailable.", err);
    }
  }

  const later = (fn) =>
    "requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 1200);

  /* --- Boot -------------------------------------------------------------- */

  const fromCache = restore();
  if (cfg && /^https?:$/.test(location.protocol)) {
    /* A first-time visitor has no copy yet: the grids show placeholders for
       the moment it takes to fetch, rather than flash config.js's prices. */
    pending = !fromCache;
    fetchOnce().then((result) => {
      if (result.ok) commit("live");
      else settle();
      /* 401/403/404 mean the rules or project say no — listening would only
         be refused again. Anything else (offline, slow) is worth a retry. */
      const refused = [401, 403, 404].includes(result.status);
      if (realtime && !refused) later(listen);
      if (!result.ok && result.status) {
        console.warn(`House of Alden — catalogue not loaded from Firebase (HTTP ${result.status}); showing js/config.js.`);
      }
    });
  }

  return {
    /** true while a first-time visitor waits for the catalogue — draw placeholders */
    get pending() {
      return pending;
    },
    /** "live" | "cache" | "seed" — where PRODUCTS came from */
    get source() {
      return source;
    },
  };
})();
