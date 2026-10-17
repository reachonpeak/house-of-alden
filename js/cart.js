/* ==========================================================================
   HOUSE OF ALDEN — cart engine
   Depends on: config.js (BUSINESS, PRODUCTS)
   You should not need to edit this file. Edit js/config.js instead.
   ========================================================================== */

const Cart = (() => {
  const KEY = "hoa.cart.v1";
  const MAX_QTY = 99;
  const listeners = new Set();

  const byId = (id) => PRODUCTS.find((p) => p.id === id);

  /* How many of a piece one cart may hold: the shop-wide ceiling, or fewer
     when the admin tracks stock and only a few are left (maxQty, set by
     js/live.js). Never below 1 — a sold-out line stays visible so the
     customer is told, and checkout refuses it. */
  const capOf = (p) => {
    const n = Math.floor(Number(p && p.maxQty));
    return Number.isFinite(n) ? Math.max(1, Math.min(MAX_QTY, n)) : MAX_QTY;
  };

  /* Read + heal. Anything we can't trust is discarded rather than thrown —
     a corrupt key must never take the whole shop down. */
  function read() {
    let raw;
    try {
      raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch {
      return [];
    }
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw.reduce((acc, line) => {
      if (!line || typeof line.id !== "string") return acc;
      if (seen.has(line.id)) return acc;      // collapse accidental duplicates
      const p = byId(line.id);
      if (!p) return acc;                     // product deleted or taken off sale
      const qty = Math.min(capOf(p), Math.max(1, Math.floor(Number(line.qty)) || 1));
      seen.add(line.id);
      acc.push({ id: line.id, qty });
      return acc;
    }, []);
  }

  function write(lines) {
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
    } catch {
      /* Private browsing / quota. The cart still works for this page view. */
    }
    listeners.forEach((fn) => fn());
  }

  const api = {
    /** Raw lines: [{id, qty}] */
    get: read,

    /** Lines joined to product data, ready to render. */
    lines() {
      return read()
        .map((l) => {
          const p = byId(l.id);
          return p ? { ...p, qty: l.qty, lineTotal: p.price * l.qty } : null;
        })
        .filter(Boolean);
    },

    count() {
      return read().reduce((n, l) => n + l.qty, 0);
    },

    totals() {
      const lines = api.lines();
      const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0);
      const { flatRate, freeAbove } = BUSINESS.shipping;
      const shipping =
        lines.length === 0 || flatRate === 0 || (freeAbove > 0 && subtotal >= freeAbove)
          ? 0
          : flatRate;
      return { lines, subtotal, shipping, total: subtotal + shipping, count: api.count() };
    },

    /** Adds up to `qty` units, never past the piece's cap.
        @returns {number} how many were actually added (0 = none). */
    add(id, qty = 1) {
      const p = byId(id);
      if (!p || !p.stock) return 0;
      const lines = read();
      const hit = lines.find((l) => l.id === id);
      const before = hit ? hit.qty : 0;
      const after = Math.min(capOf(p), before + Math.max(1, Math.floor(Number(qty)) || 1));
      if (after <= before) return 0;
      if (hit) hit.qty = after;
      else lines.push({ id, qty: after });
      write(lines);
      return after - before;
    },

    setQty(id, qty) {
      const n = Math.floor(Number(qty));
      if (!Number.isFinite(n) || n < 1) return api.remove(id);
      write(read().map((l) => (l.id === id ? { ...l, qty: Math.min(capOf(byId(id)), n) } : l)));
    },

    /** The most of this piece one cart may hold right now. */
    cap(id) {
      return capOf(byId(id));
    },

    remove(id) {
      write(read().filter((l) => l.id !== id));
    },

    clear() {
      write([]);
    },

    /** Register a callback fired on every change. Returns an unsubscribe fn. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  /* Keep tabs in sync — two windows, one cart. */
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) listeners.forEach((fn) => fn());
  });

  /* A price, the stock or the shipping changed in the admin (js/live.js):
     everything drawn from the cart — the count, the cart page — redraws. */
  document.addEventListener("hoa:live", () => listeners.forEach((fn) => fn()));

  return api;
})();

/* --------------------------------------------------------------------------
   Money
   -------------------------------------------------------------------------- */
