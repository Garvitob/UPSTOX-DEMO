// Stop gate: keeps the agent working until PROGRESS.md has no open tasks (or they are blocked on a human).
// Blocks at most MAX_BLOCKS times without visible progress, so it can never loop forever.
import fs from 'node:fs';
import crypto from 'node:crypto';

const MAX_BLOCKS = 40;
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
let input = ''; try { input = fs.readFileSync(0, 'utf8'); } catch {}
const progress = read('PROGRESS.md');
const done = fs.existsSync('.build-complete');
if (fs.existsSync('.setup-only')) process.exit(0);
const open = progress.split('\n').filter(l => /^\s*-\s*\[( |~)\]/.test(l) && !/\(blocked:human\)/i.test(l));

if (done || open.length === 0) process.exit(0);

const counterFile = '.claude/.stop-gate.json';
const hash = crypto.createHash('sha1').update(progress).digest('hex');
let state = { hash: '', blocks: 0 };
try { state = JSON.parse(read(counterFile) || '{}'); } catch {}
if (state.hash !== hash) state = { hash, blocks: 0 };
state.blocks += 1;
fs.writeFileSync(counterFile, JSON.stringify(state));

if (state.blocks > MAX_BLOCKS) process.exit(0); // no progress for a long time: let it stop, human will look

const next = open.slice(0, 5).map(l => l.trim()).join('\n');
const reason = [
  `Build is not complete: ${open.length} open task(s) in PROGRESS.md and no .build-complete file.`,
  `Continue with the next open task. If a task truly needs the human, write the exact steps to HUMAN_TODO.md,`,
  `mark that task "(blocked:human)" in PROGRESS.md, and move on to the next unblocked task.`,
  `Open tasks:`, next,
  `Re-read CLAUDE.md and docs/PHASES.md if unsure. Do not stop until everything is [x] or (blocked:human),`,
  `then write BUILD_REPORT.md and create .build-complete.`
].join('\n');
process.stdout.write(JSON.stringify({ decision: 'block', reason }));
