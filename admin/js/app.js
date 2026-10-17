/* ==========================================================================
   HOUSE OF ALDEN ADMIN — the shell
   --------------------------------------------------------------------------
   Sign-in gate → top bar, side navigation and main area → the screen for the
   current address. Also: the global search, the mobile menu, and the alert
   (toast, sound, desktop notification) when a new order arrives.

   Who gets in: a signed-in account whose token carries admin: true AND that
   has a staff/{uid} record. The database rules check the same two things on
   every read and write, so this gate is a courtesy, not the lock.
   ========================================================================== */

import { auth, db, doc, getDoc, onAuthStateChanged, signOut } from "./fb.js";
import * as store from "./store.js";
import { current, navigate, startRouter } from "./router.js";
import { money, prettyPhone } from "./format.js";
import { prefs } from "./prefs.js";
import {
  announce, avatar, button, closeMenus, emptyState, h, icon, loadingPage, menuButton, page, pageHeader, card,
  saveBar, setTitle, setTitleCount, slide, toast,
} from "./ui.js";
import { renderFatal, renderLogin, renderNoAccess } from "./views/login.js";

const root = document.getElementById("app");

const VIEWS = {
  home: () => import("./views/home.js"),
  orders: () => import("./views/orders.js"),
  order: () => import("./views/order.js"),
  "order-new": () => import("./views/order-new.js"),
  products: () => import("./views/products.js"),
  product: () => import("./views/product.js"),
  inventory: () => import("./views/inventory.js"),
  customers: () => import("./views/customers.js"),
  customer: () => import("./views/customer.js"),
  settings: () => import("./views/settings.js"),
};

const NAV = [
  { label: "Home", href: "/admin", glyph: "home", routes: ["home"] },
  { label: "Orders", href: "/admin/orders", glyph: "receipt", routes: ["orders", "order", "order-new"], count: true },
  { label: "Products", href: "/admin/products", glyph: "tag", routes: ["products", "product"],
    children: [{ label: "Inventory", href: "/admin/inventory", routes: ["inventory"] }] },
  { label: "Customers", href: "/admin/customers", glyph: "users", routes: ["customers", "customer"] },
];

let session = null;
let shell = null;
let cleanup = null;
let routeSeq = 0;
let routerStarted = false;
let unseen = 0;
let offShell = null;

/* --- New-order alert ------------------------------------------------------- */

let audio = null;
function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  } catch {
    audio = null;
  }
}
document.addEventListener("pointerdown", unlockAudio, { passive: true });
document.addEventListener("keydown", unlockAudio);

/* Two soft notes, made on the spot — no sound file to load. */
function chime() {
  if (!audio) return;
  try {
    const t = audio.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const at = t + i * 0.14;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + 0.45);
    });
  } catch {
    /* sound is a nicety */
  }
}

