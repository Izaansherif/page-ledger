// scripts/_lib/env.js - tiny .env loader (no dotenv dependency: zero-dep project)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function loadEnv() {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
  if (!fs.existsSync(file)) return file;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    } else {
      const ci = v.indexOf(" #");
      if (ci !== -1) v = v.slice(0, ci).trim(); // strip trailing comment
    }
    if (!(m[1] in process.env) || process.env[m[1]] === "") process.env[m[1]] = v;
  }
  return file;
}
