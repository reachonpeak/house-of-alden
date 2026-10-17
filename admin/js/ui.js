/* ==========================================================================
   HOUSE OF ALDEN ADMIN — UI kit
   --------------------------------------------------------------------------
   Small vanilla components in the manner of Shopify's Polaris (an honest
   approximation in plain CSS: the official Polaris components only run inside
   apps embedded in Shopify itself).

   Safety rule for the whole admin: data never becomes markup. Everything a
   customer or staff member typed is placed with textContent (h() does this
   for every string child), so a product called "<img onerror=…>" is just text.
   ========================================================================== */

import { animate } from "../vendor/motion-mini.js";
import { icon } from "./icons.js";

export { icon };

/* --- Elements --------------------------------------------------------------- */

/**
 * h("button", { class: "btn", onclick }, "Save", icon("check"))
 * Strings and numbers become text nodes; null/false children are skipped.
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else if (key === "value" || key === "checked" || key === "selected" || key === "indeterminate") el[key] = value;
      else el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of [children].flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

let uidCounter = 0;
export const uid = (prefix = "id") => `${prefix}-${++uidCounter}`;

let baseTitle = "";
let titleCount = 0;
const applyTitle = () => {
  const text = baseTitle ? `${baseTitle} · House of Alden` : "House of Alden · Admin";
  document.title = titleCount ? `(${titleCount}) ${text}` : text;
};

export function setTitle(title) {
  baseTitle = title || "";
  applyTitle();
}

/* "(2) Orders · House of Alden" while new orders wait to be seen. */
export function setTitleCount(n) {
  titleCount = n;
  applyTitle();
}

/* One polite live region for route changes and background results. */
let liveRegion;
export function announce(message) {
  if (!liveRegion) {
    liveRegion = h("p", { class: "visually-hidden", role: "status", "aria-live": "polite" });
    document.body.append(liveRegion);
  }
  liveRegion.textContent = "";
  requestAnimationFrame(() => (liveRegion.textContent = message));
}

/* --- Motion ------------------------------------------------------------------
   Used only where it explains something: a toast arriving, a dialog opening,
   the save bar appearing, the mobile menu sliding. Nothing animates on
   keyboard shortcuts or page changes — the admin is used all day. Under
   reduced motion everything becomes a short fade with no movement. */

const EASE_OUT = [0.23, 1, 0.32, 1];
const EASE_DRAWER = [0.32, 0.72, 0, 1];
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function enter(el, { from = "translateY(8px)", scale = false, duration = 0.2, ease = EASE_OUT } = {}) {
  if (!el) return Promise.resolve();
  if (reduced()) return animate(el, { opacity: [0, 1] }, { duration: 0.12 }).finished.catch(() => {});
  const transform = scale ? ["scale(0.97)", "scale(1)"] : [from, "none"];
  return animate(el, { opacity: [0, 1], transform }, { duration, ease }).finished.catch(() => {});
}

export function leave(el, { to = "translateY(8px)", scale = false, duration = 0.14 } = {}) {
  if (!el) return Promise.resolve();
  if (reduced()) return animate(el, { opacity: 0 }, { duration: 0.1 }).finished.catch(() => {});
  return animate(el, { opacity: 0, transform: scale ? "scale(0.97)" : to }, { duration, ease: EASE_OUT })
    .finished.catch(() => {});
}

export function slide(el, open) {
  if (reduced()) return animate(el, { opacity: open ? [0, 1] : 0 }, { duration: 0.12 }).finished.catch(() => {});
  return animate(
    el,
    { transform: open ? ["translateX(-100%)", "translateX(0)"] : "translateX(-100%)" },
    { duration: open ? 0.26 : 0.2, ease: EASE_DRAWER }
  ).finished.catch(() => {});
}

/* --- Buttons ---------------------------------------------------------------- */

/**
 * variant: "primary" | "secondary" (default) | "plain" | "critical" | "tertiary"
 * Pass href to render a link styled as a button.
 */