function newOrder(o) {
  const watching = current().name === "orders" && document.visibilityState === "visible";
  if (!watching) {
    unseen += 1;
    setTitleCount(unseen);
  }
  const who = (o.customer && (o.customer.name || prettyPhone(o.customer.phone))) || "A customer";
  toast(`New order ${o.name}: ${money(o.total)} from ${who}`, {
    duration: 9000,
    action: { label: "View", onClick: () => navigate(`/admin/orders/${o.id}`) },
  });
  if (prefs.sound) chime();
  if (prefs.desktop && "Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
    try {
      const n = new Notification(`New order ${o.name}`, { body: `${who}, ${money(o.total)}`, icon: "/images/favicon.png", tag: o.id });
      n.onclick = () => {
        window.focus();
        navigate(`/admin/orders/${o.id}`);
        n.close();
      };
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }
}

/* --- Global search ----------------------------------------------------------- */

function searchResults(q) {
  const needle = q.toLowerCase().replace(/^#/, "");
  const digits = q.replace(/\D/g, "");
  const orders = store.state.orders.filter((o) => {
    const c = o.customer || {};
    return String(o.number).startsWith(needle) || `${c.name || ""} ${c.email || ""}`.toLowerCase().includes(needle)
      || (digits.length >= 4 && String(c.phone || "").replace(/\D/g, "").includes(digits));
  }).slice(0, 5).map((o) => ({ href: `/admin/orders/${o.id}`, glyph: "receipt", title: o.name,
    meta: `${(o.customer && o.customer.name) || "No customer"}, ${money(o.total)}` }));
  const products = store.state.products.filter((p) => `${p.name} ${p.sku || ""}`.toLowerCase().includes(needle))
    .slice(0, 5).map((p) => ({ href: `/admin/products/${encodeURIComponent(p.id)}`, glyph: "tag", title: p.name, meta: money(p.price) }));
  const customers = store.state.customers.filter((c) => `${c.name || ""} ${c.email || ""}`.toLowerCase().includes(needle)
    || (digits.length >= 4 && String(c.phone || "").replace(/\D/g, "").includes(digits)))
    .slice(0, 5).map((c) => ({ href: `/admin/customers/${encodeURIComponent(c.id)}`, glyph: "user", title: c.name || prettyPhone(c.phone), meta: prettyPhone(c.phone) }));
  return [["Orders", orders], ["Products", products], ["Customers", customers]].filter(([, list]) => list.length);
}

function buildSearch() {
  const box = h("input", {
    type: "search", class: "global-search-input", placeholder: "Search", autocomplete: "off", spellcheck: "false",
    role: "combobox", "aria-expanded": "false", "aria-controls": "global-results", "aria-label": "Search orders, products and customers",
  });
  const results = h("div", { class: "global-results", id: "global-results", role: "listbox", hidden: true });
  const wrap = h("div", { class: "global-search", role: "search" }, icon("search", { size: 18 }), box,
    h("kbd", { class: "kbd", "aria-hidden": "true" }, navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K"), results);
  let options = [];
  let active = -1;

  const close = () => {
    results.hidden = true;
    box.setAttribute("aria-expanded", "false");
    box.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const mark = (i) => {
    active = i;
    options.forEach((el, j) => el.setAttribute("aria-selected", String(j === i)));
    if (options[i]) box.setAttribute("aria-activedescendant", options[i].id);
  };
  const paint = () => {
    const q = box.value.trim();
    if (q.length < 2) return close();
    const groups = searchResults(q);
    let n = 0;
    options = [];
    results.replaceChildren(...(groups.length ? groups.map(([label, list]) => h("div", { class: "global-group", role: "group", "aria-label": label },
      h("p", { class: "global-group-label" }, label),
      list.map((r) => {
        const opt = h("a", { href: r.href, class: "global-option", role: "option", id: `gs-${n++}`, "aria-selected": "false", tabindex: "-1" },
          icon(r.glyph, { size: 18 }), h("span", { class: "global-option-title" }, r.title), h("span", { class: "subdued" }, r.meta));
        opt.addEventListener("click", () => {
          box.value = "";
          close();
        });
        options.push(opt);
        return opt;
      }))) : [h("p", { class: "global-empty" }, `Nothing matches "${q}".`)]));
    results.hidden = false;
    box.setAttribute("aria-expanded", "true");
    active = -1;
  };

  box.addEventListener("input", paint);
  box.addEventListener("focus", paint);
  box.addEventListener("blur", () => setTimeout(() => {
    if (!wrap.contains(document.activeElement)) close();
  }, 120));
  box.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && options.length) {
      e.preventDefault();
      mark(Math.min(options.length - 1, active + 1));
    } else if (e.key === "ArrowUp" && options.length) {
      e.preventDefault();
      mark(Math.max(0, active - 1));
    } else if (e.key === "Enter" && active > -1) {
      e.preventDefault();
      const href = options[active].getAttribute("href");
      box.value = "";
      close();
      box.blur();
      navigate(href);
    } else if (e.key === "Escape") {
      box.value = "";
      close();
      box.blur();
    }
  });
  /* ⌘K / Ctrl+K jumps to search from anywhere (no animation — it's a shortcut). */
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && shell) {
      e.preventDefault();
      box.focus();
      box.select();
    }
  });
  return wrap;
}

