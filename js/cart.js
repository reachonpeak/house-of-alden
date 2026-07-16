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
      if (!byId(line.id)) return acc;         // product deleted from config.js
      const qty = Math.min(MAX_QTY, Math.max(1, Math.floor(Number(line.qty)) || 1));
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

    add(id, qty = 1) {
      const p = byId(id);
      if (!p || !p.stock) return false;
      const lines = read();
      const hit = lines.find((l) => l.id === id);
      if (hit) hit.qty = Math.min(MAX_QTY, hit.qty + qty);
      else lines.push({ id, qty: Math.min(MAX_QTY, Math.max(1, qty)) });
      write(lines);
      return true;
    },

    setQty(id, qty) {
      const n = Math.floor(Number(qty));
      if (!Number.isFinite(n) || n < 1) return api.remove(id);
      write(read().map((l) => (l.id === id ? { ...l, qty: Math.min(MAX_QTY, n) } : l)));
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

  const providers = {
    /* ---- LIVE: WhatsApp ------------------------------------------------- */
    whatsapp(details) {
      const { lines, subtotal, shipping, total } = Cart.totals();
      const L = [];
      L.push(`*New order — ${BUSINESS.name}*`, "");
      lines.forEach((l) => {
        L.push(`• ${l.name} × ${l.qty} — ${Money.format(l.lineTotal)}`);
      });
      L.push("", `Subtotal: ${Money.format(subtotal)}`);
      if (shipping > 0) L.push(`Shipping: ${Money.format(shipping)}`);
      L.push(`*Total: ${Money.format(total)}*`);
      if (details?.name)    L.push("", `Name: ${details.name}`);
      if (details?.phone)   L.push(`Phone: ${details.phone}`);
      if (details?.address) L.push(`Address: ${details.address}`);
      if (details?.notes)   L.push(`Notes: ${details.notes}`);

      const url = `https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent(L.join("\n"))}`;

      /* Opened synchronously inside the click so mobile Safari doesn't
         swallow it as an unrequested popup.

         "noopener" is deliberately NOT in the feature string. Per the HTML spec
         ("window open steps": if noopener is true, return null), window.open()
         returns null whenever noopener is set — even when the tab opened fine.
         Passing it would make the check below fire on every successful order,
         showing the customer a pop-up warning that was never true and marking a
         real order as failed. The opener is severed by hand instead: the
         security property is kept, and null once again means genuinely blocked. */
      const win = window.open(url, "_blank");
      if (!win) return { ok: false, reason: "Please allow pop-ups to send your order on WhatsApp." };
      try { win.opener = null; } catch { /* already detached */ }
      return { ok: true, cleared: false };
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
