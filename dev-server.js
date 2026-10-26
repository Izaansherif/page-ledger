#!/usr/bin/env node
// ---------------------------------------------------------------------------
// dev-server.js  (Stage 1)
// Zero-dependency local dev server that hosts the static app AND runs the real
// Netlify Functions locally, so `node dev-server.js` behaves exactly like a
// Netlify deploy. Why: the Netlify CLI is a heavy install and this machine is
// low-spec (project AGENTS.md). The same function files run on Netlify later.
//
//   node dev-server.js            -> http://localhost:8888
//   PORT=9000 node dev-server.js  -> custom port
//   AI_MODE is taken from .env    -> demo/mock by default (no credits used)
// ---------------------------------------------------------------------------
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "./scripts/_lib/env.js";
loadEnv();

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8888);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

async function callExtractFunction(body) {
  const url = new URL("./netlify/functions/extract.js", `file://${ROOT.replace(/\\/g, "/")}/`);
  const mod = await import(url.href);
  const event = {
    httpMethod: "POST",
    headers: { "content-type": "application/json" },
    rawUrl: "http://localhost/.netlify/functions/extract",
    path: "/.netlify/functions/extract",
    body,
    isBase64Encoded: false,
  };
  return mod.handler(event);
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function serveStatic(req, res, pathname) {
  // `pathname` is already decoded (decodeURIComponent happened at the server).
  // Security: reject traversal BEFORE normalize (on Windows normalize collapses
  // leading ".." and would otherwise defeat a plain containment check),
  // reject dotfiles (.env, .git*), and double-check containment.
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const norm = path.normalize(pathname).replace(/^([/\\])+/, "");
  const segments = norm.split(/[\\/]+/);
  if (segments.includes("..") || pathname.split(/[\\/]+/).includes("..")) {
    return send(res, 403, { "Content-Type": "text/plain; charset=utf-8" }, "Forbidden");
  }
  if (segments.some((s) => s.startsWith("."))) {
    return send(res, 403, { "Content-Type": "text/plain; charset=utf-8" }, "Forbidden");
  }
  const abs = path.resolve(ROOT, norm);
  const rel = path.relative(ROOT, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return send(res, 403, { "Content-Type": "text/plain; charset=utf-8" }, "Forbidden");
  }
  fs.readFile(abs, (err, data) => {
    if (err) return send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
    const type = MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
    send(res, 200, { "Content-Type": type, "Cache-Control": "no-store" }, data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  let pathname;
  try {
    pathname = decodeURIComponent(u.pathname);
  } catch {
    return send(res, 400, { "Content-Type": "text/plain; charset=utf-8" }, "Bad request");
  }

  console.log(`${new Date().toISOString()} ${req.method} ${pathname}`);

  if (pathname === "/healthz") {
    const ai = await import(new URL("./netlify/functions/_lib/ai.js", `file://${ROOT.replace(/\\/g, "/")}/`));
    return send(res, 200, { "Content-Type": "application/json" }, JSON.stringify({ ok: true, aiMode: ai.AI_CONFIG.mode }));
  }

  if (pathname === "/.netlify/functions/extract") {
    if (req.method !== "POST") return send(res, 405, { "Content-Type": "application/json" }, '{"ok":false,"error":"Use POST"}');
    let raw = "";
    req.on("data", (c) => (raw += c.length > 12e6 ? "OVERFLOW" : String(c)));
    req.on("end", async () => {
      try {
        const out = await callExtractFunction(raw);
        send(res, out.statusCode, out.headers, out.body);
      } catch (err) {
        console.error("[dev-server] function error:", err);
        send(res, 500, { "Content-Type": "application/json" }, JSON.stringify({ ok: false, error: `Dev server error: ${err.message}` }));
      }
    });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, { "Content-Type": "text/plain" }, "Method not allowed");
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  const aiMode = fs.existsSync(path.join(ROOT, ".env"))
    ? (fs.readFileSync(path.join(ROOT, ".env"), "utf8").match(/AI_MODE\s*=\s*(\w+)/)?.[1] || "mock")
    : "mock";
  console.log(`\nPage Ledger dev server: http://localhost:${PORT}`);
  console.log(`AI_MODE: ${aiMode}  (mock = demo fixtures, zero credits; change in .env)`);
  console.log("Stop with Ctrl+C.\n");
});
