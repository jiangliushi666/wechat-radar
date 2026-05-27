import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { syncChangedSessions } from '@/lib/stats-aggregator';
import { loadSessionsSafe, sessionNameMap } from '@/lib/session-source';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const interval = Math.max(Number(url.searchParams.get('interval') ?? 5000), 2000);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

      let timer: NodeJS.Timeout | null = null;
      let stopped = false;
      let lastSentTs = Math.floor(Date.now() / 1000) - 300;
      const sentKeys = new Set<string>();
      const sentQueue: string[] = [];

      const tick = async () => {
        if (stopped) return;
        try {
          const sessionLoad = await loadSessionsSafe(500);
          const sessions = sessionLoad.sessions;
          const names = sessionNameMap(sessions);
          const today = localToday();
          const freshness = await syncChangedSessions({
            sessions,
            since: today,
            until: today,
            maxTargets: 60,
            concurrency: 2,
          }).catch(() => null);
          const msgs = recentMessagesSince(Math.max(0, lastSentTs - 1), 200)
            .filter((m) => {
              const key = messageKey(m);
              if (sentKeys.has(key)) return false;
              rememberSent(sentKeys, sentQueue, key);
              return true;
            })
            .slice(0, 50);
          lastSentTs = msgs.reduce((max, m) => Math.max(max, m.timestamp), lastSentTs);
          const enriched = msgs.map((m) => ({
            ...m,
            username: m.chatroom_id,
            chat_name: names.get(m.chatroom_id) ?? m.chatroom_id,
          }));
          send({
            type: 'tick',
            count: msgs.length,
            items: enriched,
            ts: Date.now(),
            freshness,
            session_source: {
              source: sessionLoad.source,
              partial: sessionLoad.partial,
              groups: sessionLoad.groupCount,
              live_groups: sessionLoad.liveGroupCount,
            },
          });
        } catch (e) {
          send({ type: 'error', error: e instanceof Error ? e.message : 'unknown' });
        }
      };

      // Send initial heartbeat so the client knows the stream is open
      send({ type: 'open', interval });
      await tick();
      timer = setInterval(tick, interval);

      req.signal.addEventListener('abort', () => {
        stopped = true;
        if (timer) clearInterval(timer);
        controller.close();
      });
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

function recentMessagesSince(timestamp: number, limit: number) {
  return db()
    .prepare(
      `SELECT chatroom_id, local_id, sender, content, time, timestamp, type
       FROM messages
       WHERE timestamp > ?
       ORDER BY timestamp DESC, local_id DESC
       LIMIT ?`,
    )
    .all(timestamp, limit) as Array<{
    chatroom_id: string;
    local_id: number;
    sender: string;
    content: string;
    time: string;
    timestamp: number;
    type: string;
  }>;
}

function messageKey(m: { chatroom_id: string; local_id: number; timestamp: number }) {
  return `${m.chatroom_id}:${m.local_id}:${m.timestamp}`;
}

function rememberSent(keys: Set<string>, queue: string[], key: string) {
  keys.add(key);
  queue.push(key);
  while (queue.length > 1000) {
    const old = queue.shift();
    if (old) keys.delete(old);
  }
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
