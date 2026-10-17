/* Moved out of contact.html unchanged, so the site can run under a strict
   Content-Security-Policy (no inline scripts). Depends on: config.js, main.js. */

/* ==========================================================================
   Contact enquiry → WhatsApp
   The number this form sends to is read from BUSINESS.whatsapp (js/config.js).
   NOTE: the numbers in "Our details" above are written into the page by hand so
   they survive with JavaScript switched off — the same trade-off the footer
   social links make (see README, "Your Instagram and Pinterest"). If you change
   BUSINESS.whatsapp, search this file for the old number and change it here too,
   or the form and the buttons will point at different phones.
   ========================================================================== */
(function () {
  const form = document.querySelector("[data-enquiry]");
  if (!form) return;

  const status = form.querySelector("[data-form-status]");
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /* One rule per required field. Returns "" when the value is acceptable. */
  const checks = {
    "c-name": (v) => (v ? "" : "Please tell us your name."),
    "c-email": (v) =>
      !v ? "Please give us an address we can reply to."
         : EMAIL.test(v) ? "" : "That does not look like an email address.",
    "c-message": (v) => (v ? "" : "Please tell us what you would like to know."),
  };

  const val = (id) => document.getElementById(id).value.trim();

  function setError(input, msg) {
    const err = document.getElementById(input.id + "-error");
    if (!err) return;
    err.textContent = msg;
    err.hidden = !msg;
    if (msg) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", err.id);
    } else {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    }
  }

  /* Swap classes rather than toggle [hidden] — see the markup comment. */
  function setStatus(msg) {
    status.textContent = msg;
    status.className = msg ? "notice" : "visually-hidden";
  }

  /* Clear a field's error the moment the visitor starts fixing it. */
  form.addEventListener("input", (e) => {
    if (e.target.hasAttribute("aria-invalid")) setError(e.target, "");
    /* The summary has done its work once they start correcting — leaving
       "something is missing" up after every field is fixed reads as a lie, and
       a stale role="status" keeps saying it to a screen reader. The per-field
       errors stay put as the real guidance. */
    if (status.textContent) setStatus("");
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    let firstBad = null;
    Object.keys(checks).forEach((id) => {
      const input = document.getElementById(id);
      const msg = checks[id](input.value.trim());
      setError(input, msg);
      if (msg && !firstBad) firstBad = input;
    });

    if (firstBad) {
      setStatus("Please check the fields above — something is missing.");
      firstBad.focus();
      return;
    }

    const L = [`*Enquiry — ${BUSINESS.name}*`, ""];
    L.push(`Name: ${val("c-name")}`);
    L.push(`Email: ${val("c-email")}`);
    if (val("c-phone")) L.push(`Phone: ${val("c-phone")}`);
    L.push("", val("c-message"));

    const url = `https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent(L.join("\n"))}`;

    /* Opened synchronously inside the submit so mobile Safari does not swallow
       it as an unrequested popup — same reasoning as Checkout in js/cart.js.

       "noopener" is deliberately NOT in the feature string. Per the HTML spec
       ("window open steps": if noopener is true, return null) window.open()
       returns null whenever noopener is set — even when the tab opened fine.
       Passing it here would make the test below fire on every successful send,
       telling the visitor to allow pop-ups that were never blocked and throwing
       away the message they just wrote. The opener is severed by hand instead,
       which keeps the security property and leaves the test honest: without the
       feature string, null means genuinely blocked. */
    const win = window.open(url, "_blank");
    if (!win) {
      setStatus("Please allow pop-ups to send your enquiry on WhatsApp.");
      return;
    }
    try { win.opener = null; } catch { /* nothing to sever; the tab is already away */ }

    setStatus("Opening WhatsApp with your enquiry. Press send there and it reaches us.");
    form.reset();
  });
})();
