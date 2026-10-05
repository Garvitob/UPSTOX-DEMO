// Minimal .env.local loader (no dependencies). Values already in process.env win.
import fs from 'node:fs';
import path from 'node:path';
export function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
      const line = raw.replace(/\s+#.*$/, '').trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
  }
  return process.env;
}
export function setEnv(key, value) {
  const p = path.resolve(process.cwd(), '.env.local');
  let txt = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const re = new RegExp(`^${key}=.*$`, 'm');
  txt = re.test(txt) ? txt.replace(re, `${key}=${value}`) : txt + (txt.endsWith('\n') || !txt ? '' : '\n') + `${key}=${value}\n`;
  fs.writeFileSync(p, txt);
}
export const mask = v => (v ? v.slice(0, 4) + '…' + v.slice(-4) + ` (${v.length} chars)` : '— missing');
export async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: r.status, json };
}