/* --- Shell ------------------------------------------------------------------- */

function navLink(item, child = false) {
  return h("a", { href: item.href, class: `nav-link${child ? " nav-link--child" : ""}`, dataset: { routes: item.routes.join(" ") } },
    item.glyph && icon(item.glyph, { size: 20 }),
    h("span", { class: "nav-label" }, item.label),
    item.count && h("span", { class: "nav-count", hidden: true }));
}

function mountShell() {
  const menuBtn = h("button", { type: "button", class: "icon-btn icon-btn--dark topbar-menu", "aria-label": "Open menu", "aria-expanded": "false", "aria-controls": "admin-nav" }, icon("menu-2"));
  const user = session.user;
  const account = menuButton("", [
    { label: "Your account", icon: "user", onClick: () => navigate("/admin/settings/account") },
    { label: "Settings", icon: "settings", onClick: () => navigate("/admin/settings") },
    { label: "View your store", icon: "external-link", onClick: () => window.open("/", "_blank", "noopener") },
    { label: "Sign out", icon: "logout", onClick: () => signOut(auth) },
  ], { variant: "topbar", ariaLabel: `Account menu for ${user.email}` });
  account.querySelector("button").prepend(avatar(user.displayName || user.email, 28), h("span", { class: "topbar-user-name" }, user.displayName || user.email));

  const topbar = h("header", { class: "topbar" },
    menuBtn,
    h("a", { class: "brand", href: "/admin" },
      h("img", { src: "/images/logo-mark.webp", alt: "", width: 22, height: 28 }),
      h("span", null, "House of Alden")),
    buildSearch(),
    h("div", { class: "topbar-actions" }, account));

  const nav = h("nav", { class: "sidebar", id: "admin-nav", "aria-label": "Admin" },
    h("ul", { class: "nav-list" }, NAV.map((item) => h("li", null, navLink(item),
      item.children && h("ul", { class: "nav-sub" }, item.children.map((c) => h("li", null, navLink(c, true))))))),
    h("p", { class: "nav-heading" }, "Sales channels"),
    h("ul", { class: "nav-list" }, h("li", null,
      h("a", { href: "/", target: "_blank", rel: "noopener", class: "nav-link" }, icon("building-store", { size: 20 }),
        h("span", { class: "nav-label" }, "Online store"), icon("external-link", { size: 16, className: "nav-external" })))),
    h("div", { class: "nav-bottom" }, h("ul", { class: "nav-list" },
      h("li", null, navLink({ label: "Settings", href: "/admin/settings", glyph: "settings", routes: ["settings"] })))));

  const main = h("main", { class: "main", id: "main", tabindex: "-1" });
  const scrim = h("div", { class: "scrim", hidden: true });
  root.replaceChildren(h("div", { class: "shell" }, topbar, nav, scrim, main));

  const narrow = window.matchMedia("(max-width: 1039px)");
  const openNav = () => {
    nav.classList.add("is-open");
    scrim.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
    slide(nav, true);
    const first = nav.querySelector("a");
    if (first) first.focus();
  };
  const closeNav = async (focusButton = false) => {
    if (!nav.classList.contains("is-open")) return;
    menuBtn.setAttribute("aria-expanded", "false");
    scrim.hidden = true;
    await slide(nav, false);
    nav.classList.remove("is-open");
    nav.style.transform = "";
    nav.style.opacity = "";
    if (focusButton) menuBtn.focus();
  };
  menuBtn.addEventListener("click", () => (nav.classList.contains("is-open") ? closeNav(true) : openNav()));
  scrim.addEventListener("click", () => closeNav(true));
  nav.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && narrow.matches) closeNav(true);
  });
  narrow.addEventListener("change", () => closeNav());

  shell = { main, nav, closeNav };

  /* Orders badge in the side navigation: open orders still to send. */
  const paintCounts = () => {
    const n = store.derive().toFulfil;
    nav.querySelectorAll(".nav-count").forEach((el) => {
      el.textContent = String(n);
      el.hidden = !n;
      el.setAttribute("aria-label", `${n} to fulfill`);
    });
  };
  offShell = store.subscribe((topics) => {
    if (topics.has("orders")) paintCounts();
  });
}