export function button(label, { variant = "secondary", iconStart, iconEnd, onClick, type = "button", disabled,
  href, size, ariaLabel, className = "", title, target } = {}) {
  const classes = ["btn", `btn--${variant}`, size ? `btn--${size}` : "", !label ? "btn--icon" : "", className]
    .filter(Boolean).join(" ");
  const content = [
    iconStart && icon(iconStart, { size: 18 }),
    label && h("span", { class: "btn-label" }, label),
    iconEnd && icon(iconEnd, { size: 16 }),
  ];
  if (href) {
    return h("a", { class: classes, href, "aria-label": ariaLabel, title, target,
      rel: target === "_blank" ? "noopener noreferrer" : null }, content);
  }
  return h("button", { class: classes, type, disabled, onclick: onClick, "aria-label": ariaLabel, title }, content);
}

/* Shows a working state on a button for the length of a promise. */
export async function busy(btn, work) {
  if (!btn) return work();
  btn.disabled = true;
  btn.classList.add("is-busy");
  btn.setAttribute("aria-busy", "true");
  try {
    return await work();
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-busy");
    btn.removeAttribute("aria-busy");
  }
}

/* --- Badges ------------------------------------------------------------------
   tone: success | info | attention | warning | critical | neutral.
   progress: "incomplete" | "complete" adds Shopify's small state glyph, so a
   status never relies on colour alone. */
export function badge(text, tone = "neutral", { progress } = {}) {
  const glyph = progress === "incomplete" ? "circle-dashed" : progress === "complete" ? "circle-check" : null;
  return h("span", { class: `badge badge--${tone}` }, glyph && icon(glyph, { size: 14 }), text);
}

/* --- Layout ------------------------------------------------------------------ */

export function pageHeader({ title, back, badges = [], meta, primary, secondary = [], extra }) {
  return h(
    "div",
    { class: "page-header" },
    back && h("a", { class: "back-link", href: back.href, "aria-label": back.label || "Back", title: back.label }, icon("arrow-left")),
    h(
      "div",
      { class: "page-title" },
      h("div", { class: "page-title-row" }, h("h1", { tabindex: "-1" }, title), badges.filter(Boolean)),
      meta && h("p", { class: "page-meta" }, meta)
    ),
    h("div", { class: "page-actions" }, extra, secondary.filter(Boolean), primary)
  );
}

export function page({ width = "default" } = {}, ...children) {
  return h("div", { class: `page page--${width}` }, children);
}

export function layout(main, aside) {
  return h("div", { class: "layout" }, h("div", { class: "layout-main" }, main), h("div", { class: "layout-aside" }, aside));
}

export function card({ title, actions, subdued = false, flush = false, className = "", id } = {}, ...children) {
  const head = title || actions
    ? h("div", { class: "card-head" }, title && h("h2", { class: "card-title" }, title), actions && h("div", { class: "card-actions" }, actions))
    : null;
  return h("section", { class: `card${subdued ? " card--subdued" : ""}${flush ? " card--flush" : ""} ${className}`.trim(), id },
    head, children);
}

export const stack = (gap = "md", ...children) => h("div", { class: `stack stack--${gap}` }, children);
export const inline = (...children) => h("div", { class: "inline" }, children);
export const subdued = (text) => h("p", { class: "subdued" }, text);

export function emptyState({ glyph = "box", title, body, action, compact = false }) {
  return h(
    "div",
    { class: `empty${compact ? " empty--compact" : ""}` },
    h("div", { class: "empty-mark" }, icon(glyph, { size: 28 })),
    h("h2", null, title),
    body && h("p", null, body),
    action
  );
}

/* Grey bars in the shape of what is loading — never a spinner. */
export function skeleton(rows = 4) {
  return h(
    "div",
    { class: "skeleton", "aria-hidden": "true" },
    h("div", { class: "skeleton-line skeleton-line--title" }),
    Array.from({ length: rows }, (_, i) => h("div", { class: `skeleton-line${i % 3 === 2 ? " skeleton-line--short" : ""}` }))
  );
}

export function loadingPage(title) {
  return page({}, pageHeader({ title }), card({}, skeleton(5)));
}

/* --- Forms ------------------------------------------------------------------- */

