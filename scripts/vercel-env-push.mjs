// Pushes the runtime keys from .env.local to the linked Vercel project (production + preview) WITHOUT printing
// their values. Needs the Vercel CLI logged in and the folder linked:  npx vercel login  →  npx vercel link
// Usage: node scripts/vercel-env-push.mjs              (all runtime keys)
//        node scripts/vercel-env-push.mjs UPSTOX_ACCESS_TOKEN   (only the daily OAuth token, after upstox-login.mjs)
// UPSTOX_API_KEY / UPSTOX_API_SECRET / UPSTOX_REDIRECT_URI are NOT pushed: only the local login script uses them.
import { spawnSync } from 'node:child_process';
import { loadEnv, mask } from './_env.mjs';

const RUNTIME_KEYS = [
  'UPSTOX_ANALYTICS_TOKEN', 'UPSTOX_ACCESS_TOKEN', 'UPSTOX_SANDBOX_TOKEN', 'UPSTOX_SANDBOX_BASE',
  'ALPACA_KEY_ID', 'ALPACA_SECRET_KEY', 'ALPACA_PAPER_BASE', 'ALPACA_DATA_BASE', 'US_SYMBOL',
  'ENABLE_SANDBOX_ORDER', 'DEMO_ACCOUNT_LABEL', 'FX_KEY_OVERRIDE',
];
const env = loadEnv();
const only = process.argv.slice(2);
const keys = only.length ? only : RUNTIME_KEYS;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (args, input) => spawnSync(npx, ['--yes', 'vercel', ...args], { input, encoding: 'utf8', shell: process.platform === 'win32' });

for (const key of keys) {
  if (!RUNTIME_KEYS.includes(key)) { console.log(`skip ${key} (not a runtime key)`); continue; }
  const value = (env[key] ?? '').replace(/\s+#.*$/, '').trim();
  if (!value) { console.log(`skip ${key} (empty in .env.local)`); continue; }
  for (const target of ['production', 'preview']) {
    run(['env', 'rm', key, target, '--yes']); // ignore "not found"
    const r = run(['env', 'add', key, target], value);
    console.log(`${r.status === 0 ? 'OK  ' : 'FAIL'} ${key.padEnd(24)} → ${target.padEnd(10)} ${mask(value)}${r.status === 0 ? '' : '  ' + (r.stderr || r.stdout).trim().split('\n').pop()}`);
  }
}
console.log('\nRedeploy for the new values to take effect:  npx vercel deploy --prod');
