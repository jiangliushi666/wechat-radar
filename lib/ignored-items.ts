import { cache } from './cache';
import { db } from './db';

export type IgnoredKind = 'dashboard_signal';

const ALLOWED_KINDS = new Set<IgnoredKind>(['dashboard_signal']);

export function normalizeIgnoredKind(kind: string): IgnoredKind | null {
  return ALLOWED_KINDS.has(kind as IgnoredKind) ? (kind as IgnoredKind) : null;
}

export function dashboardSignalKey(chatroomId: string, localId: number): string {
  return `${chatroomId}:${localId}`;
}

export function listIgnoredItemKeys(kind: IgnoredKind): Set<string> {
  const rows = db()
    .prepare('SELECT item_key FROM ignored_items WHERE kind = ?')
    .all(kind) as Array<{ item_key: string }>;
  return new Set(rows.map((r) => r.item_key));
}

export function ignoreItem({
  kind,
  itemKey,
  title,
  note,
}: {
  kind: IgnoredKind;
  itemKey: string;
  title: string;
  note?: string | null;
}) {
  db()
    .prepare(
      `INSERT INTO ignored_items (kind, item_key, title, note, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(kind, item_key) DO UPDATE SET
         title = excluded.title,
         note = excluded.note`,
    )
    .run(kind, itemKey, title, note ?? null, Date.now());
  cache.flushAll();
}

export function unignoreItem(kind: IgnoredKind, itemKey: string): boolean {
  const result = db()
    .prepare('DELETE FROM ignored_items WHERE kind = ? AND item_key = ?')
    .run(kind, itemKey);
  if (result.changes > 0) cache.flushAll();
  return result.changes > 0;
}
