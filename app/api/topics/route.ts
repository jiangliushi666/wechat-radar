import { NextRequest, NextResponse } from 'next/server';
import { buildTopicsForDate, listTopics } from '@/lib/topics';
import { todayStr } from '@/lib/range';
import { syncChangedSessions } from '@/lib/stats-aggregator';
import { loadSessionsSafe } from '@/lib/session-source';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date') ?? todayStr();
  const topics = listTopics(date);
  return NextResponse.json({ ok: true, date, topics });
}

type BuildBody = {
  date?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as BuildBody;
  const date = body.date || todayStr();

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const heartbeat = setInterval(() => {
        send({ type: 'heartbeat', at: Date.now() });
      }, 20_000);

      send({ type: 'start', date });
      try {
        send({ type: 'sync', message: '同步当天新消息…' });
        const sessionLoad = await loadSessionsSafe(500);
        const freshness = await syncChangedSessions({
          sessions: sessionLoad.sessions,
          since: date,
          until: date,
        });
        send({
          type: 'sync_done',
          inserted: freshness.inserted,
          failed: freshness.failed,
          session_source: sessionLoad.source,
        });
        const result = await buildTopicsForDate(date, (p) => send(p));
        send({ type: 'finished', ...result });
      } catch (e) {
        send({
          type: 'error',
          error: e instanceof Error ? e.message : 'unknown',
        });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
