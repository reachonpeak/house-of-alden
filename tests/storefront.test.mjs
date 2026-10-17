/* The shop pages with their real scripts, in jsdom, against a fake network:
   the Firestore REST answer, /api/orders and window.open are all stand-ins.
   Checks the live catalogue, its fallbacks, stock caps and the checkout.
   npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

/* --- Fake Firestore REST ------------------------------------------------- */

function value(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === "number") return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(value) } : {} };
  return { mapValue: { fields: fieldsOf(v) } };
}
const fieldsOf = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, value(v)]));
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const product = (over = {}) => ({
  name: "The Alden Heritage",
  status: "active",
  category: "watches",
  price: 9100,
  compareAtPrice: 9900,
  images: [{ url: "https://firebasestorage.googleapis.com/v0/b/b/o/a.webp?alt=media&token=t", path: "products/a/1.webp", alt: "A new photograph" }],
  trackInventory: true,
  quantity: 2,
  continueSelling: false,
  badge: "",
  blurb: "Blurb",
  description: "Description",
  specs: [{ label: "Case", value: "38 mm" }],
  position: 10,
  seoTitle: "",
  seoDescription: "",
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});

const CATALOGUE = [
  ["alden-heritage", product()],
  ["pearl-drop", product({ name: "The Alden Pearl Drop", category: "earrings", price: 3400, compareAtPrice: null, trackInventory: false, quantity: 0, position: 20 })],
];
const SETTINGS = {
  whatsapp: "917087511282",
  email: "mannkawalpreet3@gmail.com",
  instagram: "https://instagram.com/",
  pinterest: "https://pinterest.com/",
  shipping: { flatRate: 0, freeAbove: 0 },
};

function network({ catalogue = CATALOGUE, settings = SETTINGS, status = 200, orders } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u.includes(":runQuery")) {
      if (status === 0) throw new TypeError("Failed to fetch");
      if (status !== 200) return reply(status, { error: { status: "PERMISSION_DENIED" } });
      return reply(200, catalogue.map(([id, data]) => ({
        document: { name: `projects/house-of-alden/databases/(default)/documents/products/${id}`, fields: fieldsOf(data) },
      })));
    }
    if (u.includes("/documents/settings/store")) {
      if (status === 0) throw new TypeError("Failed to fetch");
      return settings && status === 200 ? reply(200, { fields: fieldsOf(settings) }) : reply(status === 200 ? 404 : status, {});
    }
    if (u === "/api/orders") {
      if (!orders) throw new TypeError("Failed to fetch");
      return orders(JSON.parse(opts.body));
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return { fetch, calls };
}

/* A stand-in for the tab window.open() returns. */
function fakeTab(dom) {
  return {
    closed: false,
    opener: "set",
    url: null,
    document: dom ? dom.window.document.implementation.createHTMLDocument("") : null,
    location: {
      replace(u) {
        this.owner.url = u;
      },
    },
    close() {
      this.closed = true;
    },
  };
}

/* --- Loading a page ------------------------------------------------------ */

function load(page, { net = network(), storage = {}, open, query = "" } = {}) {
  let html = read(page);
  /* Inline every local script so jsdom runs the real code, in page order.
     "</script" inside a comment would end the element early — escape it. */
  html = html.replace(/<script src="\/?(js\/[\w-]+\.js)"([^>]*)><\/script>/g, (_, src, attrs) =>
    `<script${attrs}>${read(src).replace(/<\/script/gi, "<\\/script")}</script>`
  );
  const tab = { current: null };
  const dom = new JSDOM(html, {
    url: `https://shop.test/${page}${query}`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = net.fetch;
      window.open = () => {
        if (open === null) return null;
        const t = open ? open() : fakeTab();
        t.location.owner = t;
        if (!t.document) t.document = window.document.implementation.createHTMLDocument("");
        tab.current = t;
        return t;
      };
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      window.requestIdleCallback = () => 0; // the realtime SDK is not part of these tests
      if (!window.CSS) window.CSS = { escape: (s) => String(s) };
      Object.entries(storage).forEach(([k, v]) => window.localStorage.setItem(k, v));
    },
  });
  const w = dom.window;
  return { dom, w, doc: w.document, net, tab, js: (code) => w.eval(code) };
}

const cacheFrom = (page) => page.w.localStorage.getItem("hoa.live.v1");

/* --- Live catalogue ------------------------------------------------------ */

