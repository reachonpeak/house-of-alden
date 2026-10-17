/* ==========================================================================
   HOUSE OF ALDEN ADMIN — add / edit a product
   --------------------------------------------------------------------------
   Everything the shop shows about a piece: photos, title, description, price
   (and a "compare at" price for sales), stock, specifications, the search
   listing, status and category. Saving publishes it — an Active product
   appears on the website within seconds.

   Photos upload the moment they are chosen (resized first, lib/image.js).
   Photos uploaded and then discarded, or removed and saved, are deleted from
   storage so nothing is left behind.
   ========================================================================== */

import { derive, isReady, state, subscribe } from "../store.js";
import { HANDLE, money, slugify } from "../format.js";
import { navigate, setLeaveGuard } from "../router.js";
import * as ops from "../ops.js";
import { prepareImage } from "../lib/image.js";
import {
  assetUrl, button, card, checkbox, confirmDialog, emptyState, field, h, icon, input, layout, loadingPage, moneyInput,
  openDialog, page, pageHeader, saveBar, select, setFieldError, setTitle, textarea, toast, toastError,
} from "../ui.js";
import { productStatusBadge } from "./shared.js";

const MAX_IMAGES = 10;
const BADGES = ["New", "Last One", "Bestseller", "Limited Edition", "Sale"];

