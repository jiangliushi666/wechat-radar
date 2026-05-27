import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { todayStr } from '@/lib/range';
import { loadSessionsSafe, sessionNameMap } from '@/lib/session-source';
import { syncChangedSessions } from '@/lib/stats-aggregator';

export const dynamic = 'force-dynamic';

type RawLinkRow = {
  chatroom_id: string;
  local_id: number;
  sender: string;
  time: string;
  url: string;
  canonical_url: string;
  title: string | null;
  domain: string;
  source: string;
  raw_kind: string;
};

export async function GET(req: NextRequest) {
  const date = new URL(req.url).searchParams.get('date') ?? todayStr();
  const sessionLoad = await loadSessionsSafe(500);
  await syncChangedSessions({ sessions: sessionLoad.sessions, since: date, until: date }).catch(() => null);
  const names = sessionNameMap(sessionLoad.sessions);
  const rows = db()
    .prepare(
      `SELECT chatroom_id, local_id, sender, time, url, canonical_url, title, domain, source, raw_kind
       FROM message_links
       WHERE date = ?
         AND canonical_url LIKE '%://mp.weixin.qq.com/%'
       ORDER BY timestamp DESC
       LIMIT 200`,
    )
    .all(date) as RawLinkRow[];

  return NextResponse.json({
    ok: true,
    date,
    links: rows.map((row) => ({
      ...row,
      chat_name: names.get(row.chatroom_id) ?? row.chatroom_id,
    })),
  });
}