/** A labelled control: label above, help or error below (never a placeholder as label). */
export function field({ label, control, help, error, labelHidden = false, optional = false, action }) {
  /* A wrapped control (₹ prefix, show-password button) is labelled through
     the real input inside it, so clicking the label focuses the input. */
  const target = control.matches("input, select, textarea")
    ? control
    : control.querySelector("input, select, textarea") || control;
  const id = target.id || (target.id = uid("f"));
  const helpId = help ? `${id}-help` : null;
  const errorId = `${id}-error`;
  const describe = [helpId, error ? errorId : null].filter(Boolean).join(" ");
  if (describe) target.setAttribute("aria-describedby", describe);
  if (error) target.setAttribute("aria-invalid", "true");
  return h(
    "div",
    { class: "field" },
    h(
      "div",
      { class: `field-label${labelHidden ? " visually-hidden" : ""}` },
      h("label", { for: id }, label, optional && h("span", { class: "optional" }, " (optional)")),
      action
    ),
    control,
    help && h("p", { class: "field-help", id: helpId }, help),
    h("p", { class: "field-error", id: errorId, hidden: !error }, error && icon("alert-triangle", { size: 16 }), error || "")
  );
}

/* Show or clear the inline error under a field built by field(). */
export function setFieldError(control, message) {
  const err = document.getElementById(`${control.id}-error`);
  if (!err) return;
  err.replaceChildren(...(message ? [icon("alert-triangle", { size: 16 }), message] : []));
  err.hidden = !message;
  if (message) control.setAttribute("aria-invalid", "true");
  else control.removeAttribute("aria-invalid");
  const ids = new Set((control.getAttribute("aria-describedby") || "").split(" ").filter(Boolean));
  if (message) ids.add(err.id);
  else ids.delete(err.id);
  if (ids.size) control.setAttribute("aria-describedby", [...ids].join(" "));
  else control.removeAttribute("aria-describedby");
}

export function input(attrs = {}) {
  return h("input", { class: "input", type: "text", ...attrs });
}

export function textarea(attrs = {}) {
  return h("textarea", { class: "input textarea", rows: 4, ...attrs });
}

export function select(options, attrs = {}) {
  const el = h("select", { class: "input select", ...attrs },
    options.map((o) => h("option", { value: o.value, disabled: o.disabled }, o.label)));
  if (attrs.value != null) el.value = attrs.value;
  return el;
}

/* ₹ prefix inside the field, numeric keypad on phones. */
export function moneyInput(attrs = {}) {
  const el = input({ inputmode: "numeric", autocomplete: "off", ...attrs, class: "input input--money" });
  return { wrap: h("div", { class: "affix" }, h("span", { class: "affix-prefix", "aria-hidden": "true" }, "₹"), el), input: el };
}

export function checkbox(label, { checked = false, onChange, help, disabled, id = uid("cb") } = {}) {
  const box = h("input", { type: "checkbox", class: "checkbox", id, checked, disabled,
    onchange: (e) => onChange && onChange(e.target.checked) });
  return {
    el: h("div", { class: "choice" }, box, h("label", { for: id }, label, help && h("span", { class: "choice-help" }, help))),
    input: box,
  };
}

export function searchField({ value = "", placeholder = "Search", onInput, label = "Search" } = {}) {
  const el = h("input", { class: "input search-input", type: "search", value, placeholder, "aria-label": label,
    autocomplete: "off", spellcheck: "false" });
  let timer;
  el.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => onInput && onInput(el.value), 120);
  });
  return { wrap: h("div", { class: "search-field" }, icon("search", { size: 18 }), el), input: el };
}

/* Filter tabs over a list (Shopify's "All · Unfulfilled · Unpaid …"). */
export function tabs({ items, active, onSelect, label }) {
  const list = h("div", { class: "tabs", role: "tablist", "aria-label": label });
  const buttons = items.map((it) =>
    h("button", {
      type: "button",
      role: "tab",
      class: "tab",
      "aria-selected": String(it.id === active),
      tabindex: it.id === active ? "0" : "-1",
      onclick: () => onSelect(it.id),
    }, it.label, it.count != null && h("span", { class: "tab-count" }, String(it.count)))
  );
  list.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    const next = buttons[(i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
    next.focus();
    e.preventDefault();
  });
  append(list, buttons);
  return list;
}

/* --- Index table ---------------------------------------------------------------
   A real <table> on wide screens; stacked rows on phones (CSS). The first
   column holds the row's link, so the row is reachable by keyboard; clicking
   anywhere else on the row follows the same link. */
