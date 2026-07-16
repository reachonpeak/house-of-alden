/* ==========================================================================
   HOUSE OF ALDEN — product detail page
   Depends on: config.js (BUSINESS, PRODUCTS), cart.js (Cart, Money), main.js (Toast)
   --------------------------------------------------------------------------
   Reads ?id=<product-id> and fills #pdp. Nothing in here throws: a missing id,
   an unknown id, and a catalogue that failed to load all land on the same
   graceful empty state rather than a blank page.
   ========================================================================== */

(() => {
  const MIN_QTY = 1;
  const MAX_QTY = 99; // matches the ceiling Cart enforces internally

  const mount = document.getElementById("pdp");
  if (!mount) return;

  /* PRODUCTS is a top-level `const` in config.js, so it is a lexical global and
     never a property of window — `typeof` is the only safe way to probe it. */
  const catalogue =
    typeof PRODUCTS !== "undefined" && Array.isArray(PRODUCTS) ? PRODUCTS : [];

  /* --- Builders ----------------------------------------------------------- */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* Only ever fed the literals below — product data goes through textContent. */
  function svgFrom(markup) {
    const host = document.createElement("div");
    host.innerHTML = markup;
    return host.firstElementChild;
  }

  const ORN_SM =
    '<svg class="ornament ornament--sm" width="44" height="10" viewBox="0 0 44 10" aria-hidden="true"><use href="#i-orn-sm"/></svg>';
  const ORN_FLOURISH =
    '<svg class="ornament" width="140" height="14" viewBox="0 0 140 14" aria-hidden="true"><use href="#i-flourish"/></svg>';
  const ICON_WA = '<svg aria-hidden="true"><use href="#i-wa"/></svg>';

  function rule() {
    const div = el("div", "rule");
    div.setAttribute("aria-hidden", "true");
    div.append(svgFrom(ORN_SM));
    return div;
  }

  /* Announces stepper changes, which are otherwise silent: the value moves
     while focus sits on the button, so nothing would reach a screen reader. */
  function liveStatus() {
    const span = el("span", "visually-hidden");
    span.setAttribute("role", "status");
    span.setAttribute("aria-live", "polite");
    return span;
  }

  /* --- Quantity ----------------------------------------------------------- */

  /* Every route into the cart passes through here. "abc" reaches us as "" from
     a number field, "" and " " coerce to 0, and both floor to MIN_QTY. */
  function clampQty(value) {
    const n = Math.floor(Number(value));
    if (Number.isNaN(n)) return MIN_QTY;
    return Math.min(MAX_QTY, Math.max(MIN_QTY, n));
  }

  function qtyStepper(status) {
    const wrap = el("div", "qty");

    const label = el("label", "visually-hidden", "Quantity");
    label.htmlFor = "pdp-qty";

    const input = el("input");
    input.id = "pdp-qty";
    input.type = "number";
    input.min = String(MIN_QTY);
    input.max = String(MAX_QTY);
    input.step = "1";
    input.value = String(MIN_QTY);
    input.inputMode = "numeric";

    const minus = el("button", null, "−");
    minus.type = "button";
    minus.setAttribute("aria-label", "Decrease quantity");

    const plus = el("button", null, "+");
    plus.type = "button";
    plus.setAttribute("aria-label", "Increase quantity");

    const step = (delta) => {
      const next = clampQty(clampQty(input.value) + delta);
      input.value = String(next);
      status.textContent = `Quantity ${next}`;
    };

    minus.addEventListener("click", () => step(-1));
    plus.addEventListener("click", () => step(1));

    /* Corrected when the field is committed, never mid-keystroke — rewriting
       the value on every input event would fight the caret. */
    input.addEventListener("change", () => {
      input.value = String(clampQty(input.value));
    });

    wrap.append(label, minus, input, plus);
    return { wrap, input };
  }

  /* --- Pieces of the page ------------------------------------------------- */

  function media(p) {
    const fig = el("figure", "pdp-media");
    const img = el("img");
    img.src = p.image;
    img.alt = p.alt || `${p.name}, photographed against a plain ground.`;
    img.width = 1000;
    img.height = 1000;
    img.setAttribute("fetchpriority", "high"); // above the fold — never lazy
    fig.append(img);
    return fig;
  }

  function specList(p) {
    const rows = Array.isArray(p.specs)
      ? p.specs.filter((r) => Array.isArray(r) && r.length >= 2)
      : [];
    if (!rows.length) return null;

    const dl = el("dl", "spec-list");
    rows.forEach(([term, value]) => {
      const row = el("div");
      row.append(el("dt", null, String(term)), el("dd", null, String(value)));
      dl.append(row);
    });
    return dl;
  }

  function enquireLink(p) {
    const message =
      `Hello House of Alden. I would like to enquire about ${p.name} ` +
      `(${Money.format(p.price)}), which your site shows as sold out. ` +
      `Could you tell me when you expect to have it again?`;

    const a = el("a", "btn btn--ghost btn--wa");
    a.href = `https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent(message)}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    /* The leading space matters: the two spans are adjacent, so without it the
       accessible name runs together as "...this piece— opens WhatsApp...". */
    a.append(
      svgFrom(ICON_WA),
      el("span", null, "Enquire about this piece"),
      el("span", "visually-hidden", " — opens WhatsApp in a new tab")
    );
    return a;
  }

  function actions(p) {
    const wrap = el("div", "pdp-actions");
    const status = liveStatus();

    const add = el("button", "btn btn--solid", "Add to cart");
    add.type = "button";

    if (!p.stock) {
      /* Sold out: the button stays, so the page still reads as a shop, but it
         is inert both to the pointer and to assistive technology. A quantity
         picker for a piece you cannot buy would only be noise, so it goes. */
      add.disabled = true;
      add.setAttribute("aria-disabled", "true");
      wrap.append(
        el(
          "p",
          "notice",
          "Sold out. We make these in small numbers and the next few are not finished yet. Ask us and we will tell you when they are."
        ),
        add,
        enquireLink(p),
        status
      );
      return wrap;
    }

    const { wrap: qty, input } = qtyStepper(status);

    add.addEventListener("click", () => {
      const n = clampQty(input.value);
      input.value = String(n);
      const ok = Cart.add(p.id, n);
      Toast.show(
        ok
          ? n === 1
            ? `${p.name} added to your cart`
            : `${p.name} × ${n} added to your cart`
          : `${p.name} is no longer available.`
      );
    });

    wrap.append(qty, add, status);
    return wrap;
  }

  function info(p) {
    const box = el("div", "pdp-info");
    box.append(
      el("h1", null, p.name),
      el("p", "price", Money.format(p.price)),
      rule(),
      el("p", "pdp-desc", p.description || p.blurb || "")
    );

    const specs = specList(p);
    if (specs) box.append(specs);

    box.append(actions(p));
    return box;
  }

  /* --- Render ------------------------------------------------------------- */

  function renderProduct(p) {
    document.title = `${p.name} — House of Alden`;
    mount.className = "pdp";
    mount.replaceChildren(media(p), info(p));
  }

  function renderEmpty() {
    document.title = "Piece not found — House of Alden";
    mount.className = "empty";

    const back = el("a", "btn btn--ghost", "See the collection");
    back.href = "collection.html";

    /* The heading goes inside a .page-head: the stylesheet only dresses an h1
       (uppercase, tracked, clamped) as a descendant of .page-head or .pdp-info,
       and there is no rule for a bare h1 in .empty. Without this the 404 is the
       one heading on the site left at the browser's default 32px sentence case. */
    const head = el("div", "page-head");
    head.append(el("h1", null, "Not in the catalogue"));

    mount.replaceChildren(
      svgFrom(ORN_FLOURISH),
      head,
      el(
        "p",
        null,
        "We could not find the piece you asked for. It may have been withdrawn, or the address may have lost a letter on the way here."
      ),
      back
    );
  }

  /* --- Boot --------------------------------------------------------------- */

  const id = new URLSearchParams(location.search).get("id");
  const product = id ? catalogue.find((p) => p && p.id === id) : null;

  try {
    if (product) renderProduct(product);
    else renderEmpty();
  } catch (err) {
    /* A half-drawn product is worse than an honest dead end. */
    console.error("House of Alden — could not render the product page.", err);
    renderEmpty();
  }
})();
