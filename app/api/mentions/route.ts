import { NextRequest, NextResponse } from 'next/server';
import { countMentions, listMentions, markMentionsSeen } from '@/lib/mentions';
import { loadSessionsSafe, sessionNameMap } from '@/lib/session-source';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 1000), 1), 5000);

  const sessionLoad = await loadSessionsSafe(500);
  const nameByChatroom = sessionNameMap(sessionLoad.sessions);

  const items = listMentions(limit).map((m) => ({
    ...m,
    chat_name: nameByChatroom.get(m.chatroom_id) ?? m.chatroom_id,
  }));

  return NextResponse.json({ ok: true, total: countMentions(), items });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { chatroom_id?: string };
  markMentionsSeen(body.chatroom_id);
  return NextResponse.json({ ok: true });
}
