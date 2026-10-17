/* Moved out of journal.html unchanged, so the site can run under a strict
   Content-Security-Policy (no inline scripts). Depends on: config.js, main.js. */

/* The entries above are static HTML so they stay indexable and still read with
   JS off. But js/config.js is the single source of truth — its JOURNAL array is
   the thing the owner actually edits — so re-sync from it here. Without this the
   static copy silently drifts the first time config.js is touched, with no error
   to show for it. Same contract as collection.js/product.js and PRODUCTS. */
(() => {
  const list = document.querySelector(".journal-list");
  const template = list && list.querySelector(".journal-entry");
  if (!list || !template) return;
  if (typeof JOURNAL === "undefined" || !Array.isArray(JOURNAL) || !JOURNAL.length) return;

  /* Title → post page. JOURNAL carries no link of its own, so the mapping lives
     here, beside the pages it names. An entry added to config.js before its page
     exists falls back to the disabled link below rather than to a broken href.
     A Map, not an object literal: titles come from a hand-edited file, and a
     title of "constructor" would find a function on Object.prototype and be
     written into the href. */
  const POSTS = new Map([
    ["Why We Chose the Moon", "journal-moon.html"],
    ["On Leather That Darkens", "journal-leather.html"],
    ["A House in Maur Mandi", "journal-maur-mandi.html"],
  ]);

  const MONTHS = ["january", "february", "march", "april", "may", "june",
                  "july", "august", "september", "october", "november", "december"];

  /* "12 July 2026" → "2026-07-12". Returns null on anything unexpected, so a
     typo in config.js drops the machine-readable date rather than inventing one. */
  const toISO = (human) => {
    const m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(String(human || "").trim());
    if (!m) return null;
    const month = MONTHS.indexOf(m[2].toLowerCase());
    const day = Number(m[1]);
    if (month < 0 || day < 1 || day > 31) return null;
    return `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  /* Cloned from the static entry and filled with textContent — never innerHTML.
     config.js is hand-edited, so an apostrophe or an "&" must never become markup. */
  const built = JOURNAL.map((post) => {
    const el = template.cloneNode(true);
    const time = el.querySelector("time");
    const iso = toISO(post.date);
    time.textContent = post.date || "";
    if (iso) time.setAttribute("datetime", iso);
    else time.removeAttribute("datetime");
    el.querySelector("h2").textContent = post.title || "";
    el.querySelector(":scope > p").textContent = post.excerpt || "";
    el.querySelector(".link-more .visually-hidden").textContent = `— ${post.title || ""}`;

    /* Every clone carries the FIRST entry's href, so the link must be set from
       the title on each one — otherwise all three would open the same post. */
    const link = el.querySelector(".link-more");
    const href = POSTS.get(post.title);
    if (href) {
      link.setAttribute("href", href);
      link.removeAttribute("aria-disabled");
    } else {
      link.setAttribute("href", "#");
      link.setAttribute("aria-disabled", "true");
    }
    return el;
  });

  list.querySelectorAll(".journal-entry").forEach((el) => el.remove());
  built.forEach((el) => list.append(el));
})();

/* The three entries above are written and linked. A fourth added to config.js
   would have no page yet: its link is left at "#" and marked disabled, which
   would otherwise fling the reader to the top of the document. Swallow that
   click and say so. Bound after the re-render above so the freshly cloned
   entries are covered. */
document.querySelectorAll('.journal-list .link-more[aria-disabled="true"]').forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    Toast.show("That entry is still being written.");
  });
});
