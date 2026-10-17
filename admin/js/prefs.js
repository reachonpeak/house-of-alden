/* ==========================================================================
   HOUSE OF ALDEN ADMIN — preferences for this browser only
   (new-order sound, desktop notifications). Nothing here is shared or sent.
   ========================================================================== */

const KEY = "hoa.admin.prefs";

export const prefs = { sound: true, desktop: false };

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  if (saved && typeof saved === "object") {
    if (typeof saved.sound === "boolean") prefs.sound = saved.sound;
    if (typeof saved.desktop === "boolean") prefs.desktop = saved.desktop;
  }
} catch {
  /* private mode or a damaged value: keep the defaults */
}

export function savePrefs(patch) {
  Object.assign(prefs, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* fine: the choice still holds until the tab closes */
  }
}
