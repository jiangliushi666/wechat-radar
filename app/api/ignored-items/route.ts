import { NextRequest, NextResponse } from 'next/server';
import { ignoreItem, normalizeIgnoredKind, unignoreItem } from '@/lib/ignored-items';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    kind?: string;
    item_key?: string;
    title?: string;
    note?: string | null;
  };
  const kind = normalizeIgnoredKind(body.kind ?? '');
  const itemKey = body.item_key?.trim();
  if (!kind || !itemKey) {
    return NextResponse.json({ ok: false, error: 'invalid ignored item' }, { status: 400 });
  }

  ignoreItem({
    kind,
    itemKey,
    title: body.title?.trim() || itemKey,
    note: body.note ?? null,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const kind = normalizeIgnoredKind(url.searchParams.get('kind') ?? '');
  const itemKey = url.searchParams.get('item_key')?.trim();
  if (!kind || !itemKey) {
    return NextResponse.json({ ok: false, error: 'invalid ignored item' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, deleted: unignoreItem(kind, itemKey) });
}
