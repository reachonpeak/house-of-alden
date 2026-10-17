/* ==========================================================================
   HOUSE OF ALDEN ADMIN — if the admin can't start, say so
   A plain script, so it still runs when the module code can't load (offline,
   or Google's CDN blocked by an extension or a network). Without it a failed
   load would leave the logo spinning on a blank page.
   ========================================================================== */
(function () {
  var shown = false;

  function fail() {
    var app = document.getElementById("app");
    if (shown || !app || !app.classList.contains("boot")) return;
    shown = true;
    app.classList.remove("boot");
    app.removeAttribute("aria-busy");
    var box = document.createElement("div");
    box.className = "boot-fail";
    box.setAttribute("role", "alert");
    var title = document.createElement("h1");
    title.textContent = "The admin couldn't load";
    var text = document.createElement("p");
    text.textContent = "Check your internet connection. If you use an ad blocker, allow this site and gstatic.com, then reload.";
    var again = document.createElement("button");
    again.type = "button";
    again.textContent = "Reload";
    again.addEventListener("click", function () { location.reload(); });
    box.append(title, text, again);
    app.replaceChildren(box);
  }

  var main = document.querySelector('script[type="module"][src="/admin/js/app.js"]');
  if (main) main.addEventListener("error", fail);
  window.addEventListener("error", function (e) {
    if (e && e.filename && e.filename.indexOf("/admin/js/") !== -1) setTimeout(fail, 0);
  });
  setTimeout(fail, 20000);
})();
