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

async function callFunction(name, body, reqHeaders = {}) {
  const url = new URL(`./netlify/functions/${name}.js`, `file://${ROOT.replace(/\\/g, "/")}/`);
  const mod = await import(url.href);
  const event = {
    httpMethod: "POST",
    headers: { "content-type": "application/json", ...reqHeaders },
    rawUrl: `http://localhost/.netlify/functions/${name}`,
    path: `/.netlify/functions/${name}`,
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

const FUNCTIONS = new Set(["extract", "config", "transcribe", "ask"]);

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

  // DEV-ONLY: the sample-page renderer (scripts/render-samples.html) saves its
  // generated PNGs + text-position boxes here. Hard-gated by env var, and
  // Netlify never runs dev-server - on production this route does not exist.
  if (req.method === "POST" && pathname === "/__save-blob") {
    if (process.env.FIXTURE_WRITE !== "1") {
      return send(res, 403, { "Content-Type": "application/json" }, JSON.stringify({ ok: false, error: "Fixture writing is off. Run with FIXTURE_WRITE=1." }));
    }
    let raw = "";
    req.on("data", (c) => (raw += c.length > 24e6 ? "OVERFLOW" : String(c)));
    req.on("end", () => {
      if (raw === "OVERFLOW") return send(res, 413, { "Content-Type": "application/json" }, JSON.stringify({ ok: false, error: "Too large" }));
      try {
        const { name, dataBase64 } = JSON.parse(raw);
        // only allow safe sub-paths inside fixtures/ (segments validated one by
        // one -> separators never appear inside a segment)
        const segs = String(name || "").replace(/\\/g, "/").split("/").filter((s) => s.length);
        const dirs = segs.slice(0, -1);
        const last = segs[segs.length - 1] || "";
        const badDir = dirs.some((s) => s === ".." || !/^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/.test(s));
        const badFile = !/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?\.(jpg|jpeg|png|json)$/.test(last);
        if (!segs.length || badDir || badFile) {
          return send(res, 400, { "Content-Type": "application/json" }, JSON.stringify({ ok: false, error: `Bad name: ${name}` }));
        }
        const abs = path.join(ROOT, "fixtures", ...segs);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, Buffer.from(dataBase64, "base64"));
        console.log(`[dev-server] saved fixture: fixtures/${segs.join("/")}`);
        send(res, 200, { "Content-Type": "application/json" }, JSON.stringify({ ok: true, name: segs.join("/") }));
      } catch (err) {
        send(res, 500, { "Content-Type": "application/json" }, JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // Generic Netlify-function routing (extract, config, ...) for POST JSON.
  const fnMatch = pathname.match(/^\/\.netlify\/functions\/([a-zA-Z0-9_-]+)$/);
  if (fnMatch) {
    const name = fnMatch[1];
    if (!FUNCTIONS.has(name)) return send(res, 404, { "Content-Type": "application/json" }, '{"ok":false,"error":"No such function"}');
    if (req.method !== "POST") return send(res, 405, { "Content-Type": "application/json" }, '{"ok":false,"error":"Use POST"}');
    let raw = "";
    req.on("data", (c) => (raw += c.length > 12e6 ? "OVERFLOW" : String(c)));
    req.on("end", async () => {
      try {
        const out = await callFunction(name, raw === "OVERFLOW" ? "" : raw, req.headers);
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

server.on("error", (err) => {
  if (err?.code === "EADDRINUSE") {
    console.log(`\nPage Ledger is ALREADY RUNNING at http://localhost:${PORT}`);
    console.log("(Your browser tab was opened there. This extra copy can close.)\n");
    process.exit(0);
  }
  console.error("Server error:", err);
  process.exit(1);
});
