// Daily OAuth login: prints the Upstox login URL, exchanges the code, writes UPSTOX_ACCESS_TOKEN to .env.local.
import readline from 'node:readline/promises';
import { loadEnv, setEnv } from './_env.mjs';
const env = loadEnv();
for (const k of ['UPSTOX_API_KEY', 'UPSTOX_API_SECRET', 'UPSTOX_REDIRECT_URI']) if (!env[k]) { console.error(`Missing ${k} in .env.local`); process.exit(1); }
const url = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${encodeURIComponent(env.UPSTOX_API_KEY)}&redirect_uri=${encodeURIComponent(env.UPSTOX_REDIRECT_URI)}`;
console.log('\n1) Open this URL in a browser and log in (mobile → OTP → PIN):\n\n' + url + '\n');
console.log('2) After login the browser lands on ' + env.UPSTOX_REDIRECT_URI + '?code=XXXX (the page may say "can\'t be reached" — that is fine).');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const code = (await rl.question('3) Paste the code value here: ')).trim(); rl.close();
const body = new URLSearchParams({ code, client_id: env.UPSTOX_API_KEY, client_secret: env.UPSTOX_API_SECRET, redirect_uri: env.UPSTOX_REDIRECT_URI, grant_type: 'authorization_code' });
const r = await fetch('https://api.upstox.com/v2/login/authorization/token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body });
const j = await r.json();
if (!j.access_token) { console.error('Token exchange failed:', JSON.stringify(j)); process.exit(1); }
setEnv('UPSTOX_ACCESS_TOKEN', j.access_token);
console.log(`\nSaved UPSTOX_ACCESS_TOKEN for user ${j.user_name || j.user_id || ''}. Valid until 3:30 AM IST tomorrow.`);
console.log('Next: node scripts/fetch-upstox-cache.mjs');
