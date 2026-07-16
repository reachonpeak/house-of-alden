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
  const RELATED_MAX = 3; // .related is a three-column grid
  const RELATED_MIN = 2; // fewer than this and the row is not worth showing

  /* Where the shop actually lives. Only structured data needs it: a crawler is
     handed absolute URLs, while every link on the page stays relative so the
     site still works from a file:// folder or a preview deployment. */
  const SITE = "https://house-of-alden.vercel.app/";

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

  /* --- Photographs -------------------------------------------------------- */

  /* A piece may carry an optional `images: ["a.webp", "b.webp"]`. `image` is
     the plate the grid, the cart and the crawler all use, so it leads here too —
     a customer who clicks a photograph must land on that photograph — and
     `images` supplies whatever follows it. Repeats are dropped, so naming the
     lead plate in both keys does not show it twice.

     Nothing in config.js carries `images` today, which is the point: one plate
     returns one plate, and the page below is the page that was already here. */
  function shotsOf(p) {
    const extra = Array.isArray(p.images)
      ? p.images.filter((s) => typeof s === "string" && s.trim() !== "")
      : [];
    const shots = p.image ? [p.image] : [];
    extra.forEach((s) => {
      if (!shots.includes(s)) shots.push(s);
    });
    return shots;
  }

  /* config.js carries one alt, and it was written for one photograph. Nothing
     is known about a second plate except that it shows the same piece from
     somewhere else, so that is all the alt for it claims. Inventing a
     description of a photograph nobody here has seen is how alt text starts
     lying to the people who depend on it. */
  function altFor(p, i, total) {
    const first = p.alt || `${p.name}, photographed against a plain ground.`;
    return i === 0 ? first : `${p.name}, further view — image ${i + 1} of ${total}.`;
  }

  function thumbs(p, shots, main) {
    const strip = el("div", "pdp-thumbs");

    const buttons = shots.map((src, i) => {
      const b = el("button", `pdp-thumb${i === 0 ? " is-active" : ""}`);
      b.type = "button";
      /* The button says what it does, so the thumbnail inside it is decorative
         and takes an empty alt: the standard treatment for an image that is the
         whole of a labelled control. Two names for one button ("Gold-cased
         wristwatch… Show image 2 of 3") would only be read out twice. */
      b.setAttribute("aria-label", `Show image ${i + 1} of ${shots.length}`);
      b.setAttribute("aria-pressed", String(i === 0));

      const img = el("img");
      img.src = src;
      img.alt = "";
      img.width = 1000;
      img.height = 1000;
      /* Lazy like every other scripted image on the site: the strip is built
         long after the preload scanner has been and gone, and a lazy image that
         lands inside the viewport is fetched at once regardless. */
      img.setAttribute("loading", "lazy");

      b.append(img);
      return b;
    });

    const show = (i) => {
      main.src = shots[i];
      main.alt = altFor(p, i, shots.length);
      buttons.forEach((b, j) => {
        b.classList.toggle("is-active", j === i);
        b.setAttribute("aria-pressed", String(j === i));
      });
    };

    /* Real buttons, so Enter and Space arrive as clicks and the focus ring is
       the site's own. Nothing else to wire. */
    buttons.forEach((b, i) => b.addEventListener("click", () => show(i)));

    strip.append(...buttons);
    return strip;
  }

  /* --- Pieces of the page ------------------------------------------------- */

  function media(p) {
    const shots = shotsOf(p);

    const fig = el("figure", "pdp-media");
    const img = el("img");
    img.src = shots[0] || p.image;
    img.alt = altFor(p, 0, shots.length);
    img.width = 1000;
    img.height = 1000;
    img.setAttribute("fetchpriority", "high"); // above the fold — never lazy
    fig.append(img);

    /* One plate, one photograph: no strip, and none of its machinery built. */
    if (shots.length < 2) return fig;

    /* .pdp is a two-column grid and .pdp-thumbs belongs under the photograph,
       not beside the copy — as a grid item of its own it would take the second
       column. .pdp-media carries the frame and the strip sits below it, so the
       two need one plain box to share. */
    const box = el("div");
    box.append(fig, thumbs(p, shots, img));
    return box;
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

  /* --- Related pieces ----------------------------------------------------- */

  /* The same card the collection grid draws — same classes, same order, same
     Sold Out precedence — so a piece looks identical wherever it is met. */
  function card(p) {
    const out = !p.stock;

    const a = el("a", `product-card${out ? " is-out" : ""}`);
    a.href = `product.html?id=${encodeURIComponent(p.id)}`;

    const box = el("div", "product-card-media");
    /* Sold Out outranks whatever badge config.js asked for — a customer needs
       to know it is gone before they need to know it is new. */
    const badge = out ? "Sold Out" : p.badge || "";
    if (badge) box.append(el("span", "badge", badge));

    const img = el("img");
    img.src = p.image;
    img.alt = p.alt || `${p.name}, photographed against a plain ground.`;
    img.width = 1000;
    img.height = 1000;
    img.setAttribute("loading", "lazy"); // always below the fold, under the PDP
    box.append(img);

    a.append(box, el("h3", null, p.name), el("p", "price", Money.format(p.price)));
    return a;
  }

  /* Deterministic, and in the shop's own order: the owner should be able to
     read config.js and know what sits under a piece, and a stable row is
     kinder to a cache than a shuffle.

     The two rules meet exactly once — when a category has fewer than three
     in-stock pieces left besides this one. Availability wins there. "Never
     offer a sold-out piece while an in-stock one is going spare" is the
     stronger promise to a customer than "keep to the category", so the row
     tops up from the other side of the catalogue and only reaches for a
     sold-out piece when there is genuinely nothing else to show. */
  function relatedTo(p) {
    const pool = catalogue.filter((x) => x && x.id && x.id !== p.id && x.image);
    const tier = (inStock) => [
      ...pool.filter((x) => !!x.stock === inStock && x.category === p.category),
      ...pool.filter((x) => !!x.stock === inStock && x.category !== p.category),
    ];
    return [...tier(true), ...tier(false)].slice(0, RELATED_MAX);
  }

  function related(p) {
    const picks = relatedTo(p);
    /* One card alone in a three-column grid reads as a mistake rather than an
       invitation. Better to end the page on the piece the customer came for. */
    if (picks.length < RELATED_MIN) return null;

    const section = el("section", "related");
    section.dataset.pdpExtra = "";
    section.setAttribute("aria-labelledby", "related-heading");

    const heading = el("h2", null, "You may also like");
    heading.id = "related-heading";

    const grid = el("div", "product-grid");
    picks.forEach((x) => grid.append(card(x)));

    section.append(heading, grid);
    return section;
  }

  /* --- Structured data ---------------------------------------------------- */

  /* One Product block, built from config.js and nothing else. No rating and no
     review count: there are no reviews, and markup that claims otherwise is
     both a lie and the sort of thing Google withdraws rich results over. */
  function jsonLd(p) {
    try {
      const url = `${SITE}product.html?id=${encodeURIComponent(p.id)}`;
      const data = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: p.name,
        image: SITE + String(p.image).replace(/^\/+/, ""),
        description: p.description || p.blurb || "",
        sku: p.id,
        /* Read from config.js, not spelled out again. config.js is billed as the
           only file the owner edits; a name hardcoded here would keep telling
           crawlers the old one long after BUSINESS.name had changed. */
        brand: { "@type": "Brand", name: (BUSINESS && BUSINESS.name) || "House of Alden" },
        offers: {
          "@type": "Offer",
          url,
          priceCurrency: (BUSINESS.currency && BUSINESS.currency.code) || "INR",
          /* A bare number, deliberately. This field is read by a crawler and
             not by a customer: priceCurrency carries the currency, and
             Money.format's "₹8,900" would be invalid here. */
          price: p.price,
          availability: p.stock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
        },
      };

      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.dataset.pdpExtra = "";
      /* "<" only ever appears inside a string in JSON, so escaping every one of
         them cannot break the data — and it keeps a stray "</script>" in a
         description from closing the block early if this page is ever saved or
         serialised. */
      script.textContent = JSON.stringify(data).replace(/</g, "\\u003c");
      document.head.append(script);
    } catch (err) {
      /* Structured data is a courtesy to a crawler. It must never cost a
         customer the page. */
      console.warn("House of Alden — could not write the product structured data.", err);
    }
  }

  /* --- Render ------------------------------------------------------------- */

  /* Everything renderProduct hangs outside #pdp — the related row and the
     structured data — carries this mark, so a fall back to the empty state can
     take it all down again in one sweep. */
  function clearExtras() {
    document.querySelectorAll("[data-pdp-extra]").forEach((node) => node.remove());
  }

  function renderProduct(p) {
    clearExtras();
    document.title = `${p.name} — House of Alden`;
    mount.className = "pdp";
    mount.replaceChildren(media(p), info(p));

    const also = related(p);
    if (also) mount.after(also);

    jsonLd(p);
  }

  function renderEmpty() {
    /* renderProduct may have got half-way before it threw. A dead end that still
       carries the last product's suggestions and structured data is worse than
       no dead end at all. */
    clearExtras();

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
