/* ==========================================================================
   HOUSE OF ALDEN — deploy build (Vercel runs this; you never need to)
   --------------------------------------------------------------------------
   The shop has no build step: the HTML, CSS and JS are served exactly as they
   are written. This script only COPIES the public files into public/, which
   is what Vercel serves.

   Why bother: the project folder now also holds server code, the Firebase
   rules, notes and node_modules. Serving the whole folder would publish all
   of that at your web address. Copying an explicit list means only the shop
   and the admin ever go online — a file nobody added here can't leak.
   ========================================================================== */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public");

const DIRS = ["admin", "css", "images", "js"];
const FILES = readdirSync(root).filter((f) => f.endsWith(".html") || f === "robots.txt" || f === "sitemap.xml");

/* Finder litter and editor backups never go online. */
const keep = (src) => !/(^|[\\/])(\.DS_Store|Thumbs\.db|.*~)$/.test(src);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const dir of DIRS) {
  const from = join(root, dir);
  if (!existsSync(from)) throw new Error(`build: missing folder ${dir}/`);
  cpSync(from, join(out, dir), { recursive: true, filter: keep });
}
for (const file of FILES) cpSync(join(root, file), join(out, file));

console.log(`build: copied ${FILES.length} top-level files and ${DIRS.join("/, ")}/ into public/`);
