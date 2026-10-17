/* ==========================================================================
   HOUSE OF ALDEN ADMIN — addresses
   --------------------------------------------------------------------------
   Real addresses, like Shopify's: /admin/orders/abc123. On Vercel every
   /admin/* path serves admin/index.html (vercel.json → rewrites), and this
   decides which screen to draw. Links inside the admin are ordinary <a href>
   elements; clicks on them are caught here so the page never reloads.
   ========================================================================== */

const BASE = "/admin";

const ROUTES = [
  ["", "home"],
  ["/orders", "orders"],
  ["/orders/new", "order-new"],
  ["/orders/:id", "order"],
  ["/products", "products"],
  ["/products/new", "product"],
  ["/products/:id", "product"],
  ["/inventory", "inventory"],
  ["/customers", "customers"],
  ["/customers/:id", "customer"],
  ["/settings", "settings"],
  ["/settings/:section", "settings"],
].map(([pattern, name]) => {
  const keys = [];
  const source = pattern.replace(/:(\w+)/g, (_, key) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { name, keys, re: new RegExp(`^${source}$`) };
});

export function resolve(pathname) {
  const path = pathname.replace(/\/index\.html$/, "").replace(/\/+$/, "");
  if (path !== BASE && !path.startsWith(`${BASE}/`)) return { name: "notfound", params: {} };
  const rest = path.slice(BASE.length);
  for (const route of ROUTES) {
    const m = route.re.exec(rest);
    if (!m) continue;
    const params = {};
    try {
      route.keys.forEach((key, i) => (params[key] = decodeURIComponent(m[i + 1])));
    } catch {
      return { name: "notfound", params: {} };
    }
    return { name: route.name, params };
  }
  return { name: "notfound", params: {} };
}

export function current() {
  return { ...resolve(location.pathname), query: new URLSearchParams(location.search), path: location.pathname };
}

let render = () => {};
let guard = null;
let lastUrl = location.pathname + location.search;

/** A screen with unsaved work sets this; it resolves true when leaving is fine. */
export function setLeaveGuard(fn) {
  guard = fn;
}

export async function navigate(to, { replace = false } = {}) {
  const url = new URL(to, location.origin);
  const next = url.pathname + url.search;
  if (guard) {
    const ok = await guard();
    if (!ok) return false;
    guard = null;
  }
  if (replace) history.replaceState(null, "", next);
  else if (next !== location.pathname + location.search) history.pushState(null, "", next);
  lastUrl = next;
  render(current());
  return true;
}

/** Updates the query string (filters, tabs) without redrawing the screen. */
export function setQuery(params) {
  const url = new URL(location.href);
  Object.entries(params).forEach(([k, v]) => {
    if (v == null || v === "" || v === false) url.searchParams.delete(k);
    else url.searchParams.set(k, String(v));
  });
  history.replaceState(null, "", url.pathname + url.search);
  lastUrl = url.pathname + url.search;
}

export function startRouter(onRoute) {
  render = onRoute;

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !(url.pathname === BASE || url.pathname.startsWith(`${BASE}/`))) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });

  window.addEventListener("popstate", async () => {
    const target = location.pathname + location.search;
    if (guard) {
      const ok = await guard();
      if (!ok) {
        history.pushState(null, "", lastUrl); // stay put
        return;
      }
      guard = null;
    }
    lastUrl = target;
    render(current());
  });

  /* Closing the tab with unsaved work gets the browser's own warning. */
  window.addEventListener("beforeunload", (e) => {
    if (guard) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  render(current());
}
