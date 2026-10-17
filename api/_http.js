/* ==========================================================================
   HOUSE OF ALDEN — small HTTP helpers shared by the /api functions
   Files whose names start with "_" are not deployed as endpoints by Vercel.
   ========================================================================== */

import { auth, db } from "./_firebase.js";

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

export function fail(res, err, label) {
  if (err instanceof HttpError) {
    return send(res, err.status, { ok: false, error: err.message, ...err.extra });
  }
  console.error(`[${label}]`, err);
  return send(res, 500, { ok: false, error: "Something went wrong on our side. Please try again." });
}

/* These endpoints serve this site's own pages and nothing else. A browser
   always sends Origin on a POST, PATCH or DELETE, so a request without one,
   or from another site, is refused. (A script outside a browser can forge the
   header — this stops cross-site use, the rate limit and validation do the rest.)
   Extra origins, e.g. a preview domain, can be listed in ALLOWED_ORIGINS. */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !origin) return false;

  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }

  const allowed = new Set();
  [req.headers["x-forwarded-host"], req.headers.host].forEach((h) => {
    if (typeof h === "string" && h) allowed.add(h.split(",")[0].trim());
  });
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((o) => {
      try {
        allowed.add(new URL(o).host);
      } catch {
        /* ignore a malformed entry rather than fail every request */
      }
    });
  return allowed.has(host);
}

/* Vercel sets x-real-ip / x-forwarded-for from the connecting client and
   overwrites anything the client sent. */
export function clientIp(req) {
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

/* Reads a JSON body of at most `limit` bytes. On Vercel the body is usually
   parsed already; elsewhere (tests) it is read from the stream. */
export async function readJson(req, limit = 32 * 1024) {
  const type = String(req.headers["content-type"] || "");
  if (!/^application\/json\b/i.test(type)) throw new HttpError(415, "Send JSON.");

  const declared = Number(req.headers["content-length"] || 0);
  if (declared > limit) throw new HttpError(413, "That request is too large.");

  let body;
  try {
    body = req.body;
  } catch {
    throw new HttpError(400, "That request could not be read.");
  }

  if (body === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new HttpError(413, "That request is too large.");
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks).toString("utf8");
  }
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (body.length > limit) throw new HttpError(413, "That request is too large.");
    try {
      body = JSON.parse(body || "null");
    } catch {
      throw new HttpError(400, "That request could not be read.");
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "That request could not be read.");
  }
  return body;
}

/* Strips control characters (keeping tab and newline), trims, and caps length. */
export function clean(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

/* The caller must be signed in to /admin: a valid, unrevoked ID token carrying
   the admin claim, and a staff record that still exists. `owner: true` further
   limits the call to the store owner. */
export async function requireAdmin(req, { owner = false } = {}) {
  const header = String(req.headers.authorization || "");
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(header);
  if (!match) throw new HttpError(401, "Please sign in again.");

  let token;
  try {
    token = await auth().verifyIdToken(match[1], true);
  } catch {
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  }
  if (token.admin !== true) throw new HttpError(403, "This account does not have admin access.");

  const staff = await db().doc(`staff/${token.uid}`).get();
  if (!staff.exists) throw new HttpError(403, "This account does not have admin access.");
  if (owner && token.role !== "owner") {
    throw new HttpError(403, "Only the store owner can manage staff accounts.");
  }
  return token;
}