const Money = {
  format(n) {
    const { locale, code } = BUSINESS.currency;
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(n);
    } catch {
      return `${BUSINESS.currency.symbol}${n.toLocaleString("en-IN")}`;
    }
  },
};

/* ==========================================================================
   Checkout
   --------------------------------------------------------------------------
   Two providers behind one interface. Switch with BUSINESS.checkout.provider
   in js/config.js — no other file changes.
   ========================================================================== */
const Checkout = (() => {
  /** Shared guard: never let a broken order leave the page. */
  function validate() {
    const { lines, total } = Cart.totals();
    if (!lines.length) return { ok: false, reason: "Your cart is empty." };
    const dead = lines.filter((l) => !l.stock);
    if (dead.length) {
      return {
        ok: false,
        reason: `${dead.map((d) => d.name).join(", ")} is no longer available. Please remove it to continue.`,
      };
    }
    if (total <= 0) return { ok: false, reason: "Order total is invalid." };
    return { ok: true };
  }

  /* ---- Recording the order -------------------------------------------- */
  /* Every order is written to the shop's admin (/api/orders) before WhatsApp
     opens, so it gets a number and stock is set aside. The server prices it
     from the database — nothing the browser says about money is believed.

     It never costs a sale: if the server cannot be reached (offline, opened
     from disk, a hiccup) the order still goes to WhatsApp, just without a
     number. Only a definite "no" from the shop — something sold out a moment
     ago — stops it. */
  const ORDER_URL = "/api/orders";
  const ORDER_TIMEOUT = 10000;
  const TOKEN_KEY = "hoa.checkout.v1";

  /* One random token per cart. A retry after a dropped connection sends the
     same token and gets back the order already placed instead of a second
     one. A different cart, or half an hour, and it is a new order. */
  function checkoutToken() {
    const sig = JSON.stringify(Cart.get());
    try {
      const saved = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
      if (saved && saved.sig === sig && Date.now() - saved.at < 30 * 60 * 1000 &&
          /^[A-Za-z0-9_-]{16,64}$/.test(saved.token)) return saved.token;
    } catch { /* unreadable — make a fresh one */ }
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ sig, token, at: Date.now() })); } catch { /* fine */ }
    return token;
  }

  /** @returns {Promise<object|null>} the recorded order, or null if it could not be recorded */
  async function recordOrder(details) {
    if (!/^https?:$/.test(location.protocol)) return null; // opened from disk: no server here
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ORDER_TIMEOUT);
    let res, data;
    try {
      res = await fetch(ORDER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        signal: ctrl.signal,
        body: JSON.stringify({
          lines: Cart.get(),
          customer: {
            name: details?.name || "",
            phone: details?.phone || "",
            address: details?.address || "",
            notes: details?.notes || "",
          },
          token: checkoutToken(),
          website: "", // a field no person fills in — see api/orders.js
        }),
      });
      data = await res.json().catch(() => null);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
    if (res.ok && data && data.ok && data.order) return data.order;
    if (res.status === 409 && data && data.error) throw new Error(data.error);
    return null;
  }

  function orderMessage(order, snap, details) {
    const L = [];
    L.push(order ? `*New order ${order.name} — ${BUSINESS.name}*` : `*New order — ${BUSINESS.name}*`, "");
    const lines = order ? order.lines : snap.lines.map((l) => ({ name: l.name, qty: l.qty, total: l.lineTotal }));
    lines.forEach((l) => {
      L.push(`• ${l.name} × ${l.qty} — ${Money.format(l.total)}`);
    });
    const { subtotal, shipping, total } = order || snap;
    L.push("", `Subtotal: ${Money.format(subtotal)}`);
    if (shipping > 0) L.push(`Shipping: ${Money.format(shipping)}`);
    L.push(`*Total: ${Money.format(total)}*`);
    if (details?.name)    L.push("", `Name: ${details.name}`);
    if (details?.phone)   L.push(`Phone: ${details.phone}`);
    if (details?.address) L.push(`Address: ${details.address}`);
    if (details?.notes)   L.push(`Notes: ${details.notes}`);
    return L.join("\n");
  }

  /* The tab is open before the order is recorded, so for that second it says
     what is happening instead of sitting blank. */
  function holdingPage(win) {
    try {
      const doc = win.document;
      doc.title = `${BUSINESS.name} — preparing your order`;
      doc.body.style.cssText = "margin:0;background:#EDE4D1;color:#3B2B1A;font:17px/1.6 Georgia,serif;text-align:center";
      const p = doc.createElement("p");
      p.style.marginTop = "38vh";
      p.textContent = "Preparing your order…";
      doc.body.append(p);
    } catch { /* a browser that won't let us write here still navigates the tab */ }
  }

  const providers = {
    /* ---- LIVE: WhatsApp ------------------------------------------------- */
    whatsapp(details) {
      /* Opened synchronously inside the click so mobile Safari doesn't
         swallow it as an unrequested popup — blank for now, and pointed at
         WhatsApp once the order has its number.

         "noopener" is deliberately NOT in the feature string. Per the HTML spec
         ("window open steps": if noopener is true, return null), window.open()
         returns null whenever noopener is set — even when the tab opened fine.
         Passing it would make the check below fire on every successful order,
         showing the customer a pop-up warning that was never true and marking a
         real order as failed. The opener is severed by hand instead: the
         security property is kept, and null once again means genuinely blocked. */
      const win = window.open("", "_blank");
      if (!win) return { ok: false, reason: "Please allow pop-ups to send your order on WhatsApp." };
      try { win.opener = null; } catch { /* already detached */ }
      holdingPage(win);

      const snap = Cart.totals();
      return recordOrder(details).then(
        (order) => {
          const url = `https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent(orderMessage(order, snap, details))}`;
          if (!win.closed) {
            try { win.location.replace(url); } catch { /* the link in the notice still works */ }
          }
          /* Recorded: the shop has the order, so the cart's job is done. Not
             recorded: keep the cart, exactly as before, in case WhatsApp failed. */
          if (order) {
            Cart.clear();
            return { ok: true, cleared: true, recorded: true, order: order.name, url };
          }
          return { ok: true, cleared: false, url };
        },
        (err) => {
          try { win.close(); } catch { /* already gone */ }
          return { ok: false, reason: err.message };
        }
      );
    },

    /* ---- READY, NOT WIRED: Razorpay ------------------------------------- */
    /* See RAZORPAY.md. Needs: a keyId in config.js, the Razorpay script in the
       page, and a server that signs the order. Fails loudly until then —
       a silent no-op here would look like a lost sale. */
    async razorpay(details) {
      const cfg = BUSINESS.checkout.razorpay;
      if (!cfg.keyId) {
        return { ok: false, reason: "Razorpay is not configured yet. See RAZORPAY.md." };
      }
      if (typeof window.Razorpay === "undefined") {
        return { ok: false, reason: "Razorpay checkout script is not loaded. See RAZORPAY.md." };
      }
      const { total } = Cart.totals();
      let order;
      try {
        const res = await fetch(cfg.createOrderUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: total * 100, currency: BUSINESS.currency.code, lines: Cart.get() }),
        });
        if (!res.ok) throw new Error(String(res.status));
        order = await res.json();
      } catch {
        return { ok: false, reason: "Could not reach the payment server. Please try again." };
      }
      return new Promise((resolve) => {
        new window.Razorpay({
          key: cfg.keyId,
          order_id: order.id,
          amount: order.amount,
          currency: order.currency,
          name: BUSINESS.name,
          prefill: { name: details?.name || "", contact: details?.phone || "" },
          theme: { color: "#3A2A19" },
          handler: () => {
            Cart.clear();
            resolve({ ok: true, cleared: true });
          },
          modal: { ondismiss: () => resolve({ ok: false, reason: "Payment cancelled." }) },
        }).open();
      });
    },
  };

  return {
    get provider() {
      return BUSINESS.checkout.provider;
    },
    /** @returns {Promise<{ok:boolean, reason?:string, cleared?:boolean}>} */
    async place(details) {
      const gate = validate();
      if (!gate.ok) return gate;
      const run = providers[BUSINESS.checkout.provider];
      if (!run) return { ok: false, reason: `Unknown checkout provider "${BUSINESS.checkout.provider}".` };
      return run(details);
    },
  };
})();
