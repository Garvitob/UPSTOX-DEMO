// Token-safety check: searches build output (and optionally any folder) for the literal secret values in .env.local.
// Prints only counts and file names — never a value. Exit code 1 if any secret is found.
// Usage: node scripts/scan-secrets.mjs [dir ...]   (default: .next/static and .next-verify/static)
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './_env.mjs';
const env = loadEnv();
const SECRET_KEYS = ['UPSTOX_API_KEY', 'UPSTOX_API_SECRET', 'UPSTOX_ANALYTICS_TOKEN', 'UPSTOX_ACCESS_TOKEN', 'UPSTOX_SANDBOX_TOKEN', 'ALPACA_KEY_ID', 'ALPACA_SECRET_KEY'];
const secrets = SECRET_KEYS.map(k => [k, (env[k] || '').trim()]).filter(([, v]) => v.length >= 8);
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['.next/static', '.next-verify/static'].filter(d => fs.existsSync(d));
let files = 0, hits = 0;
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else check(p); } };
function check(p) {
  files++;
  const text = fs.readFileSync(p, 'latin1');
  for (const [k, v] of secrets) if (text.includes(v)) { hits++; console.log(`FOUND ${k} in ${p}`); }
}
for (const d of dirs) walk(d);
console.log(`scanned ${files} file(s) in ${dirs.join(', ') || '(nothing)'} for ${secrets.length} secret value(s): ${hits} hit(s)`);
process.exit(hits ? 1 : 0);
