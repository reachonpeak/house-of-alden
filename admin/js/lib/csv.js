/* ==========================================================================
   HOUSE OF ALDEN ADMIN — CSV export
   --------------------------------------------------------------------------
   Opens straight in Excel or Google Sheets (UTF-8 with BOM, so ₹ survives).

   Spreadsheet formula injection is defused: a cell that starts with = + - @
   (a customer could type "=HYPERLINK(…)" as their name at checkout) is
   prefixed with an apostrophe, so it is shown as text and never run.
   ========================================================================== */

function cell(value) {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

export function downloadCsv(filename, rows) {
  const blob = new Blob(["﻿", toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const stamp = () => new Date().toISOString().slice(0, 10);
