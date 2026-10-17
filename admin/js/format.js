/* ==========================================================================
   HOUSE OF ALDEN ADMIN — formatting (money, dates, phones, handles)
   Indian conventions throughout: ₹1,25,000 and 1.2L, day before month.
   ========================================================================== */

const LOCALE = "en-IN";

const inr = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const compactNumber = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 });
const plainNumber = new Intl.NumberFormat(LOCALE);
const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });
const monthYear = new Intl.DateTimeFormat(LOCALE, { month: "short", year: "numeric" });
const clock = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat(LOCALE, { weekday: "long" });

export const money = (n) => inr.format(Number(n) || 0);
export const compactMoney = (n) => `₹${compactNumber.format(Number(n) || 0)}`;
export const number = (n) => plainNumber.format(Number(n) || 0);
export const plural = (n, one, many = `${one}s`) => `${number(n)} ${n === 1 ? one : many}`;

/* Firestore Timestamp, Date, ISO string or {seconds} → Date (or null). */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const DAY = 86400000;

/* "17 Oct 2026 at 2:31 pm" */
export function dateTime(value) {
  const d = toDate(value);
  return d ? `${dayMonthYear.format(d)} at ${clock.format(d)}` : "";
}

export function date(value) {
  const d = toDate(value);
  return d ? dayMonthYear.format(d) : "";
}

export const shortDate = (d) => dayMonth.format(d);
export const monthLabel = (d) => monthYear.format(d);
export const time = (value) => {
  const d = toDate(value);
  return d ? clock.format(d) : "";
};

/* "Today at 2:31 pm", "Yesterday at 9:04 am", "Monday at …", "12 Oct at …",
   "12 Oct 2025" — how Shopify dates its order list. */
export function relative(value, now = new Date()) {
  const d = toDate(value);
  if (!d) return "";
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (days === 0) return `Today at ${clock.format(d)}`;
  if (days === 1) return `Yesterday at ${clock.format(d)}`;
  if (days > 1 && days < 7) return `${weekday.format(d)} at ${clock.format(d)}`;
  if (d.getFullYear() === now.getFullYear()) return `${dayMonth.format(d)} at ${clock.format(d)}`;
  return dayMonthYear.format(d);
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/* --- Phones ---------------------------------------------------------------- */

/* Same rule as customerKey() in api/orders.js: a ten-digit number is an Indian
   mobile written without its country code. Returns digits or "". */
export function phoneDigits(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : "";
}

/* 917087511282 → "+91 70875 11282" */
export function prettyPhone(value) {
  const d = phoneDigits(value);
  if (!d) return String(value || "");
  if (d.startsWith("91") && d.length === 12) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return `+${d}`;
}

export const whatsappLink = (phone, text = "") => {
  const d = phoneDigits(phone);
  return d ? `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}` : "";
};

/* --- Handles ---------------------------------------------------------------- */

/* "The Alden Pearl Drop!" → "the-alden-pearl-drop" (matches the id rule in
   firestore.rules: lowercase letters, digits and dashes, 63 at most). */
export function slugify(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

export const HANDLE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const initials = (name) =>
  String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";
