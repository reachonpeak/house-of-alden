/* ==========================================================================
   HOUSE OF ALDEN — shared UI
   Runs on every page. Depends on: config.js, cart.js
   ========================================================================== */

/* --- Cart count in the masthead ------------------------------------------ */
function syncCartCount() {
  const n = Cart.count();
  document.querySelectorAll("[data-cart-count]").forEach((el) => {
    el.textContent = `(${n})`;
  });
  document.querySelectorAll("[data-cart-label]").forEach((el) => {
    el.textContent = n === 1 ? "Cart, 1 item" : `Cart, ${n} items`;
  });
}

/* --- Mobile nav ---------------------------------------------------------- */
function initNav() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const panel = document.getElementById("primary-nav");
  if (!toggle || !panel) return;

  const setOpen = (open) => {
    panel.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };

  toggle.addEventListener("click", () => {
    setOpen(!panel.classList.contains("is-open"));
  });

  // Escape closes and returns focus to the control that opened it.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("is-open")) {
      setOpen(false);
      toggle.focus();
    }
  });

  // A resize past the breakpoint must not strand the panel open.
  const mq = window.matchMedia("(min-width: 861px)");
  const reset = () => mq.matches && setOpen(false);
  mq.addEventListener ? mq.addEventListener("change", reset) : mq.addListener(reset);
}

/* --- Toast --------------------------------------------------------------- */
const Toast = (() => {
  let el, timer;
  function ensure() {
    if (el) return el;
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");        // announced, never steals focus
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
    return el;
  }
  return {
    show(msg, ms = 2600) {
      const node = ensure();
      node.textContent = msg;
      // Reflow so a second call re-runs the transition.
      void node.offsetWidth;
      node.classList.add("is-open");
      clearTimeout(timer);
      timer = setTimeout(() => node.classList.remove("is-open"), ms);
    },
  };
})();

/* --- Footer year --------------------------------------------------------- */
function initYear() {
  const y = new Date().getFullYear();
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = y));
}

/* --- Boot ---------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  syncCartCount();
  Cart.onChange(syncCartCount);
  initNav();
  initYear();
});