const toInt = (v) => {
  const s = String(v ?? "").replace(/[,\s₹]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

function formFrom(p, cost) {
  return {
    name: p.name || "",
    description: p.description || "",
    blurb: p.blurb || "",
    images: (p.images || []).map((i) => ({ url: i.url, path: i.path || "", alt: i.alt || "" })),
    price: p.price != null ? String(p.price) : "",
    compareAtPrice: p.compareAtPrice != null ? String(p.compareAtPrice) : "",
    cost: cost != null ? String(cost) : "",
    trackInventory: p.trackInventory !== false,
    quantity: String(Number.isInteger(p.quantity) ? p.quantity : 0),
    continueSelling: p.continueSelling === true,
    sku: p.sku || "",
    specs: (p.specs || []).map((s) => ({ label: s.label || "", value: s.value || "" })),
    seoTitle: p.seoTitle || "",
    seoDescription: p.seoDescription || "",
    status: p.status || "active",
    category: p.category || "watches",
    badge: p.badge || "",
    tags: (p.tags || []).join(", "),
    position: String(p.position ?? ""),
  };
}

const parseTags = (s) => [...new Set(String(s || "").split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 30).map((t) => t.slice(0, 40));
const signature = (f) => JSON.stringify(f);

export function render(root, route) {
  const isNew = !route.params.id;
  const id = route.params.id;
  const folder = isNew
    ? `new-${Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("")}`
    : id;

  let f = null; // the form
  let initial = ""; // signature of what is saved
  let savedForm = null;
  let handleTouched = false;
  let uploading = 0;
  let uploadedNow = []; // photos uploaded during this edit, not yet saved
  let removedNow = []; // saved photos removed during this edit
  let deletedElsewhere = false;

  const holder = h("div");
  root.replaceChildren(holder);

  const dirty = () => f && signature(f) !== initial;

  async function cleanupUploads() {
    const saved = new Set((savedForm ? savedForm.images : []).map((i) => i.path));
    await ops.deleteImages(uploadedNow.filter((img) => !saved.has(img.path)));
    uploadedNow = [];
  }

  function onChange() {
    if (dirty()) {
      saveBar.show({ onSave: save, onDiscard: discard });
      setLeaveGuard(async () => {
        const leave = await confirmDialog({ title: "Leave with unsaved changes?", message: "Your changes to this product will be lost.", confirmLabel: "Leave page", destructive: true });
        if (leave) {
          saveBar.hide();
          cleanupUploads();
        }
        return leave;
      });
    } else {
      saveBar.hide();
      setLeaveGuard(null);
    }
  }

  async function discard() {
    await cleanupUploads();
    removedNow = [];
    f = JSON.parse(JSON.stringify(savedForm));
    handleTouched = false;
    saveBar.hide();
    setLeaveGuard(null);
    draw();
  }

  function validate(controls) {
    const errors = [];
    const fail = (control, message) => {
      errors.push(message);
      if (control) setFieldError(control, message);
    };
    Object.values(controls).forEach((c) => c && setFieldError(c, ""));

    if (!f.name.trim()) fail(controls.name, "Give the product a title.");
    const price = toInt(f.price);
    if (price === null || Number.isNaN(price) || price < 0 || price > 100000000) fail(controls.price, "Enter a price in whole rupees, like 8900.");
    const compare = toInt(f.compareAtPrice);
    if (compare !== null && (Number.isNaN(compare) || compare < 0 || compare > 100000000)) fail(controls.compare, "Enter a price in whole rupees, or leave it empty.");
    else if (compare !== null && price !== null && compare <= price) fail(controls.compare, "Compare-at price must be higher than the price, or empty.");
    const cost = toInt(f.cost);
    if (cost !== null && (Number.isNaN(cost) || cost < 0 || cost > 100000000)) fail(controls.cost, "Enter a cost in whole rupees, or leave it empty.");
    if (f.trackInventory) {
      const q = toInt(f.quantity);
      if (q === null || Number.isNaN(q) || q < -1000000 || q > 1000000) fail(controls.quantity, "Enter how many you have, like 5.");
    }
    const pos = toInt(f.position);
    if (pos !== null && Number.isNaN(pos)) fail(controls.position, "Use a whole number, like 10.");
    if (isNew) {
      const handle = slugOrHandle();
      if (!HANDLE.test(handle) || handle === "new") fail(controls.handle, "Use lowercase letters, numbers and dashes, like pearl-drop.");
      else if (state.productsById.has(handle)) fail(controls.handle, "Another product already uses this handle.");
    }
    if (f.images.length > MAX_IMAGES) errors.push(`Use at most ${MAX_IMAGES} photos.`);
    return errors;
  }

  const slugOrHandle = () => (handleTouched ? f.handle : slugify(f.name)) || "";

  async function save() {
    if (uploading) {
      toast("Wait for the photos to finish uploading.");
      return;
    }
    const errors = validate(currentControls);
    if (errors.length) {
      toast(errors.length === 1 ? errors[0] : `Fix ${errors.length} problems before saving.`, { tone: "critical" });
      const bad = holder.querySelector('[aria-invalid="true"]');
      if (bad) bad.focus();
      return;
    }
    const productId = isNew ? slugOrHandle() : id;
    const quantity = f.trackInventory ? toInt(f.quantity) : (isNew ? 0 : null);
    const data = {
      name: f.name.trim(),
      status: f.status,
      category: f.category,
      price: toInt(f.price),
      compareAtPrice: toInt(f.compareAtPrice),
      badge: f.badge.trim().slice(0, 24),
      blurb: f.blurb.trim(),
      description: f.description.trim(),
      images: f.images.map((img) => ({ url: img.url, path: img.path || "", alt: (img.alt || "").trim().slice(0, 300) })),
      specs: f.specs.filter((s) => s.label.trim()).slice(0, 30).map((s) => ({ label: s.label.trim().slice(0, 80), value: s.value.trim().slice(0, 200) })),
      sku: f.sku.trim().slice(0, 64),
      trackInventory: f.trackInventory,
      continueSelling: f.trackInventory && f.continueSelling,
      tags: parseTags(f.tags),
      position: toInt(f.position) ?? 0,
      seoTitle: f.seoTitle.trim(),
      seoDescription: f.seoDescription.trim(),
    };
    if (isNew) data.quantity = quantity ?? 0;
    const startQty = toInt(savedForm.quantity) || 0;
    const qtyDelta = !isNew && f.trackInventory && quantity !== null ? quantity - startQty : 0;

    saveBar.busy(true);
    try {
      await ops.saveProduct({ id: productId, isNew, data, cost: toInt(f.cost), qtyDelta });
      await ops.deleteImages(removedNow);
      removedNow = [];
      uploadedNow = [];
      savedForm = JSON.parse(JSON.stringify(f));
      initial = signature(f);
      saveBar.hide();
      setLeaveGuard(null);
      toast(isNew ? "Product created" : "Product saved");
      if (isNew) navigate(`/admin/products/${encodeURIComponent(productId)}`, { replace: true });
      else draw();
    } catch (err) {
      toastError(err, "The product couldn't be saved. Please try again.");
    } finally {
      saveBar.busy(false);
    }
  }

  async function remove(product) {
    const ok = await confirmDialog({
      title: `Delete ${product.name}?`,
      message: "It disappears from the shop and from carts. Past orders keep their details. To hide it but keep it, set it to Draft or Archived instead.",
      confirmLabel: "Delete product",
      destructive: true,
    });
    if (!ok) return;
    try {
      saveBar.hide();
      setLeaveGuard(null);
      await cleanupUploads();
      await ops.deleteProduct(product);
      toast(`${product.name} deleted`);
      navigate("/admin/products", { replace: true });
    } catch (err) {
      toastError(err);
    }
  }

  /* --- Photos ------------------------------------------------------------- */

  function mediaCard() {
    const grid = h("div", { class: "media-grid" });
    const fileInput = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif",
      multiple: true, class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
    const progress = new Map(); // tile → progress element

    function tile(img, i) {
      const move = (to) => {
        const [item] = f.images.splice(i, 1);
        f.images.splice(to, 0, item);
        paint();
        onChange();
      };
      return h("figure", { class: `media-tile${i === 0 ? " is-featured" : ""}` },
        h("img", { src: assetUrl(img.url), alt: img.alt || "", loading: "lazy", decoding: "async" }),
        i === 0 && h("span", { class: "media-flag" }, "Main photo"),
        h("div", { class: "media-tools" },
          button("", { variant: "overlay", size: "slim", iconStart: "pencil", ariaLabel: `Alt text for photo ${i + 1}`, onClick: () => altDialog(img) }),
          i > 0 && button("", { variant: "overlay", size: "slim", iconStart: "star", ariaLabel: `Make photo ${i + 1} the main photo`, onClick: () => move(0) }),
          i > 0 && button("", { variant: "overlay", size: "slim", iconStart: "arrow-left", ariaLabel: `Move photo ${i + 1} earlier`, onClick: () => move(i - 1) }),
          i < f.images.length - 1 && button("", { variant: "overlay", size: "slim", iconStart: "arrow-right", ariaLabel: `Move photo ${i + 1} later`, onClick: () => move(i + 1) }),
          button("", { variant: "overlay", size: "slim", iconStart: "trash", ariaLabel: `Remove photo ${i + 1}`, onClick: () => {
            const [gone] = f.images.splice(i, 1);
            if (uploadedNow.some((u) => u.path === gone.path)) {
              uploadedNow = uploadedNow.filter((u) => u.path !== gone.path);
              ops.deleteImages([gone]);
            } else {
              removedNow.push(gone);
            }
            paint();
            onChange();
          } })));
    }

    function paint() {
      const tiles = f.images.map(tile);
      const pendingTiles = [...progress.keys()];
      const add = h("button", { type: "button", class: "media-add", onclick: () => fileInput.click(),
        disabled: f.images.length + pendingTiles.length >= MAX_IMAGES },
      icon("photo-plus", { size: 24 }), h("span", null, f.images.length ? "Add" : "Add photos"),
      !f.images.length && h("span", { class: "subdued" }, "or drop them here"));
      grid.replaceChildren(...tiles, ...pendingTiles, add);
      grid.classList.toggle("is-empty", !f.images.length && !pendingTiles.length);
    }

    function altDialog(img) {
      const alt = textarea({ value: img.alt || "", rows: 3, maxlength: 300 });
      const ok = button("Save", { variant: "primary" });
      const d = openDialog({
        title: "Alt text",
        body: h("div", { class: "stack stack--md" },
          h("img", { src: assetUrl(img.url), alt: "", class: "alt-preview" }),
          field({ label: "Describe the photo", control: alt,
            help: "Read aloud to blind shoppers and used by Google. For example: Gold drop earrings with a freshwater pearl." })),
        actions: [button("Cancel", { onClick: () => d.close() }), ok],
      });
      ok.addEventListener("click", () => {
        img.alt = alt.value.trim();
        d.close();
        paint();
        onChange();
      });
    }

    async function upload(files) {
      const room = MAX_IMAGES - f.images.length - progress.size;
      const list = [...files].slice(0, Math.max(0, room));
      if (files.length > list.length) toast(`A product can have ${MAX_IMAGES} photos. Some were left out.`);
      await Promise.all(list.map(async (file) => {
        const bar = h("span", { class: "media-progress-bar" });
        const label = h("span", { class: "media-progress-label" }, "Preparing…");
        const pending = h("div", { class: "media-tile is-uploading", "aria-live": "polite" },
          label, h("span", { class: "media-progress", role: "progressbar", "aria-label": `Uploading ${file.name}`, "aria-valuemin": "0", "aria-valuemax": "100" }, bar));
        progress.set(pending, true);
        uploading += 1;
        paint();
        try {
          const prepared = await prepareImage(file);
          label.textContent = "Uploading…";
          const { promise } = ops.uploadImage(folder, prepared, (p) => {
            const pct = Math.round(p * 100);
            bar.style.transform = `scaleX(${p})`;
            pending.querySelector(".media-progress").setAttribute("aria-valuenow", String(pct));
          });
          const result = await promise;
          const img = { url: result.url, path: result.path, alt: "" };
          f.images.push(img);
          uploadedNow.push(img);
        } catch (err) {
          toastError(err, `"${file.name}" couldn't be uploaded.`);
        } finally {
          uploading -= 1;
          progress.delete(pending);
          paint();
          onChange();
        }
      }));
    }

    fileInput.addEventListener("change", () => {
      if (fileInput.files.length) upload(fileInput.files);
      fileInput.value = "";
    });

    const box = card({ title: "Media", actions: f.images.length > 0 && h("span", { class: "subdued small" }, `${f.images.length} of ${MAX_IMAGES}`) },
      grid, fileInput, h("p", { class: "field-help" }, "Square photos look best. The first photo is the one shown in the shop and in search results."));
    box.addEventListener("dragover", (e) => {
      if (![...e.dataTransfer.types].includes("Files")) return;
      e.preventDefault();
      box.classList.add("is-drop");
    });
    box.addEventListener("dragleave", (e) => {
      if (!box.contains(e.relatedTarget)) box.classList.remove("is-drop");
    });
    box.addEventListener("drop", (e) => {
      e.preventDefault();
      box.classList.remove("is-drop");
      if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
    });
    paint();
    return box;
  }

  /* --- Specifications ------------------------------------------------------ */

  function specsCard() {
    const rows = h("div", { class: "specs" });
    function paint() {
      rows.replaceChildren(...f.specs.map((s, i) => {
        const label = input({ value: s.label, placeholder: "Case", maxlength: 80, "aria-label": `Specification ${i + 1} name` });
        const value = input({ value: s.value, placeholder: "38 mm, gold-tone", maxlength: 200, "aria-label": `Specification ${i + 1} value` });
        label.addEventListener("input", () => {
          s.label = label.value;
          onChange();
        });
        value.addEventListener("input", () => {
          s.value = value.value;
          onChange();
        });
        const move = (to) => {
          const [item] = f.specs.splice(i, 1);
          f.specs.splice(to, 0, item);
          paint();
          onChange();
        };
        return h("div", { class: "spec-row" }, label, value,
          button("", { variant: "tertiary", size: "slim", iconStart: "chevron-up", ariaLabel: "Move up", disabled: i === 0, onClick: () => move(i - 1) }),
          button("", { variant: "tertiary", size: "slim", iconStart: "chevron-down", ariaLabel: "Move down", disabled: i === f.specs.length - 1, onClick: () => move(i + 1) }),
          button("", { variant: "tertiary", size: "slim", iconStart: "trash", ariaLabel: "Remove specification", onClick: () => {
            f.specs.splice(i, 1);
            paint();
            onChange();
          } }));
      }));
    }
    paint();
    return card({ title: "Specifications" },
      h("p", { class: "field-help" }, "The small table on the product page: case size, metal, strap, weight."),
      rows,
      button("Add specification", { variant: "plain", iconStart: "plus", disabled: f.specs.length >= 30, onClick: () => {
        f.specs.push({ label: "", value: "" });
        paint();
        onChange();
        const last = rows.querySelector(".spec-row:last-child input");
        if (last) last.focus();
      } }));
  }

  /* --- The form ------------------------------------------------------------ */

  let currentControls = {};

  function bindText(key, control) {
    control.addEventListener("input", () => {
      f[key] = control.value;
      if (currentControls[key] === control) setFieldError(control, "");
      onChange();
      afterChange(key);
    });
    return control;
  }

  let afterChange = () => {};

  function draw() {
    if (!isReady("products", "costs")) {
      holder.replaceChildren(loadingPage(isNew ? "Add product" : "Product"));
      return;
    }
    const product = isNew ? null : state.productsById.get(id);
    if (!isNew && !product) {
      setTitle("Product not found");
      saveBar.hide();
      setLeaveGuard(null);
      holder.replaceChildren(page({}, pageHeader({ title: "Product not found", back: { href: "/admin/products", label: "Products" } }),
        card({}, emptyState({ glyph: "tag", title: deletedElsewhere ? "This product was just deleted" : "This product isn't here",
          body: "It may have been deleted, or the link is incomplete.", action: button("Back to products", { href: "/admin/products" }) }))));
      return;
    }

    if (!f) {
      const maxPos = state.products.reduce((m, p) => Math.max(m, Number(p.position) || 0), 0);
      f = isNew ? { ...formFrom({ position: maxPos + 10 }, null), handle: "" } : formFrom(product, state.costs.get(id));
      savedForm = JSON.parse(JSON.stringify(f));
      initial = signature(f);
    }
    setTitle(isNew ? "Add product" : f.name || "Product");

    const name = bindText("name", input({ value: f.name, maxlength: 140, placeholder: "The Alden Heritage" }));
    const description = bindText("description", textarea({ value: f.description, rows: 7, maxlength: 8000 }));
    const blurb = bindText("blurb", input({ value: f.blurb, maxlength: 400 }));

    const price = moneyInput({ value: f.price, placeholder: "0" });
    const compare = moneyInput({ value: f.compareAtPrice, placeholder: "0" });
    const cost = moneyInput({ value: f.cost, placeholder: "0" });
    bindText("price", price.input);
    bindText("compareAtPrice", compare.input);
    bindText("cost", cost.input);
    const margin = h("div", { class: "margin-row" });
    const paintMargin = () => {
      const p = toInt(f.price);
      const c = toInt(f.cost);
      if (p === null || c === null || Number.isNaN(p) || Number.isNaN(c)) {
        margin.replaceChildren(h("span", { class: "subdued" }, "Add a cost to see profit and margin."));
        return;
      }
      const profit = p - c;
      margin.replaceChildren(
        h("div", null, h("p", { class: "subdued small" }, "Profit"), h("p", null, money(profit))),
        h("div", null, h("p", { class: "subdued small" }, "Margin"), h("p", null, p > 0 ? `${Math.round((profit / p) * 1000) / 10}%` : "Not available")));
    };
    paintMargin();

    const quantity = input({ type: "number", inputmode: "numeric", step: "1", value: f.quantity, class: "input input--qty-lg" });
    bindText("quantity", quantity);
    const committed = isNew ? 0 : derive().committed.get(id) || 0;
    const qtyField = field({ label: "Available", control: quantity,
      help: committed ? `${committed} more ${committed === 1 ? "is" : "are"} set aside for open orders that haven't been sent.` : "How many you can sell right now." });
    const oversell = checkbox("Continue selling when out of stock", { checked: f.continueSelling,
      help: "Lets customers order even at 0. Use it for pieces you make to order.",
      onChange: (v) => {
        f.continueSelling = v;
        onChange();
      } });
    const qtyBlock = h("div", { class: "stack stack--md", hidden: !f.trackInventory }, qtyField, oversell.el);
    const track = checkbox("Track quantity", { checked: f.trackInventory,
      help: "Counts down with every order. At 0 the piece shows as sold out on the website.",
      onChange: (v) => {
        f.trackInventory = v;
        qtyBlock.hidden = !v;
        onChange();
      } });
    const sku = bindText("sku", input({ value: f.sku, maxlength: 64, autocomplete: "off" }));

    const seoTitle = bindText("seoTitle", input({ value: f.seoTitle, maxlength: 160 }));
    const seoDescription = bindText("seoDescription", textarea({ value: f.seoDescription, rows: 3, maxlength: 400 }));
    const handle = input({ value: isNew ? slugOrHandle() : id, maxlength: 63, autocomplete: "off", spellcheck: "false", readonly: !isNew });
    if (isNew) {
      handle.addEventListener("input", () => {
        handleTouched = true;
        f.handle = handle.value.trim().toLowerCase();
        setFieldError(handle, "");
        onChange();
        paintSeo();
      });
    }
    const preview = h("div", { class: "seo-preview" });
    const paintSeo = () => {
      const h2 = f.seoTitle.trim() || (f.name.trim() ? `${f.name.trim()} — House of Alden` : "Product title");
      const desc = f.seoDescription.trim() || f.blurb.trim() || f.description.trim().slice(0, 160) || "Add a description to see how this product might appear in a search engine listing.";
      const slug = isNew ? slugOrHandle() : id;
      preview.replaceChildren(
        h("p", { class: "seo-site" }, "House of Alden"),
        h("p", { class: "seo-url" }, `/product.html?id=${slug || "…"}`),
        h("p", { class: "seo-title" }, h2),
        h("p", { class: "seo-desc" }, desc));
      if (isNew && !handleTouched) handle.value = slug;
    };
    paintSeo();

    afterChange = (key) => {
      if (key === "price" || key === "cost") paintMargin();
      if (["name", "seoTitle", "seoDescription", "blurb", "description"].includes(key)) paintSeo();
    };

    const status = select([
      { value: "active", label: "Active" },
      { value: "draft", label: "Draft" },
      { value: "archived", label: "Archived" },
    ], { value: f.status });
    status.addEventListener("change", () => {
      f.status = status.value;
      onChange();
    });
    const category = select([{ value: "watches", label: "Watches" }, { value: "earrings", label: "Earrings" }], { value: f.category });
    category.addEventListener("change", () => {
      f.category = category.value;
      onChange();
    });
    const badgeList = h("datalist", { id: "badge-ideas" }, BADGES.map((b) => h("option", { value: b })));
    const badgeInput = bindText("badge", input({ value: f.badge, maxlength: 24, list: "badge-ideas" }));
    const tags = bindText("tags", input({ value: f.tags, maxlength: 600 }));
    const position = bindText("position", input({ value: f.position, type: "number", step: "1", inputmode: "numeric" }));

    currentControls = { name, price: price.input, compare: compare.input, cost: cost.input, quantity, position, handle };

    const viewLink = !isNew && product.status === "active"
      ? button("View on website", { iconStart: "external-link", href: `/product.html?id=${encodeURIComponent(id)}`, target: "_blank" })
      : null;

    holder.replaceChildren(page({},
      pageHeader({
        title: isNew ? "Add product" : product.name,
        back: { href: "/admin/products", label: "Products" },
        badges: isNew ? [] : [productStatusBadge(product)],
        secondary: [viewLink],
      }),
      layout(
        h("div", { class: "stack stack--md" },
          card({},
            h("div", { class: "stack stack--md" },
              field({ label: "Title", control: name }),
              field({ label: "Description", control: description, help: "The words under the price on the product page." }),
              field({ label: "Short description", control: blurb, optional: true, help: "One line, used when there's no room for the full description." }))),
          mediaCard(),
          card({ title: "Pricing" },
            h("div", { class: "stack stack--md" },
              h("div", { class: "grid-2 grid-2--tight" },
                field({ label: "Price", control: price.wrap }),
                field({ label: "Compare-at price", control: compare.wrap, optional: true, help: "The old price, shown struck through during a sale." })),
              h("div", { class: "grid-2 grid-2--tight" },
                field({ label: "Cost per item", control: cost.wrap, optional: true, help: "Only you see this." }),
                margin))),
          card({ title: "Inventory" },
            h("div", { class: "stack stack--md" }, track.el, qtyBlock,
              field({ label: "SKU (stock keeping unit)", control: sku, optional: true }))),
          specsCard(),
          card({ title: "Search engine listing" },
            h("div", { class: "stack stack--md" },
              preview,
              field({ label: "Page title", control: seoTitle, optional: true, help: "Up to 160 characters. Leave empty to use the product title." }),
              field({ label: "Meta description", control: seoDescription, optional: true, help: "Leave empty to use the short description." }),
              field({ label: "URL handle", control: handle,
                help: isNew ? "Set once. Carts and links use it, so it can't change after the product is created."
                  : "Fixed: carts and links already use it. To use a different handle, create a new product." })))),
        h("div", { class: "stack stack--md" },
          card({ title: "Status" }, field({ label: "Status", control: status, labelHidden: true,
            help: f.status === "active" ? "Shown on the website." : f.status === "draft" ? "Hidden from the website while you work on it." : "Hidden from the website and from your active list." })),
          card({ title: "Product organization" },
            h("div", { class: "stack stack--md" },
              field({ label: "Category", control: category }),
              field({ label: "Badge", control: badgeInput, optional: true, help: "A small label on the photo, like New or Last One. Sold out pieces always say Sold Out." }),
              badgeList,
              field({ label: "Tags", control: tags, optional: true, help: "Separate with commas. Used for searching in the admin." }),
              field({ label: "Display order", control: position, help: "Lower numbers come first. The first four of each category fill the home page shelf." }))))),
      !isNew && h("div", { class: "page-foot" }, button("Delete product", { variant: "critical", onClick: () => remove(product) }),
        button("Save", { variant: "primary", onClick: save })),
      isNew && h("div", { class: "page-foot" }, button("Cancel", { href: "/admin/products" }), button("Save product", { variant: "primary", onClick: save }))));

    if (isNew) name.focus();
  }

  draw();
  const off = subscribe((topics) => {
    if (!topics.has("products") && !topics.has("costs")) return;
    if (!f) return draw(); // first data
    if (!isNew && !state.productsById.has(id)) {
      deletedElsewhere = true;
      return draw();
    }
    /* Someone else changed this product: take their version if nothing here
       is unsaved, otherwise leave the form alone. */
    if (!isNew && !dirty() && !uploading) {
      const fresh = formFrom(state.productsById.get(id), state.costs.get(id));
      if (signature(fresh) !== initial) {
        f = fresh;
        savedForm = JSON.parse(JSON.stringify(f));
        initial = signature(f);
        draw();
      }
    }
  });

  return () => {
    off();
    saveBar.hide();
    setLeaveGuard(null);
  };
}