export function dataTable({ columns, rows, rowKey = (r) => r.id, rowHref, selection, onSelect, caption, rowClass }) {
  const selectable = !!selection;
  const allSelected = selectable && rows.length > 0 && rows.every((r) => selection.has(rowKey(r)));
  const someSelected = selectable && !allSelected && rows.some((r) => selection.has(rowKey(r)));

  const head = h("thead", null, h("tr", null,
    selectable && h("th", { class: "cell-check", scope: "col" },
      h("input", {
        type: "checkbox",
        class: "checkbox",
        checked: allSelected,
        indeterminate: someSelected,
        "aria-label": allSelected ? "Deselect all" : "Select all",
        onchange: (e) => {
          const next = new Set(selection);
          rows.forEach((r) => (e.target.checked ? next.add(rowKey(r)) : next.delete(rowKey(r))));
          onSelect(next);
        },
      })),
    columns.map((c) => h("th", { scope: "col", class: c.align === "end" ? "num" : c.className || null }, c.label))
  ));

  const body = h("tbody", null, rows.map((row) => {
    const key = rowKey(row);
    const href = rowHref ? rowHref(row) : null;
    const tr = h("tr", {
      class: [href ? "is-link" : "", selectable && selection.has(key) ? "is-selected" : "", rowClass ? rowClass(row) : ""]
        .filter(Boolean).join(" ") || null,
    },
    selectable && h("td", { class: "cell-check" },
      h("input", {
        type: "checkbox",
        class: "checkbox",
        checked: selection.has(key),
        "aria-label": "Select row",
        onchange: (e) => {
          const next = new Set(selection);
          if (e.target.checked) next.add(key);
          else next.delete(key);
          onSelect(next);
        },
      })),
    columns.map((c, i) =>
      h("td", { class: [c.align === "end" ? "num" : "", i === 0 ? "cell-primary" : "", c.className || ""].filter(Boolean).join(" ") || null,
        "data-label": c.label }, c.render(row))));
    if (href) {
      tr.addEventListener("click", (e) => {
        if (e.defaultPrevented || e.target.closest("a, button, input, select, textarea, label")) return;
        if (window.getSelection && String(window.getSelection()).length) return; // let people copy text
        const link = tr.querySelector("a.row-link");
        if (link) link.click();
      });
    }
    return tr;
  }));

  return h("div", { class: "table-wrap" },
    h("table", { class: `table${selectable ? " table--selectable" : ""}` },
      caption && h("caption", { class: "visually-hidden" }, caption), head, body));
}

/* The link that names a row (order number, product name …). */
export const rowLink = (href, text) => h("a", { class: "row-link", href }, text);

/* "N selected" bar with actions, shown above a list while rows are ticked. */
export function bulkBar(count, actions, onClear) {
  return h("div", { class: "bulk-bar", role: "region", "aria-label": "Bulk actions" },
    h("span", { class: "bulk-count" }, `${count} selected`),
    h("div", { class: "bulk-actions" }, actions.map((a) =>
      button(a.label, { variant: a.destructive ? "critical" : "secondary", size: "slim", onClick: a.onClick }))),
    button("", { variant: "tertiary", size: "slim", iconStart: "x", ariaLabel: "Clear selection", onClick: onClear }));
}

export function pagination({ page, pages, onPage, label }) {
  if (pages <= 1) return null;
  return h("nav", { class: "pagination", "aria-label": label || "Pages" },
    button("", { iconStart: "chevron-left", ariaLabel: "Previous page", disabled: page <= 1, onClick: () => onPage(page - 1), size: "slim" }),
    h("span", { class: "pagination-label" }, `Page ${page} of ${pages}`),
    button("", { iconStart: "chevron-right", ariaLabel: "Next page", disabled: page >= pages, onClick: () => onPage(page + 1), size: "slim" }));
}

export const thumb = (src, alt = "", size = 40) =>
  h("span", { class: "thumb", style: { width: `${size}px`, height: `${size}px` } },
    src ? h("img", { src: assetUrl(src), alt, loading: "lazy", width: size, height: size, decoding: "async" }) : icon("photo", { size: Math.round(size / 2) }));

/* Product photos are either full https:// addresses (uploaded here) or paths
   inside the shop ("images/x.webp"), which must be read from the site root. */
