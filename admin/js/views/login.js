/* ==========================================================================
   HOUSE OF ALDEN ADMIN — sign in
   Email and password (Firebase Authentication). Firebase itself slows down
   repeated wrong guesses; nothing about the account is revealed by an error.
   ========================================================================== */

import { auth, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "../fb.js";
import { busy, button, field, h, icon, input, setTitle } from "../ui.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function message(err) {
  switch (err && err.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "That email and password don't match. Check them and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes, or reset your password.";
    case "auth/user-disabled":
      return "This account has been switched off. Ask the store owner.";
    case "auth/network-request-failed":
      return "No connection. Check your internet and try again.";
    default:
      return "Sign-in didn't work. Please try again.";
  }
}

function shell(...children) {
  return h("main", { class: "auth", id: "main" },
    h("div", { class: "auth-card" },
      h("img", { class: "auth-logo", src: "/images/logo-mark.webp", alt: "House of Alden", width: 52, height: 68 }),
      children));
}

export function renderLogin(root) {
  setTitle("Log in");
  const email = input({ type: "email", autocomplete: "username", inputmode: "email", required: true, spellcheck: "false", maxlength: 254 });
  const password = input({ type: "password", autocomplete: "current-password", required: true, maxlength: 128 });
  const reveal = h("button", { type: "button", class: "input-action", "aria-label": "Show password", "aria-pressed": "false" }, icon("eye", { size: 18 }));
  reveal.addEventListener("click", () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    reveal.setAttribute("aria-pressed", String(show));
    reveal.setAttribute("aria-label", show ? "Hide password" : "Show password");
    password.focus();
  });
  const alert = h("p", { class: "auth-alert", role: "alert", hidden: true });
  const note = h("p", { class: "auth-note", role: "status" });
  const submit = button("Log in", { variant: "primary", type: "submit", className: "btn--block" });
  const forgot = h("button", { type: "button", class: "link small" }, "Forgot password?");

  const say = (text) => {
    alert.textContent = text;
    alert.hidden = !text;
  };

  const passwordField = field({ label: "Password", control: password, action: forgot });
  const withReveal = h("div", { class: "input-with-action" });
  password.replaceWith(withReveal);
  withReveal.append(password, reveal);

  const form = h("form", { class: "stack stack--md", novalidate: true },
    field({ label: "Email", control: email }),
    passwordField,
    alert,
    submit,
    note);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    say("");
    note.textContent = "";
    if (!EMAIL.test(email.value.trim())) {
      say("Enter the email address you sign in with.");
      email.focus();
      return;
    }
    if (!password.value) {
      say("Enter your password.");
      password.focus();
      return;
    }
    busy(submit, async () => {
      try {
        await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
        /* app.js takes over from onAuthStateChanged. */
      } catch (err) {
        say(message(err));
        password.select();
      }
    });
  });

  forgot.addEventListener("click", async () => {
    say("");
    if (!EMAIL.test(email.value.trim())) {
      say("Type your email address above first, then choose Forgot password.");
      email.focus();
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.value.trim());
    } catch (err) {
      if (err && err.code === "auth/network-request-failed") return say(message(err));
      /* Any other answer is treated the same, so the form never reveals
         which addresses have an account. */
    }
    note.textContent = "If that address has an account, a reset link is on its way. Check the inbox and spam folder.";
  });

  root.replaceChildren(shell(
    h("h1", null, "Log in"),
    h("p", { class: "subdued" }, "Continue to House of Alden admin"),
    form));
  email.focus();
}

/* Signed in, but not staff (or access was removed). */
export function renderNoAccess(root, user, reason = "none") {
  setTitle("No access");
  root.replaceChildren(shell(
    h("h1", null, reason === "removed" ? "Access removed" : "No admin access"),
    h("p", null, `${user.email} isn't set up as staff for this store.`),
    h("p", { class: "subdued" }, "Ask the store owner to add you under Settings, Users and permissions."),
    button("Sign out", { variant: "primary", className: "btn--block", onClick: () => signOut(auth) })));
}

export function renderFatal(root, text) {
  setTitle("Admin unavailable");
  root.replaceChildren(shell(
    h("h1", null, "The admin couldn't start"),
    h("p", null, text),
    button("Reload", { variant: "primary", className: "btn--block", onClick: () => location.reload() })));
}