function highlightNav(name) {
  if (!shell) return;
  shell.nav.querySelectorAll("a[data-routes]").forEach((a) => {
    const on = a.dataset.routes.split(" ").includes(name);
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

async function renderRoute(r) {
  if (!shell) return;
  const seq = ++routeSeq;
  closeMenus();
  shell.closeNav();
  if (cleanup) {
    try {
      cleanup();
    } catch (err) {
      console.error(err);
    }
    cleanup = null;
  }
  saveBar.hide();
  highlightNav(r.name);
  if (r.name === "orders") {
    unseen = 0;
    setTitleCount(0);
  }

  const load = VIEWS[r.name];
  if (!load) {
    setTitle("Page not found");
    shell.main.replaceChildren(page({}, pageHeader({ title: "Page not found" }),
      card({}, emptyState({ glyph: "search", title: "There's no page at this address", body: "Check the link, or use the menu.", action: button("Go to Home", { href: "/admin" }) }))));
    return;
  }
  shell.main.replaceChildren(loadingPage(""));
  let mod;
  try {
    mod = await load();
  } catch (err) {
    console.error(err);
    if (seq === routeSeq && shell) {
      shell.main.replaceChildren(page({}, card({}, emptyState({ glyph: "alert-triangle", title: "This page couldn't load",
        body: "Check your connection and try again.", action: button("Reload", { onClick: () => location.reload() }) }))));
    }
    return;
  }
  if (seq !== routeSeq || !shell) return; // a newer navigation (or a sign-out) won

  try {
    cleanup = mod.render(shell.main, r, session) || null;
  } catch (err) {
    console.error(err);
    shell.main.replaceChildren(page({}, card({}, emptyState({ glyph: "alert-triangle", title: "Something went wrong on this page",
      body: "Reload to try again. If it keeps happening, tell your developer what you were doing.", action: button("Reload", { onClick: () => location.reload() }) }))));
  }
  window.scrollTo(0, 0);
  const heading = shell.main.querySelector("h1");
  if (heading) heading.focus({ preventScroll: true });
  announce(document.title.replace(/^\(\d+\)\s*/, ""));
}

function teardown() {
  routeSeq += 1; // any screen still loading is abandoned
  if (cleanup) {
    try {
      cleanup();
    } catch {
      /* leaving anyway */
    }
    cleanup = null;
  }
  if (offShell) offShell();
  offShell = null;
  store.stop();
  saveBar.hide();
  shell = null;
  session = null;
  unseen = 0;
  setTitleCount(0);
}

/* --- Sign-in gate ---------------------------------------------------------------- */

function ready() {
  root.classList.remove("boot");
  root.removeAttribute("aria-busy");
}

onAuthStateChanged(auth, async (user) => {
  ready();
  if (!user) {
    teardown();
    renderLogin(root);
    return;
  }

  let claims;
  try {
    claims = (await user.getIdTokenResult(true)).claims;
  } catch {
    teardown();
    renderFatal(root, "Your account couldn't be checked. Check your connection and reload.");
    return;
  }
  if (claims.admin !== true) {
    teardown();
    renderNoAccess(root, user);
    return;
  }
  try {
    const staff = await getDoc(doc(db, "staff", user.uid));
    if (!staff.exists()) throw Object.assign(new Error("no staff record"), { code: "permission-denied" });
  } catch (err) {
    teardown();
    if (err && err.code === "permission-denied") renderNoAccess(root, user, "removed");
    else renderFatal(root, "The store's database couldn't be reached. Check your connection and reload.");
    return;
  }

  teardown();
  session = { user, claims };
  mountShell();
  store.start({
    newOrder,
    denied: () => {
      teardown();
      renderNoAccess(root, user, "removed");
    },
  });
  if (!routerStarted) {
    routerStarted = true;
    startRouter(renderRoute);
  } else {
    renderRoute(current());
  }
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("[admin] unhandled", e.reason);
});
