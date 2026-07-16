/* ==========================================================================
   HOUSE OF ALDEN — cart page
   Builds the cart, the summary and the checkout form into #cart-root.
   Depends on: config.js (BUSINESS), cart.js (Cart, Money, Checkout)
   You should not need to edit this file. Edit js/config.js instead.
   ========================================================================== */

(() => {
  const root = document.getElementById("cart-root");
  if (!root) return;

  const SVG_NS = "http://www.w3.org/2000/svg";

  /* Typed details outlive the render. A quantity change redraws the whole
     cart, and it must never swallow an address someone has already written. */
  const details = { name: "", phone: "", address: "", notes: "" };

  /* The result of the last checkout attempt: {role, text} or null. Held out
     here for the same reason — a redraw must not lose it. */
  let notice = null;

  /* Guards a double submit while a provider is still resolving. */
  let submitting = false;

  /* --- Live region ---------------------------------------------------------
     Kept OUTSIDE #cart-root: announcing from inside it would mean replacing
     the node in the same tick a screen reader was meant to read it. */
  const live = document.createElement("p");
  live.className = "visually-hidden";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  root.before(live);

  const announce = (msg) => { live.textContent = msg; };

  /* --- Small builders ------------------------------------------------------ */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(id, width, height, viewBox, className) {
    const svg = document.createElementNS(SVG_NS, "svg");
    if (className) svg.setAttribute("class", className);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#${id}`);
    svg.appendChild(use);
    return svg;
  }

  /* Prices carry a hidden label — three bare numerals in a row tell a screen
     reader nothing about which is which. */
  function priceCell(label, amount) {
    const cell = el("div", "price");
    cell.appendChild(el("span", "visually-hidden", label));
    cell.appendChild(document.createTextNode(Money.format(amount)));
    return cell;
  }

  /* --- Mutations ----------------------------------------------------------- */
  /* Every mutation clears the notice first: Cart's write() fires listeners
     synchronously, so a stale confirmation would otherwise be redrawn. */
  function setQty(line, qty) {
    notice = null;
    if (qty < 1) {
      Cart.remove(line.id);
      announce(`${line.name} removed from your cart.`);
      return;
    }
    const n = Math.min(99, qty);
    if (n === line.qty) { render(); return; }   // at the ceiling — redraw to reset the field
    Cart.setQty(line.id, n);
    announce(
      `${line.name}, quantity ${n}. Line total ${Money.format(line.price * n)}. ` +
      `Order total ${Money.format(Cart.totals().total)}.`
    );
  }

  function removeLine(line) {
    notice = null;
    Cart.remove(line.id);
    announce(`${line.name} removed from your cart.`);
  }

  /* --- Rows ---------------------------------------------------------------- */
  function renderRow(line) {
    const row = el("li", "cart-row");

    const img = el("img");
    img.src = line.image;
    img.alt = line.alt;
    img.width = 96;
    img.height = 96;
    img.loading = "lazy";
    row.appendChild(img);

    /* .cart-row is a five-column grid, so the name and its remove control
       share the 1fr column; price, quantity and line total take the rest. */
    const nameCell = el("div");
    const heading = el("h3");
    const link = el("a", null, line.name);
    link.href = `product.html?id=${encodeURIComponent(line.id)}`;
    heading.appendChild(link);
    nameCell.appendChild(heading);

    const remove = el("button", "cart-remove", "Remove");
    remove.type = "button";
    remove.dataset.focusKey = `remove:${line.id}`;
    remove.setAttribute("aria-label", `Remove ${line.name} from your cart`);
    remove.addEventListener("click", () => removeLine(line));
    nameCell.appendChild(remove);
    row.appendChild(nameCell);

    row.appendChild(priceCell("Price each: ", line.price));
    row.appendChild(renderQty(line));
    row.appendChild(priceCell("Line total: ", line.lineTotal));

    return row;
  }

  function renderQty(line) {
    const wrap = el("div", "qty");

    const dec = el("button", null, "−");
    dec.type = "button";
    dec.dataset.focusKey = `dec:${line.id}`;
    dec.setAttribute("aria-label", `Decrease quantity of ${line.name}`);
    dec.addEventListener("click", () => setQty(line, line.qty - 1));

    /* type="text" + inputmode: a number input's spinners would eat half of a
       46px field, and the keypad is what actually matters on a phone. */
    const input = el("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.value = String(line.qty);
    input.dataset.focusKey = `qty:${line.id}`;
    input.setAttribute("aria-label", `Quantity of ${line.name}`);
    input.addEventListener("change", () => {
      const n = Math.floor(Number(input.value.trim()));
      /* Cart.setQty reads anything below 1 — including a typo, or a cleared
         field — as a removal. A stray keystroke must not delete a line, so
         reject it and redraw the real quantity instead. Remove is a button. */
      if (!Number.isFinite(n) || n < 1) { render(); return; }
      setQty(line, n);
    });

    const inc = el("button", null, "+");
    inc.type = "button";
    inc.dataset.focusKey = `inc:${line.id}`;
    inc.setAttribute("aria-label", `Increase quantity of ${line.name}`);
    inc.addEventListener("click", () => setQty(line, line.qty + 1));

    wrap.append(dec, input, inc);
    return wrap;
  }

  /* --- Summary + checkout -------------------------------------------------- */
  function summaryRow(label, value, className) {
    const row = el("div", className);
    row.appendChild(el("span", null, label));
    row.appendChild(el("span", "price", value));
    return row;
  }

  function renderSummary(totals) {
    const box = el("div", "cart-summary");
    box.appendChild(summaryRow("Subtotal", Money.format(totals.subtotal)));
    /* Shipping is free while flatRate is 0 in config.js. Say the word rather
       than print a zero — nobody reads ₹0 as good news. */
    box.appendChild(summaryRow("Shipping", totals.shipping === 0 ? "Free" : Money.format(totals.shipping)));
    box.appendChild(summaryRow("Total", Money.format(totals.total), "total"));
    box.appendChild(renderForm());
    return box;
  }

  function field(labelText, key, type, autocomplete) {
    const label = el("label", "field");
    label.appendChild(el("span", null, `${labelText} (optional)`));

    const input = type === "textarea" ? el("textarea") : el("input");
    if (type !== "textarea") input.type = type;
    input.className = "input";
    input.name = key;
    input.value = details[key];
    if (autocomplete) input.autocomplete = autocomplete;
    input.dataset.focusKey = `field:${key}`;
    input.addEventListener("input", () => { details[key] = input.value; });

    label.appendChild(input);
    return label;
  }

  function renderForm() {
    const form = el("form");
    form.noValidate = true;
    form.addEventListener("submit", onSubmit);

    /* All four are optional; the order can be finished in conversation.
       Phone stays permissive — +91, spaces and brackets are all fine. */
    form.appendChild(field("Name", "name", "text", "name"));
    form.appendChild(field("Phone", "phone", "tel", "tel"));
    form.appendChild(field("Address", "address", "textarea", "street-address"));
    form.appendChild(field("Notes", "notes", "textarea"));

    if (notice) form.appendChild(noticeNode());

    const wa = Checkout.provider === "whatsapp";
    const btn = el("button", wa ? "btn btn--solid btn--wa" : "btn btn--solid");
    btn.type = "submit";
    btn.dataset.focusKey = "checkout";
    if (wa) {
      /* .cart-summary .btn stretches the button to 100% and centres it with
         text-align — which a flex container ignores, and .btn--wa is
         inline-flex. Without this the label sits hard against the left padding.
         Belongs in style.css as `.btn--wa { justify-content: center; }`. */
      btn.style.justifyContent = "center";
      btn.appendChild(icon("i-wa", 15, 15, "0 0 24 24"));
      btn.appendChild(document.createTextNode("Place order on WhatsApp"));
    } else {
      btn.textContent = "Pay now";
    }
    form.appendChild(btn);

    return form;
  }

  function noticeNode() {
    /* A <p>, not a <div>: .cart-summary lays every descendant div out as a
       space-between totals row. */
    const p = el("p", "notice", notice.text);
    p.setAttribute("role", notice.role);
    return p;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    submitting = true;

    let result;
    try {
      /* Reached synchronously from the submit: the WhatsApp provider calls
         window.open(), and a pop-up blocker eats it if it happens after an
         await. Only the resolution is awaited. */
      result = await Checkout.place({ ...details });
    } catch {
      result = { ok: false, reason: "Something went wrong sending your order. Please try again, or message us on WhatsApp." };
    } finally {
      submitting = false;
    }

    if (!result.ok) {
      notice = { role: "alert", text: result.reason };
    } else if (result.cleared) {
      /* A provider that took payment has already emptied the cart itself. */
      notice = { role: "status", text: "Payment received. Your order is confirmed and we will write to you about dispatch." };
    } else {
      notice = {
        role: "status",
        text: "Your order has opened in WhatsApp. Press send there and it reaches us, and we will reply to confirm. " +
              "Your cart has been kept until then.",
      };
    }
    render();
  }

  /* --- Empty --------------------------------------------------------------- */
  function renderEmpty() {
    const box = el("div", "empty");
    box.appendChild(icon("i-flourish", 140, 14, "0 0 140 14", "ornament"));
    box.appendChild(el("p", null, "Your cart is empty. Anything you set aside will wait here until you are ready."));
    const link = el("a", "btn btn--ghost", "View the collection");
    link.href = "collection.html";
    box.appendChild(link);
    return box;
  }

  /* --- Render -------------------------------------------------------------- */
  function render() {
    /* The whole subtree is rebuilt, so remember what had focus and give it
       back — otherwise pressing + twice drops the caret on the floor. */
    const active = document.activeElement;
    const hadFocus = !!(active && root.contains(active));
    const focusKey = hadFocus && active.dataset ? active.dataset.focusKey : null;
    /* Which row it was on. Remove destroys the very control that was focused,
       so its key will not come back — the row index is what lets focus land on
       whatever moves up into its place instead of falling to <body>. */
    const rowIndex = hadFocus
      ? [...root.querySelectorAll(".cart-row")].findIndex((r) => r.contains(active))
      : -1;

    const { lines, subtotal, shipping, total } = Cart.totals();
    root.textContent = "";

    if (!lines.length) {
      /* No summary and no checkout button with nothing to buy. */
      if (notice) root.appendChild(noticeNode());
      const empty = renderEmpty();
      root.appendChild(empty);
      /* Removing the last line takes the focused control with it. Hand focus
         to the one thing left rather than drop the keyboard at the top. */
      if (hadFocus) empty.querySelector("a").focus();
      return;
    }

    const list = el("ul", "cart-table");
    /* Explicit role: the reset strips list-style, and WebKit drops list
       semantics along with it. */
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", "Items in your cart");
    lines.forEach((line) => list.appendChild(renderRow(line)));
    root.appendChild(list);
    root.appendChild(renderSummary({ subtotal, shipping, total }));

    if (!focusKey) return;
    const back = root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    if (back) { back.focus(); return; }
    /* The key is gone, so its row was the one just removed. Put focus on the
       same control of the row that took its place, or of the new last row. */
    const peers = root.querySelectorAll(`[data-focus-key^="${focusKey.split(":")[0]}:"]`);
    if (peers.length && rowIndex > -1) peers[Math.min(rowIndex, peers.length - 1)].focus();
  }

  Cart.onChange(render);
  render();
})();
