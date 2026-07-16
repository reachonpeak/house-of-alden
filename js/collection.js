/* ==========================================================================
   HOUSE OF ALDEN — the collection grid
   Runs on collection.html only. Depends on: config.js (PRODUCTS), cart.js (Money)
   You should not need to edit this file. Edit js/config.js instead.
   ========================================================================== */

(() => {
  const grid = document.getElementById("grid");
  if (!grid) return;

  const buttons = Array.from(document.querySelectorAll(".filters .filter"));
  const status = document.querySelector("[data-grid-status]");

  /* The buttons in the markup are the whole vocabulary — there is no second
     list of filter names to keep in step with them. */
  const VALID = new Set(buttons.map((b) => b.dataset.filter));

  const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ENTITIES[c]);

  /* --- Markup -------------------------------------------------------------
     Every image is lazy. The grid is built by script, so none of these are ever
     seen by the preload scanner anyway, and a lazy image that lands inside the
     viewport is fetched immediately regardless. */
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

  function emptyState() {
    return `<div class="empty">
      <svg class="ornament ornament--sm" width="44" height="10" viewBox="0 0 44 10" aria-hidden="true"><use href="#i-orn-sm"/></svg>
      <p>Nothing in this part of the collection at the moment.</p>
      <button class="btn btn--ghost" type="button" data-filter="all">View everything</button>
    </div>`;
  }

  const countLabel = (n) =>
    n === 0 ? "No pieces shown" : n === 1 ? "1 piece shown" : `${n} pieces shown`;

  /* --- URL ----------------------------------------------------------------
     The filter lives in the address bar so a view can be linked and survives a
     refresh. "all" is the default, so it is left out rather than spelled out. */
  function readFilter() {
    const raw = (new URLSearchParams(window.location.search).get("filter") || "").toLowerCase();
    return VALID.has(raw) ? raw : "all";
  }

  function writeFilter(filter) {
    try {
      const url = new URL(window.location.href);
      if (filter === "all") url.searchParams.delete("filter");
      else url.searchParams.set("filter", filter);
      window.history.replaceState(null, "", url);
    } catch {
      /* Opened straight off the file system the page has an opaque origin and
         Chrome refuses replaceState. The grid still filters — only the address
         bar is left behind. */
    }
  }

  /* --- Render ------------------------------------------------------------- */
  function apply(filter, announce) {
    const items = filter === "all" ? PRODUCTS : PRODUCTS.filter((p) => p.category === filter);

    /* .empty is a full-width block. While it is showing the container must not
       be a grid, or it would be squeezed into one 240px column. */
    grid.classList.toggle("product-grid", items.length > 0);
    grid.innerHTML = items.length ? items.map(card).join("") : emptyState();

    buttons.forEach((b) => {
      const on = b.dataset.filter === filter;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });

    writeFilter(filter);
    if (announce && status) status.textContent = countLabel(items.length);
  }

  /* --- Boot --------------------------------------------------------------- */
  buttons.forEach((b) => {
    b.addEventListener("click", () => apply(b.dataset.filter, true));
  });

  /* The reset inside the empty state is rebuilt on every render, so it is
     caught here rather than bound to. */
  grid.addEventListener("click", (e) => {
    const reset = e.target.closest("[data-filter]");
    if (!reset) return;
    apply(reset.dataset.filter, true);
    /* apply() has just replaced the button that was clicked with the grid it
       asked for. Focus would fall back to <body>, stranding a keyboard user at
       the top of the document — hand it to the matching filter instead. */
    const match = buttons.find((b) => b.dataset.filter === reset.dataset.filter);
    if (match) match.focus();
  });

  /* Silent on load: an aria-live region should not read a count nobody asked
     for. The first press is the first announcement. */
  apply(readFilter(), false);
})();