export function assetUrl(src) {
  const s = String(src || "");
  if (/^https:\/\//.test(s)) return s;
  return `/${s.replace(/^\/+/, "")}`;
}

/* --- Menus ---------------------------------------------------------------------- */

let openMenu = null;
export function closeMenus() {
  if (openMenu) openMenu();
}

/** A button that opens a small menu of actions ({label, icon, onClick, destructive, disabled}). */
export function menuButton(label, items, { variant = "secondary", iconStart, ariaLabel, align = "end" } = {}) {
  const btn = button(label, { variant, iconStart, iconEnd: label ? "chevron-down" : null, ariaLabel });
  btn.setAttribute("aria-haspopup", "menu");
  btn.setAttribute("aria-expanded", "false");
  const wrap = h("div", { class: "menu-wrap" }, btn);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (btn.getAttribute("aria-expanded") === "true") return closeMenus();
    closeMenus();
    const entries = items.filter(Boolean).map((it) =>
      h("button", {
        type: "button",
        role: "menuitem",
        class: `menu-item${it.destructive ? " is-critical" : ""}`,
        disabled: it.disabled,
        onclick: () => {
          close();
          it.onClick();
        },
      }, it.icon && icon(it.icon, { size: 18 }), h("span", null, it.label))
    );
    const pop = h("div", { class: `popover popover--${align}`, role: "menu" }, entries);
    wrap.append(pop);
    btn.setAttribute("aria-expanded", "true");
    const usable = entries.filter((x) => !x.disabled);
    if (usable[0] && e.detail === 0) usable[0].focus(); // opened from the keyboard

    const onKey = (ev) => {
      if (ev.key === "Escape") {
        close();
        btn.focus();
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        const i = usable.indexOf(document.activeElement);
        const next = usable[(i + (ev.key === "ArrowDown" ? 1 : -1) + usable.length) % usable.length];
        if (next) next.focus();
        ev.preventDefault();
      }
    };
    const onDoc = (ev) => {
      if (!wrap.contains(ev.target)) close();
    };
    function close() {
      pop.remove();
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onDoc);
      if (openMenu === close) openMenu = null;
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onDoc);
    openMenu = close;
  });
  return wrap;
}

/* --- Toasts ---------------------------------------------------------------------- */

let toastRegion;
/** toast("Product saved") · toast("Couldn't save", { tone: "critical" }) · { action: {label, onClick} } */
export function toast(message, { tone = "default", action, duration = 4500 } = {}) {
  if (!toastRegion) {
    toastRegion = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(toastRegion);
  }
  let closed = false;
  let timer;
  const node = h("div", { class: `toast${tone === "critical" ? " toast--critical" : ""}` },
    tone === "critical" && icon("alert-triangle", { size: 18 }),
    h("span", { class: "toast-text" }, message),
    action && h("button", { type: "button", class: "toast-action", onclick: () => { close(); action.onClick(); } }, action.label),
    h("button", { type: "button", class: "toast-close", "aria-label": "Dismiss", onclick: () => close() }, icon("x", { size: 16 })));

  async function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    await leave(node, { duration: 0.15 });
    node.remove();
  }
  const arm = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(close, ms);
  };
  /* A message being read or pointed at does not vanish mid-sentence. */
  node.addEventListener("pointerenter", () => clearTimeout(timer));
  node.addEventListener("pointerleave", () => arm(2000));
  node.addEventListener("focusin", () => clearTimeout(timer));
  node.addEventListener("focusout", () => arm(2000));

  toastRegion.append(node);
  enter(node, { duration: 0.22 });
  arm(tone === "critical" ? duration + 3000 : duration);
  return close;
}

export const toastError = (err, fallback = "Something went wrong. Please try again.") =>
  toast(friendlyError(err, fallback), { tone: "critical" });

/* Firebase error codes → words a shop owner can act on. */
export function friendlyError(err, fallback = "Something went wrong. Please try again.") {
  const code = (err && err.code) || "";
  if (code === "permission-denied" || code === "storage/unauthorized") return "You don't have permission to do that. Try signing out and in again.";
  if (code === "unavailable" || code === "auth/network-request-failed" || code === "storage/retry-limit-exceeded")
    return "No connection. Check your internet and try again.";
  if (code === "storage/canceled") return "Upload cancelled.";
  if (code === "storage/quota-exceeded") return "Storage is full. Remove unused photos or upgrade the Firebase plan.";
  if (code === "failed-precondition" || code === "aborted") return "That changed while you were editing. Please try again.";
  if (err && err.message && !code) return err.message;
  return fallback;
}

