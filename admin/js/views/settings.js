/* ==========================================================================
   HOUSE OF ALDEN ADMIN — Settings
   Store details and shipping go live on the website the moment they are
   saved (js/live.js). Users and permissions talk to the server, because only
   the server may grant or remove admin access.
   ========================================================================== */

import {
  EmailAuthProvider, auth, reauthenticateWithCredential, signOut, updatePassword,
} from "../fb.js";
import { isReady, state, subscribe } from "../store.js";
import { money, prettyPhone } from "../format.js";
import * as ops from "../ops.js";
import {
  avatar, badge, busy, button, card, checkbox, confirmDialog, field, h, icon, input, moneyInput, openDialog, page,
  pageHeader, setFieldError, setTitle, skeleton, toast, toastError,
} from "../ui.js";
import { prefs, savePrefs } from "../prefs.js";

const SECTIONS = [
  { id: "store", label: "Store details", glyph: "building-store" },
  { id: "shipping", label: "Shipping", glyph: "truck" },
  { id: "inventory", label: "Inventory", glyph: "packages" },
  { id: "users", label: "Users and permissions", glyph: "users" },
  { id: "account", label: "Your account", glyph: "user" },
  { id: "notifications", label: "Notifications", glyph: "bell" },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HTTPS = /^https:\/\/[^\s"'<>]+$/;

/* --- Store details ----------------------------------------------------------- */

function storeSection() {
  const s = state.settings || {};
  const wa = input({ value: s.whatsapp || "", type: "tel", inputmode: "numeric", maxlength: 15, autocomplete: "off" });
  const email = input({ value: s.email || "", type: "email", maxlength: 254 });
  const ig = input({ value: s.instagram || "", type: "url", inputmode: "url", maxlength: 300, placeholder: "https://instagram.com/houseofalden" });
  const pin = input({ value: s.pinterest || "", type: "url", inputmode: "url", maxlength: 300, placeholder: "https://pinterest.com/houseofalden" });
  const test = h("a", { class: "link small", target: "_blank", rel: "noopener noreferrer" }, "Open in WhatsApp");
  const paintTest = () => {
    const digits = wa.value.replace(/\D/g, "");
    test.hidden = digits.length < 11;
    test.href = `https://wa.me/${digits}`;
  };
  wa.addEventListener("input", paintTest);
  paintTest();
  const save = button("Save", { variant: "primary" });
  save.addEventListener("click", () => {
    [wa, email, ig, pin].forEach((el) => setFieldError(el, ""));
    const digits = wa.value.replace(/\D/g, "");
    let bad = false;
    if (digits.length < 11 || digits.length > 15) {
      setFieldError(wa, "Country code and number, digits only, like 917087511282.");
      bad = true;
    }
    if (email.value.trim() && !EMAIL.test(email.value.trim())) {
      setFieldError(email, "That email address doesn't look right.");
      bad = true;
    }
    [[ig, "Instagram"], [pin, "Pinterest"]].forEach(([el, name]) => {
      if (el.value.trim() && !HTTPS.test(el.value.trim())) {
        setFieldError(el, `Paste the full ${name} address, starting with https://`);
        bad = true;
      }
    });
    if (bad) return;
    busy(save, async () => {
      try {
        await ops.saveStoreSettings({ whatsapp: digits, email: email.value.trim(), instagram: ig.value.trim(), pinterest: pin.value.trim() });
        toast("Store details saved. The website is updated.");
      } catch (err) {
        toastError(err);
      }
    });
  });
  return [
    card({ title: "Contact" },
      h("div", { class: "stack stack--md" },
        field({ label: "WhatsApp number for orders", control: wa, action: test,
          help: `Every website order and enquiry is sent here.${s.whatsapp ? ` Now: ${prettyPhone(s.whatsapp)}.` : ""}` }),
        field({ label: "Contact email", control: email, help: "Shown in the footer and on the contact page." }))),
    card({ title: "Social media" },
      h("div", { class: "stack stack--md" },
        field({ label: "Instagram", control: ig, optional: true }),
        field({ label: "Pinterest", control: pin, optional: true, help: "Leave empty to hide the link on the website." }))),
    card({ subdued: true },
      h("p", { class: "subdued" }, "The store name, address and Udyam number are written into the website's pages. Ask your developer to change those.")),
    h("div", { class: "page-foot" }, save),
  ];
}

/* --- Shipping ------------------------------------------------------------------ */

function shippingSection() {
  const sh = (state.settings && state.settings.shipping) || {};
  const flat = moneyInput({ value: String(sh.flatRate ?? 0) });
  const free = moneyInput({ value: String(sh.freeAbove ?? 0) });
  const summary = h("p", { class: "banner banner--info" });
  const read = (el) => {
    const n = Number(String(el.value).replace(/[^\d]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : 0;
  };
  const paint = () => {
    const f = read(flat.input);
    const a = read(free.input);
    summary.replaceChildren(icon("info-circle", { size: 18 }),
      f === 0 ? "Shipping is free on every order."
        : a > 0 ? `Orders under ${money(a)} pay ${money(f)} shipping. Orders of ${money(a)} or more ship free.`
          : `Every order pays ${money(f)} shipping.`);
  };
  [flat.input, free.input].forEach((el) => el.addEventListener("input", paint));
  paint();
  const save = button("Save", { variant: "primary" });
  save.addEventListener("click", () => busy(save, async () => {
    try {
      await ops.saveStoreSettings({ shipping: { flatRate: read(flat.input), freeAbove: read(free.input) } });
      toast("Shipping saved. Carts on the website use it now.");
    } catch (err) {
      toastError(err);
    }
  }));
  return [
    card({ title: "Shipping rates" },
      h("div", { class: "stack stack--md" },
        h("div", { class: "grid-2 grid-2--tight" },
          field({ label: "Flat rate per order", control: flat.wrap, help: "0 means shipping is always free." }),
          field({ label: "Free shipping from", control: free.wrap, help: "Order total that ships free. 0 means never." })),
        summary)),
    h("div", { class: "page-foot" }, save),
  ];
}

/* --- Inventory ------------------------------------------------------------------ */

function inventorySection() {
  const low = input({ type: "number", min: "0", step: "1", inputmode: "numeric", value: String(state.adminSettings.lowStockThreshold ?? 2) });
  const save = button("Save", { variant: "primary" });
  save.addEventListener("click", () => {
    const n = Math.floor(Number(low.value));
    if (!Number.isFinite(n) || n < 0 || n > 100000) return setFieldError(low, "Use a whole number, like 2.");
    setFieldError(low, "");
    busy(save, async () => {
      try {
        await ops.saveAdminSettings({ lowStockThreshold: n });
        toast("Saved");
      } catch (err) {
        toastError(err);
      }
    });
  });
  return [
    card({ title: "Low stock alert" },
      field({ label: "Warn me when stock falls to", control: low, help: "Tracked products at or below this number are flagged on Home and in Inventory." })),
    h("div", { class: "page-foot" }, save),
  ];
}

/* --- Users and permissions ------------------------------------------------------ */

function addStaffDialog() {
  const name = input({ maxlength: 80, autocomplete: "off" });
  const email = input({ type: "email", maxlength: 254, autocomplete: "off" });
  const password = input({ type: "password", minlength: "8", maxlength: 128, autocomplete: "new-password" });
  const save = button("Add staff", { variant: "primary" });
  const d = openDialog({
    title: "Add staff",
    body: h("div", { class: "stack stack--md" },
      h("p", null, "They sign in at /admin with this email and password, and can do everything except manage staff."),
      field({ label: "Name", control: name }),
      field({ label: "Email", control: email }),
      field({ label: "Temporary password", control: password, help: "At least 8 characters. Ask them to change it in Your account." })),
    actions: [button("Cancel", { onClick: () => d.close() }), save],
  });
  save.addEventListener("click", () => {
    [email, password].forEach((el) => setFieldError(el, ""));
    if (!EMAIL.test(email.value.trim())) return setFieldError(email, "Enter a valid email address.");
    if (password.value.length < 8) return setFieldError(password, "Use at least 8 characters.");
    busy(save, async () => {
      try {
        await ops.staffRequest("POST", { name: name.value.trim(), email: email.value.trim(), password: password.value });
        toast("Staff member added");
        d.close();
      } catch (err) {
        toastError(err);
      }
    });
  });
}

function resetPasswordDialog(member) {
  const password = input({ type: "password", minlength: "8", maxlength: 128, autocomplete: "new-password" });
  const save = button("Set password", { variant: "primary" });
  const d = openDialog({
    title: `New password for ${member.name || member.email}`,
    body: h("div", { class: "stack stack--md" },
      h("p", null, "They will be signed out everywhere and need this password to sign in again."),
      field({ label: "New password", control: password, help: "At least 8 characters." })),
    actions: [button("Cancel", { onClick: () => d.close() }), save],
    size: "small",
  });
  save.addEventListener("click", () => {
    if (password.value.length < 8) return setFieldError(password, "Use at least 8 characters.");
    busy(save, async () => {
      try {
        await ops.staffRequest("PATCH", { uid: member.id, password: password.value });
        toast("Password changed");
        d.close();
      } catch (err) {
        toastError(err);
      }
    });
  });
}

function usersSection(claims) {
  const owner = claims.role === "owner";
  const me = auth.currentUser && auth.currentUser.uid;
  const rows = state.staff.map((m) => h("li", { class: "staff-row" },
    avatar(m.name || m.email, 36),
    h("div", { class: "staff-main" },
      h("p", { class: "strong" }, m.name || m.email, m.id === me && h("span", { class: "subdued" }, " (you)")),
      h("p", { class: "subdued" }, m.email)),
    badge(m.role === "owner" ? "Store owner" : "Staff", m.role === "owner" ? "info" : "neutral"),
    owner && m.role !== "owner" && m.id !== me && h("div", { class: "inline" },
      button("Reset password", { size: "slim", onClick: () => resetPasswordDialog(m) }),
      button("Remove", { size: "slim", variant: "critical", onClick: async () => {
        const ok = await confirmDialog({ title: `Remove ${m.name || m.email}?`, message: "They lose access to the admin at once and are signed out everywhere.", confirmLabel: "Remove access", destructive: true });
        if (!ok) return;
        try {
          await ops.staffRequest("DELETE", { uid: m.id });
          toast("Access removed");
        } catch (err) {
          toastError(err);
        }
      } }))));
  return [
    card({ title: "Staff", actions: owner && button("Add staff", { variant: "primary", iconStart: "user-plus", onClick: addStaffDialog }) },
      h("ul", { class: "staff-list" }, rows),
      !owner && h("p", { class: "subdued" }, "Only the store owner can add or remove staff.")),
  ];
}

/* --- Your account --------------------------------------------------------------- */

function accountSection() {
  const user = auth.currentUser;
  const current = input({ type: "password", autocomplete: "current-password", maxlength: 128 });
  const next = input({ type: "password", autocomplete: "new-password", minlength: "8", maxlength: 128 });
  const again = input({ type: "password", autocomplete: "new-password", maxlength: 128 });
  const save = button("Change password", { variant: "primary" });
  save.addEventListener("click", () => {
    [current, next, again].forEach((el) => setFieldError(el, ""));
    if (!current.value) return setFieldError(current, "Enter your current password.");
    if (next.value.length < 8) return setFieldError(next, "Use at least 8 characters.");
    if (next.value !== again.value) return setFieldError(again, "The two new passwords don't match.");
    busy(save, async () => {
      try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current.value));
        await updatePassword(user, next.value);
        [current, next, again].forEach((el) => (el.value = ""));
        toast("Password changed");
      } catch (err) {
        const code = err && err.code;
        if (code === "auth/invalid-credential" || code === "auth/wrong-password") setFieldError(current, "That isn't your current password.");
        else if (code === "auth/weak-password" || code === "auth/password-does-not-meet-requirements") setFieldError(next, "Choose a longer, less common password.");
        else if (code === "auth/too-many-requests") toast("Too many attempts. Wait a few minutes and try again.", { tone: "critical" });
        else toastError(err);
      }
    });
  });
  return [
    card({ title: "Signed in as" },
      h("div", { class: "staff-row" }, avatar(user.displayName || user.email, 36),
        h("div", { class: "staff-main" }, h("p", { class: "strong" }, user.displayName || user.email), h("p", { class: "subdued" }, user.email)),
        button("Sign out", { onClick: () => signOut(auth) }))),
    card({ title: "Change password" },
      h("div", { class: "stack stack--md" },
        field({ label: "Current password", control: current }),
        field({ label: "New password", control: next, help: "At least 8 characters. A short sentence is easier to remember and harder to guess." }),
        field({ label: "Confirm new password", control: again }))),
    h("div", { class: "page-foot" }, save),
  ];
}

/* --- Notifications (this device only) --------------------------------------------- */

function notificationsSection() {
  const sound = checkbox("Play a sound when an order arrives", { checked: prefs.sound, onChange: (v) => savePrefs({ sound: v }) });
  const supported = "Notification" in window;
  const desktop = checkbox("Show a desktop notification when an order arrives", {
    checked: supported && prefs.desktop && Notification.permission === "granted",
    disabled: !supported || (supported && Notification.permission === "denied"),
    help: !supported ? "This browser doesn't support notifications."
      : Notification.permission === "denied" ? "Notifications are blocked for this site in the browser's settings."
        : "Appears even when this tab is in the background.",
    onChange: async (v) => {
      if (v && Notification.permission !== "granted") {
        const result = await Notification.requestPermission();
        if (result !== "granted") {
          desktop.input.checked = false;
          toast("Notifications weren't allowed.", { tone: "critical" });
          return;
        }
      }
      savePrefs({ desktop: v });
    },
  });
  return [card({ title: "New orders" },
    h("div", { class: "stack stack--md" }, sound.el, desktop.el,
      h("p", { class: "subdued" }, "These apply to this browser only. Keep the admin open in a tab to hear new orders.")))];
}

/* Store details and shipping decide where orders go and what they cost, so
   only the owner may change them (firestore.rules enforces the same). Staff
   see them read-only. */
function ownerOnly(parts, owner) {
  if (owner) return parts;
  parts.forEach((part) => part.querySelectorAll("input, select, textarea, button").forEach((el) => (el.disabled = true)));
  return [h("div", { class: "banner banner--info" }, icon("lock", { size: 18 }),
    h("p", null, "Only the store owner can change these settings.")),
  ...parts.filter((part) => !part.classList.contains("page-foot"))];
}

/* --- Screen --------------------------------------------------------------------------- */

export function render(root, route, { claims }) {
  const active = SECTIONS.some((s) => s.id === route.params.section) ? route.params.section : "store";
  const section = SECTIONS.find((s) => s.id === active);
  setTitle(`${section.label} · Settings`);

  const nav = h("nav", { class: "settings-nav", "aria-label": "Settings" },
    SECTIONS.map((s) => h("a", { href: `/admin/settings/${s.id}`, class: `settings-link${s.id === active ? " is-active" : ""}`,
      "aria-current": s.id === active ? "page" : null }, icon(s.glyph, { size: 20 }), s.label)));
  const content = h("div", { class: "stack stack--md" });

  const owner = claims.role === "owner";
  const build = {
    store: () => ownerOnly(storeSection(), owner),
    shipping: () => ownerOnly(shippingSection(), owner),
    inventory: inventorySection,
    users: () => usersSection(claims), account: accountSection, notifications: notificationsSection,
  }[active];
  const needs = { store: ["settings"], shipping: ["settings"], inventory: ["adminSettings"], users: ["staff"] }[active] || [];

  const draw = () => {
    content.replaceChildren(...(needs.length && !isReady(...needs) ? [card({}, skeleton(4))] : build()));
  };

  root.replaceChildren(page({ width: "wide" },
    pageHeader({ title: "Settings" }),
    h("div", { class: "settings" }, nav, h("div", { class: "settings-body" }, h("h2", { class: "settings-title" }, section.label), content))));
  draw();

  /* Forms are not redrawn under someone's fingers; lists (staff) are. */
  let drawnOnce = needs.length === 0 || isReady(...needs);
  return subscribe((topics) => {
    if (active === "users" && topics.has("staff")) return draw();
    if (!drawnOnce && needs.length && isReady(...needs)) {
      drawnOnce = true;
      draw();
    }
  });
}
