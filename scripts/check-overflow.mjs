// Usage: node scripts/check-overflow.mjs [--shots] [base-url]   (default app http://127.0.0.1:3000)
// --shots also saves classic-scrollbar evidence to artifacts/screenshots/classic-*.png.
// Launch Chromium WITHOUT --hide-scrollbars (classic 15px scrollbars, like Windows desktop) and measure horizontal
// overflow in the order body across the states the qa-visual BLOCK listed.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
// Finds a playwright-core install (the Playwright MCP's npx cache) unless PLAYWRIGHT_CORE points at its package.json.
function findPlaywrightCore() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const p = path.join(root, d, 'node_modules', 'playwright-core', 'package.json');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('playwright-core not found: run npx @playwright/mcp once, or set PLAYWRIGHT_CORE');
}
const require = createRequire(process.env.PLAYWRIGHT_CORE || findPlaywrightCore());
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1030 } });
const SHOTS = process.argv.includes('--shots');
const BASE = process.argv.slice(2).find(a => a.startsWith('http')) ?? 'http://127.0.0.1:3000';
const shot = async name => { if (SHOTS) await page.screenshot({ path: `artifacts/screenshots/classic-${name}.png` }); };
await page.goto(BASE);
// Upstox flow: hover a holdings row → Buy → "Exchange to Buy From" → NSE → the Place Order panel opens
const openTicket = async (sym, side = 'b') => {
  const row = page.locator(`tbody tr[data-sym="${sym}"]`);
  await row.waitFor();
  await row.hover();
  await row.locator(`.row-act .${side}`).click();
  if (await page.locator('.xm').count()) await page.locator('.xm-opt[data-ex="NSE"]').click();
};
await openTicket('PAYTM');
await page.getByText('After this order').first().waitFor();
await page.waitForTimeout(1500);
const measure = async label => {
  const m = await page.evaluate(() => { const b = document.querySelector('.o-body'); const o = document.querySelector('.order'); return { body: [b.scrollWidth, b.clientWidth], order: [o.scrollWidth, o.clientWidth], qp: [...document.querySelectorAll('.qp .f')].map(f => Math.round(f.getBoundingClientRect().width)) }; });
  console.log(`${label.padEnd(26)} o-body ${m.body[0]} vs ${m.body[1]} ${m.body[0] > m.body[1] ? 'OVERFLOW' : 'ok'} · order ${m.order[0]} vs ${m.order[1]} · qp fields ${m.qp.join('/')}`);
};
await measure('PAYTM collapsed');
await page.locator('.amc .head').click(); await page.waitForTimeout(300);
await measure('PAYTM expanded');
await shot('regular-expanded');
await page.locator('.qp .lbl button').click(); await page.locator('input[aria-label="Limit price"]').fill('1500'); await page.waitForTimeout(300);
await measure('PAYTM limit 1500');
await page.locator('.o-tabs button[data-tab="mtf"]').click(); await page.waitForTimeout(300);
if (!(await page.locator('.amc.open').count())) await page.locator('.amc .head').click();
await measure('PAYTM MTF expanded');
await shot('mtf-expanded');
await page.locator('.o-tabs button[data-tab="gtt"]').click(); await page.waitForTimeout(500);
if (!(await page.locator('.amc.open').count())) await page.locator('.amc .head').click();
// text width measured with the input's own font (scrollWidth vs clientWidth differs by 1px on fractional flex widths)
const trig = await page.evaluate(() => {
  const i = document.querySelector('input[aria-label="Trigger price"]');
  const cs = getComputedStyle(i);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const room = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  return [i.value, Math.ceil(ctx.measureText(i.value).width), Math.floor(room)];
});
await measure('PAYTM GTT expanded');
await shot('gtt-default-trigger');
console.log(`GTT default trigger "${trig[0]}" text ${trig[1]}px in ${trig[2]}px ${trig[1] > trig[2] ? 'CLIPPED' : 'fits'}`);
await openTicket('TMCV'); await page.waitForTimeout(1200);
await page.locator('.o-tabs button[data-tab="gtt"]').click(); await page.waitForTimeout(500);
if (!(await page.locator('.amc.open').count())) await page.locator('.amc .head').click();
await measure('TMCV expanded (GTT tab)');
await page.locator('.o-tabs button[data-tab="regular"]').click(); await page.waitForTimeout(300);
await measure('TMCV expanded (regular)');
await shot('tmcv-expanded');
await page.screenshot({ path: '.playwright-mcp/classic-scrollbar-check.png' });

// US tab (the FX chip is the longest pill) and the phone width, where the panel is the whole page.
const chipsFit = () => page.evaluate(() => {
  const box = document.querySelector('.chips');
  const over = [...document.querySelectorAll('.chip')].filter(c => c.getBoundingClientRect().right > (box?.getBoundingClientRect().right ?? Infinity) + 0.5).length;
  return { chips: [box?.scrollWidth ?? 0, box?.clientWidth ?? 0], over, page: [document.documentElement.scrollWidth, window.innerWidth] };
});
const report = (label, m) => console.log(`${label.padEnd(26)} chips ${m.chips[0]} vs ${m.chips[1]} · chips past the edge ${m.over} · page ${m.page[0]} vs ${m.page[1]} ${m.chips[0] > m.chips[1] || m.over || m.page[0] > m.page[1] ? 'OVERFLOW' : 'ok'}`);
await page.locator('.htabs .tab', { hasText: 'US Stocks' }).click(); await page.waitForTimeout(2500);
await page.locator('tbody tr.msg, tbody tr').first().hover();
await page.locator('tbody .row-act .b').first().click(); await page.waitForTimeout(2500);
await measure('US tab');
report('US tab chips (desktop)', await chipsFit());
await shot('us-tab');
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
report('US tab chips (390 phone)', await chipsFit());
await shot('us-phone');
await page.locator('select[aria-label="Stock"]').selectOption('IN:PAYTM'); await page.waitForTimeout(1500); // phone: the stock selector opens that stock's ticket
await page.locator('section.order').waitFor();
report('India (390 phone)', await chipsFit());
await browser.close();
