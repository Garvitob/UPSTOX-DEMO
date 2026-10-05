import { EQUITY_KEY, fxKey, knownMarketKeys } from '@/server/instruments';
import { feed } from '@/server/upstoxFeed';
import type { StreamEvent } from '@/lib/types';

// GET /api/stream?keys=a,b → Server-Sent Events of {type:'tick'|'status'|'market'} from the server's Upstox
// WebSocket client. The browser never talks to Upstox directly and never sees a token.
// On serverless hosts (Vercel, 300 s max) the response ends cleanly before the limit; EventSource reconnects
// after `retry`, and the client polls /api/ltp every 2 s if the feed stays down for > 10 s.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_STREAM_MS = 280_000;
const HEARTBEAT_MS = 15_000;

export async function GET(req: Request) {
  const requested = [...new Set((new URL(req.url).searchParams.get('keys') ?? '').split(',').map(k => k.trim()).filter(Boolean))];
  const known = knownMarketKeys();
  const fx = fxKey();
  const keys = requested.filter(k => known.has(k) || EQUITY_KEY.test(k) || k === fx).slice(0, 100); // the page asks for ~25
  const wanted = new Set(keys);
  const enc = new TextEncoder();

  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          close();
        }
      };
      const send = (e: StreamEvent) => write(`data: ${JSON.stringify(e)}\n\n`);

      write('retry: 2000\n\n');
      const st = feed.status();
      send({ type: 'status', feed: st.feed, since: st.since, detail: st.detail });
      for (const k of keys) {
        const t = feed.tick(k);
        if (t) send({ type: 'tick', key: k, ltp: t.ltp, cp: t.cp, ltt: t.ltt });
      }
      for (const seg of ['NSE_EQ', 'BSE_EQ']) {
        const st = feed.segment(seg);
        if (st) send({ type: 'market', segment: seg, status: st });
      }

      const off = feed.on(e => {
        if (e.type !== 'tick' || wanted.has(e.key)) send(e);
      });
      feed.subscribe(keys);
      const hb = setInterval(() => write(`: heartbeat ${Date.now()}\n\n`), HEARTBEAT_MS);
      const end = setTimeout(() => close(), MAX_STREAM_MS);

      function close() {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        clearTimeout(end);
        off();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      }
      cleanup = close;
      req.signal.addEventListener('abort', close);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
