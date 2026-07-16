# Turning on real payments (Razorpay)

Right now the shop takes orders **on WhatsApp**. That works today and costs nothing.
This document is for later — when you want customers to pay by UPI, card or netbanking
on the site itself.

The site was built so that switching is a **one-word change** in `js/config.js`, plus
one small server that you must run. Read the whole page before starting.

---

## Why a server is unavoidable

Razorpay gives you two keys:

| Key | Looks like | Safe in `config.js`? |
|---|---|---|
| Key ID | `rzp_live_AbC123...` | **Yes** — it is public by design |
| Key **Secret** | `xxxxxxxxxxxx` | **NO. Never.** |

`config.js` is downloaded by every visitor. Anyone can read it. If the Key Secret is
in there, anyone can take money using your account, and Razorpay will hold you
responsible. The Secret must live only on a server that you control.

There is no way around this. Any guide that tells you to put the Secret in the browser
is wrong and will get your account drained.

---

## Step 1 — Razorpay account

1. Sign up at <https://razorpay.com>.
2. Complete KYC. Keep these to hand — you already have them:
   - Udyam certificate — `UDYAM-PB-03-0079079`
   - Business PAN
   - Bank account in the business name (for settlements)
3. Dashboard → **Settings → API Keys → Generate Live Key**.
4. Copy both. The Secret is shown **once** — store it somewhere safe.

Test everything with the **Test Mode** keys (`rzp_test_...`) first.

---

## Step 2 — The order server

This is the only new thing you have to run. Deploy it anywhere that runs Node
(Render, Railway, Vercel Functions, a small VPS). It does two jobs: create orders,
and verify that a payment really happened.

```js
// server.js  —  npm install express razorpay
const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const rzp = new Razorpay({
  key_id: process.env.RZP_KEY_ID,
  key_secret: process.env.RZP_KEY_SECRET,   // <-- env var, never in the repo
});

// Your real prices. The browser is NOT allowed to decide what things cost.
const PRICES = {
  "alden-heritage": 8900, "maur-field": 6400, "regent-moonphase": 14500,
  "ward-slim": 7200, "pearl-drop": 3400, "filigree-hoop": 2900,
  "rosette-stud": 2200, "vine-chandelier": 4600,
};

const app = express();
app.use(express.json());

app.post("/api/create-order", async (req, res) => {
  // Recompute the total from the line items. IGNORE req.body.amount entirely —
  // a customer can edit it in their browser and pay ₹1 for a ₹14,500 watch.
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  let total = 0;
  for (const l of lines) {
    const price = PRICES[l.id];
    if (!price) return res.status(400).json({ error: "unknown item" });
    const qty = Math.min(99, Math.max(1, parseInt(l.qty, 10) || 0));
    total += price * qty;
  }
  if (total <= 0) return res.status(400).json({ error: "empty order" });

  const order = await rzp.orders.create({
    amount: total * 100,          // Razorpay works in paise
    currency: "INR",
    receipt: "hoa_" + Date.now(),
  });
  res.json(order);                // { id, amount, currency } -> back to cart.js
});

// Razorpay calls this after a payment. This — not the browser — is what you trust.
app.post("/api/razorpay-webhook", express.raw({ type: "*/*" }), (req, res) => {
  const sig = req.headers["x-razorpay-signature"];
  const expected = crypto
    .createHmac("sha256", process.env.RZP_WEBHOOK_SECRET)
    .update(req.body)
    .digest("hex");
  if (sig !== expected) return res.status(400).send("bad signature");

  const event = JSON.parse(req.body.toString());
  if (event.event === "payment.captured") {
    // Paid for real. Record the order, then pack it.
    console.log("PAID", event.payload.payment.entity.order_id);
  }
  res.json({ ok: true });
});

app.listen(3000);
```

Set the webhook up at Dashboard → **Settings → Webhooks**, pointing at
`https://your-server/api/razorpay-webhook`, subscribed to `payment.captured`.

> **The rule:** an order is only real when the *webhook* says so. A customer's browser
> claiming "payment succeeded" proves nothing — it can be faked. Never pack a parcel
> on the strength of the browser alone.

---

## Step 3 — Load the Razorpay script

In `cart.html`, add this line just **above** the `<script src="js/config.js">` line:

```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

---

## Step 4 — Flip the switch

In `js/config.js`, change the `checkout` block:

```js
checkout: {
  provider: "razorpay",                        // was "whatsapp"
  razorpay: {
    keyId: "rzp_live_AbC123...",               // your Key ID (public — fine here)
    createOrderUrl: "https://your-server/api/create-order",
  },
},
```

That is the whole change on the site side. `js/cart.js` already contains the Razorpay
path — it opens the Razorpay modal, and clears the cart only on a successful payment.

---

## Step 5 — Test before going live

Use **Test Mode** keys and Razorpay's test cards (e.g. card `4111 1111 1111 1111`,
any future expiry, any CVV). Walk the whole path:

- [ ] Add two different items, change a quantity, then check out.
- [ ] The amount in the Razorpay modal matches the cart total.
- [ ] Complete a payment → the cart empties and the webhook logs `PAID`.
- [ ] Cancel the modal → cart is **still full**, nothing is charged.
- [ ] Turn the server off → you get a readable error, not a blank page.
- [ ] Try editing the price in the browser console → the server refuses the order.

Only then swap the test keys for live ones.

---

## If it goes wrong

The site fails loudly on purpose. If Razorpay is misconfigured, the customer sees a
clear message rather than a silently broken button:

| Message | Cause |
|---|---|
| "Razorpay is not configured yet. See RAZORPAY.md." | `keyId` is still empty in `config.js` |
| "Razorpay checkout script is not loaded." | Step 3 was skipped |
| "Could not reach the payment server." | `createOrderUrl` is wrong, or the server is down |

To go back to WhatsApp at any time, set `provider: "whatsapp"`. Nothing else changes.
