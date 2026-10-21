/*
 * Rail-IQ access control (Vercel Routing Middleware)
 * --------------------------------------------------
 * Runs on Vercel's servers before any file is sent, so every page, script and
 * simulator file needs a valid username and password (HTTP Basic authentication).
 *
 * Users are NOT stored in this repository. Set them in Vercel:
 *   Project → Settings → Environment Variables → RAILIQ_USERS
 *   value: user1:password1,user2:password2,...
 * then redeploy. If RAILIQ_USERS is missing, the site stays locked for everyone.
 */
export const config = { matcher: "/:path*" };

const REALM = "Rail-IQ";

function users() {
  return String(process.env.RAILIQ_USERS || "")
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => { const i = s.indexOf(":"); return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : null; })
    .filter(Boolean);
}

// compare without leaking where the strings differ
function same(a, b) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

function deny(message) {
  return new Response(message, {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export default function middleware(request) {
  const list = users();
  if (!list.length) return deny("Rail-IQ: access is not configured yet (RAILIQ_USERS is not set).");

  const header = request.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try { decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), c => c.charCodeAt(0))); } catch (e) { decoded = ""; }
    const i = decoded.indexOf(":");
    if (i > 0) {
      const name = decoded.slice(0, i), pass = decoded.slice(i + 1);
      let ok = false;
      for (const [u, p] of list) ok = (same(name, u) & same(pass, p)) === 1 || ok;
      if (ok) return; // signed in: continue to the requested file
    }
  }
  return deny("Rail-IQ: sign in required.");
}