test("a first visit waits on placeholders, then shows the admin's catalogue", async () => {
  const page = load("index.html");
  const watches = page.doc.getElementById("shelf-watches-grid");
  assert.equal(watches.querySelectorAll(".is-placeholder").length, 4, "placeholders, not config.js prices");
  assert.equal(watches.getAttribute("aria-busy"), "true");

  await tick();
  assert.equal(watches.getAttribute("aria-busy"), null);
  const cards = watches.querySelectorAll(".product-card");
  assert.equal(cards.length, 1);
  assert.match(cards[0].textContent, /The Alden Heritage/);
  assert.match(cards[0].querySelector(".price").textContent, /Was ₹9,900\s+now ₹9,100/);
  assert.equal(cards[0].querySelector("img").getAttribute("alt"), "A new photograph");
  assert.equal(page.js("PRODUCTS.length"), 2);
  assert.equal(page.js("Live.source"), "live");
  assert.ok(cacheFrom(page), "kept for the next visit");
});

test("a returning visitor sees the saved catalogue at once", async () => {
  const first = load("index.html");
  await tick();
  const page = load("index.html", { storage: { "hoa.live.v1": cacheFrom(first) }, net: network({ status: 0 }) });
  const watches = page.doc.getElementById("shelf-watches-grid");
  assert.equal(watches.querySelectorAll(".is-placeholder").length, 0);
  assert.match(watches.textContent, /The Alden Heritage/);
  assert.equal(page.js("Live.source"), "cache");
});

test("if Firebase refuses (rules not published yet) the shop falls back to js/config.js", async () => {
  const page = load("collection.html", { net: network({ status: 403 }) });
  await tick();
  const grid = page.doc.getElementById("grid");
  assert.equal(grid.querySelectorAll(".is-placeholder").length, 0);
  assert.equal(grid.querySelectorAll(".product-card").length, 8, "all eight config.js pieces");
  assert.equal(page.js("Live.source"), "seed");
});

test("offline, the shop still works from js/config.js", async () => {
  const page = load("collection.html", { net: network({ status: 0 }) });
  await tick();
  assert.equal(page.doc.getElementById("grid").querySelectorAll(".product-card").length, 8);
});

test("drafts and malformed products never reach the shop", async () => {
  const net = network({
    catalogue: [
      ...CATALOGUE,
      ["secret", product({ name: "Unreleased", status: "draft" })],
      ["broken", product({ name: "", price: 100 })],
      ["bad-cat", product({ name: "Ring", category: "rings" })],
      ["evil-img", product({ name: "Evil", position: 30, images: [{ url: "javascript:alert(1)", alt: "" }] })],
    ],
  });
  const page = load("collection.html", { net });
  await tick();
  const names = [...page.doc.querySelectorAll("#grid h3")].map((h) => h.textContent);
  assert.deepEqual(names, ["The Alden Heritage", "The Alden Pearl Drop", "Evil"]);
  const evil = page.doc.querySelectorAll("#grid img")[2];
  assert.equal(evil.getAttribute("src"), "images/logo-mark.webp", "unsafe image replaced by the placeholder");
});

