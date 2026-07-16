/* ==========================================================================
   HOUSE OF ALDEN — the home page shelves
   Runs on index.html only. Depends on: config.js (PRODUCTS), cart.js (Money)
   You should not need to edit this file. Edit js/config.js instead.
   ========================================================================== */

(() => {
  /* Four per shelf, deliberately capped.
     A shelf is a teaser, not the shop. As stock is added to config.js the home
     page must stay one clean row per category and let collection.html be the
     thing that grows — otherwise the home page slowly turns into a second,
     worse collection page. The CSS backs this up: .shelf .product-grid is a
     fixed four columns, so a fifth card would strand itself alone on a second
     line. The first four in config.js win; reordering that list is how the
     owner chooses what the home page shows. */
  const PER_SHELF = 4;

  /* The grid ids are the contract with index.html. The <section> around each is
     found by walking up, so the markup needs no extra hook for the script. */
  const SHELVES = [
    { category: "watches", gridId: "shelf-watches-grid" },
    { category: "earrings", gridId: "shelf-earrings-grid" },
  ];

  const grids = SHELVES.map((s) => document.getElementById(s.gridId));
  if (!grids.some(Boolean)) return; // not the home page

  const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ENTITIES[c]);

  /* --- Markup -------------------------------------------------------------
     Deliberately identical to card() in js/collection.js. The two are kept in
     step by hand: a product card must not look like one thing on the home page
     and another on the collection page. If you change one, change the other.
     (Factoring it into a shared module was the alternative, but that means
     editing collection.js, and this file is not allowed to.)

     Every image is lazy: both shelves sit below the fold, and the grid is built
     by script, so the preload scanner never sees these anyway. */
  function card(p) {
    const out = !p.stock;
    /* Sold Out outranks whatever badge config.js asked for — a customer needs
       to know it is gone before they need to know it is new. */
    const badge = out ? "Sold Out" : p.badge || "";
    return `<a class="product-card${out ? " is-out" : ""}" href="product.html?id=${encodeURIComponent(p.id)}">
      <div class="product-card-media">
        ${badge ? `<span class="badge">${esc(badge)}</span>` : ""}
        <img src="${esc(p.image)}" width="1000" height="1000" loading="lazy" alt="${esc(p.alt)}">
      </div>
      <h3>${esc(p.name)}</h3>
      <p class="price">${esc(Money.format(p.price))}</p>
    </a>`;
  }

  /* --- Render ------------------------------------------------------------- */
  SHELVES.forEach(({ category, gridId }, i) => {
    const grid = grids[i];
    if (!grid) return;

    const items = PRODUCTS.filter((p) => p.category === category).slice(0, PER_SHELF);

    /* Sell nothing in this category and the whole shelf goes — head, rule,
       "View all" and all. A heading over an empty grid reads as a bug, and the
       button underneath would lead to an empty filter. */
    if (!items.length) {
      const shelf = grid.closest(".shelf");
      if (shelf) shelf.hidden = true;
      return;
    }

    grid.innerHTML = items.map(card).join("");
  });
})();