/* --- Dialogs -----------------------------------------------------------------------
   Native <dialog>: focus is trapped and Escape works without extra code. */
export function openDialog({ title, body, actions = [], size = "medium", dismissible = true }) {
  const titleId = uid("dlg");
  let closing = false;
  let settle;
  const done = new Promise((resolve) => (settle = resolve));

  const panel = h("div", { class: "dialog-panel" },
    h("div", { class: "dialog-head" },
      h("h2", { id: titleId }, title),
      dismissible && h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => close(null) }, icon("x"))),
    h("div", { class: "dialog-body" }, body),
    actions.length > 0 && h("div", { class: "dialog-foot" }, actions));
  const dlg = h("dialog", { class: `dialog dialog--${size}`, "aria-labelledby": titleId }, panel);

  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (dismissible) close(null);
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg && dismissible) close(null); // the backdrop
  });

  document.body.append(dlg);
  closeMenus();
  dlg.showModal();
  const first = panel.querySelector("[autofocus], .dialog-body input:not([type=hidden]), .dialog-body textarea, .dialog-body select");
  if (first) first.focus();
  enter(panel, { scale: true, duration: 0.2 });

  async function close(value) {
    if (closing) return;
    closing = true;
    await leave(panel, { scale: true, duration: 0.12 });
    dlg.close();
    dlg.remove();
    settle(value);
  }
  return { el: dlg, panel, close, done };
}

/** Resolves true when confirmed. */
export function confirmDialog({ title, message, confirmLabel = "Confirm", destructive = false, cancelLabel = "Cancel" }) {
  const cancel = button(cancelLabel, { onClick: () => d.close(false) });
  const ok = button(confirmLabel, { variant: destructive ? "critical" : "primary", onClick: () => d.close(true) });
  const d = openDialog({ title, body: h("p", null, message), actions: [cancel, ok], size: "small" });
  ok.focus();
  return d.done.then((v) => v === true);
}

/* --- Contextual save bar ------------------------------------------------------------
   Shopify's black "Unsaved changes" bar over the top of the admin. Ctrl/⌘+S
   saves while it is showing. */
export const saveBar = (() => {
  let bar;
  let saveBtn;
  let discardBtn;
  let current = null;

  function ensure() {
    if (bar) return;
    discardBtn = button("Discard", { variant: "dark", onClick: () => current && current.onDiscard() });
    saveBtn = button("Save", { variant: "light", onClick: () => current && current.onSave() });
    bar = h("div", { class: "savebar", role: "region", "aria-label": "Unsaved changes", hidden: true },
      h("div", { class: "savebar-inner" },
        h("p", { class: "savebar-title" }, icon("alert-triangle", { size: 18 }), current && current.message ? current.message : "Unsaved changes"),
        h("div", { class: "savebar-actions" }, discardBtn, saveBtn)));
    document.body.append(bar);
    document.addEventListener("keydown", (e) => {
      if (!current || bar.hidden) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        current.onSave();
      }
    });
  }

  return {
    show(opts) {
      ensure();
      current = opts;
      if (bar.hidden) {
        bar.hidden = false;
        enter(bar, { from: "translateY(-100%)", duration: 0.2 });
      }
    },
    hide() {
      current = null;
      if (!bar || bar.hidden) return;
      bar.hidden = true;
    },
    busy(on) {
      if (!bar) return;
      saveBtn.disabled = on;
      discardBtn.disabled = on;
      saveBtn.classList.toggle("is-busy", on);
    },
    get visible() {
      return !!bar && !bar.hidden;
    },
  };
})();

/* --- Misc ---------------------------------------------------------------------------- */

export function avatar(name, size = 28) {
  return h("span", { class: "avatar", style: { width: `${size}px`, height: `${size}px` }, "aria-hidden": "true" },
    String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => (w[0] || "").toUpperCase()).join("") || "?");
}

/** Copies text and confirms with a toast. */
export async function copy(text, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(what);
  } catch {
    toast("Couldn't copy. Select the text and copy it by hand.", { tone: "critical" });
  }
}

/* Multi-line text (an address, a note) with line breaks kept, still as text. */
export function lines(text) {
  return String(text || "").split(/\r?\n/).map((line, i) => (i ? [h("br"), line] : line));
}