test("settings from the admin re-point WhatsApp, email and social links", async () => {
  const net = network({
    settings: { ...SETTINGS, whatsapp: "919999999999", email: "orders@example.com", instagram: "https://instagram.com/houseofalden", pinterest: "" },
  });
  const page = load("contact.html", { net });
  await tick();
  const hrefs = [...page.doc.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
  assert.ok(!hrefs.some((h) => h.startsWith("https://wa.me/917087511282")), "old number gone");
  assert.ok(hrefs.filter((h) => h.startsWith("https://wa.me/919999999999")).length >= 2);
  assert.ok(hrefs.includes("mailto:orders@example.com"));
  assert.ok(!hrefs.includes("mailto:mannkawalpreet3@gmail.com"));
  assert.ok([...page.doc.querySelectorAll("a")].some((a) => a.textContent === "orders@example.com"), "visible address updated");
  assert.ok(hrefs.includes("https://instagram.com/houseofalden"));
  const pin = [...page.doc.querySelectorAll(".footer-social a")].find((a) => a.textContent === "Pinterest");
  assert.equal(pin.closest("li").hidden, true, "no Pinterest set → link hidden");
  assert.equal(page.js("BUSINESS.whatsapp"), "919999999999");
});

/* --- Stock ---------------------------------------------------------------- */

test("tracked stock caps the quantity and the cart", async () => {
  const page = load("product.html", { query: "?id=alden-heritage" });
  await tick();
  const qty = page.doc.getElementById("pdp-qty");
  assert.equal(qty.max, "2");
  assert.equal(page.js("Cart.cap('alden-heritage')"), 2);
  assert.equal(page.js("Cart.add('alden-heritage', 5)"), 2);
  assert.equal(page.js("Cart.add('alden-heritage', 1)"), 0, "nothing more to add");
  assert.equal(page.js("Cart.count()"), 2);
  assert.match(page.doc.querySelector(".pdp-info .price").textContent, /₹9,100/);
});

test("tracked at zero means sold out everywhere", async () => {
  const net = network({ catalogue: [["alden-heritage", product({ quantity: 0 })]] });
  const page = load("product.html", { net, query: "?id=alden-heritage" });
  await tick();
  const add = [...page.doc.querySelectorAll(".pdp-actions .btn")].find((b) => b.textContent === "Add to cart");
  assert.equal(add.disabled, true);
  assert.match(page.doc.querySelector(".pdp-actions .notice").textContent, /Sold out/);
  assert.equal(page.js("Cart.add('alden-heritage', 1)"), 0);
});

test("an open product page redraws when the admin changes it, keeping the chosen quantity", async () => {
  const page = load("product.html", { query: "?id=pearl-drop" });
  await tick();
  page.doc.getElementById("pdp-qty").value = "3";
  page.js("PRODUCTS.find((p) => p.id === 'pearl-drop').price = 3600; document.dispatchEvent(new CustomEvent('hoa:live'))");
  assert.match(page.doc.querySelector(".pdp-info .price").textContent, /₹3,600/);
  assert.equal(page.doc.getElementById("pdp-qty").value, "3");
});

/* --- Checkout ------------------------------------------------------------ */

const CART = JSON.stringify([{ id: "alden-heritage", qty: 1 }]);

async function checkout({ orders, open, cart = CART } = {}) {
  const warm = load("index.html");
  await tick();
  const net = network({ orders });
  const page = load("cart.html", { net, open, storage: { "hoa.live.v1": cacheFrom(warm), "hoa.cart.v1": cart } });
  await tick();
  const form = page.doc.querySelector("#cart-root form");
  form.querySelector('[name="name"]').value = "Asha";
  form.querySelector('[name="name"]').dispatchEvent(new page.w.Event("input"));
  form.dispatchEvent(new page.w.Event("submit", { cancelable: true }));
  await tick(40);
  return page;
}

test("checkout records the order, then opens WhatsApp with its number", async () => {
  let sent;
  const page = await checkout({
    orders: (body) => {
      sent = body;
      return reply(201, {
        ok: true,
        order: {
          id: "web-x", name: "#1001", number: 1001,
          lines: [{ id: "alden-heritage", name: "The Alden Heritage", qty: 1, price: 9100, total: 9100 }],
          subtotal: 9100, shipping: 0, total: 9100, currency: "INR",
        },
      });
    },
  });
  assert.deepEqual(sent.lines, [{ id: "alden-heritage", qty: 1 }], "no prices are sent");
  assert.match(sent.token, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(sent.customer.name, "Asha");
  assert.equal(sent.website, "");

  const tab = page.tab.current;
  assert.equal(tab.opener, null, "opener severed");
  assert.ok(tab.url.startsWith("https://wa.me/917087511282?text="));
  const text = decodeURIComponent(tab.url.split("?text=")[1]);
  assert.match(text, /New order #1001 — House of Alden/);
  assert.match(text, /The Alden Heritage × 1 — ₹9,100/);
  assert.match(text, /Name: Asha/);

  assert.equal(page.w.localStorage.getItem("hoa.cart.v1"), "[]", "cart emptied once recorded");
  const notice = page.doc.querySelector(".notice");
  assert.match(notice.textContent, /order #1001 is placed/);
  assert.equal(notice.querySelector("a").getAttribute("href"), tab.url);
});

test("if the shop says it just sold out, the tab closes and the cart stays", async () => {
  const page = await checkout({
    orders: () => reply(409, { ok: false, code: "stock", error: "Sorry — The Alden Heritage is no longer available. Please update your cart." }),
  });
  assert.equal(page.tab.current.closed, true);
  assert.equal(page.tab.current.url, null);
  assert.equal(page.w.localStorage.getItem("hoa.cart.v1"), CART);
  const alert = page.doc.querySelector('.notice[role="alert"]');
  assert.match(alert.textContent, /no longer available/);
});

test("if the order server cannot be reached, the order still goes to WhatsApp", async () => {
  const page = await checkout({ orders: undefined });
  const text = decodeURIComponent(page.tab.current.url.split("?text=")[1]);
  assert.match(text, /^\*New order — House of Alden\*/);
  assert.match(text, /Total: ₹9,100/);
  assert.equal(page.w.localStorage.getItem("hoa.cart.v1"), CART, "cart kept, exactly as before");
  assert.match(page.doc.querySelector(".notice").textContent, /opened in WhatsApp/);
});

test("a server error (or rate limit) also falls back to WhatsApp", async () => {
  for (const status of [429, 500, 404]) {
    const page = await checkout({ orders: () => reply(status, { ok: false, error: "x" }) });
    assert.ok(page.tab.current.url.startsWith("https://wa.me/"), String(status));
  }
});

test("a blocked pop-up is reported and nothing is sent", async () => {
  let called = false;
  const page = await checkout({ open: null, orders: () => { called = true; return reply(201, {}); } });
  assert.equal(called, false);
  assert.match(page.doc.querySelector(".notice").textContent, /allow pop-ups/);
});
