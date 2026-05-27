import pLimit from 'p-limit';
import { db } from './db';
import { wxHistory, wxStats } from './wx';
import {
  aggregateDailyStats,
  bulkInsertMessages,
  dateOfMessage,
  latestMessageTimestamps,
  upsertSyncState,
} from './messages-store';
import { rebuildMentionIndexFromMessages } from './mentions';
import { cache } from './cache';
import type { WxMessage, WxSession, WxStats } from './wx-types';

export type StatsRow = {
  chatroom_id: string;
  date: string;
  total: number;
  top_senders: Array<{ sender: string; count: number }>;
  by_hour: Array<{ hour: number; count: number }>;
};

export function getCachedStats(chatroomId: string, date: string): StatsRow | null {
  const row = db()
    .prepare(
      'SELECT chatroom_id, date, total, top_senders, by_hour FROM daily_stats WHERE chatroom_id = ? AND date = ?',
    )
    .get(chatroomId, date) as
    | {
        chatroom_id: string;
        date: string;
        total: number;
        top_senders: string;
        by_hour: string;
      }
    | undefined;
  if (!row) return null;
  return {
    chatroom_id: row.chatroom_id,
    date: row.date,
    total: row.total,
    top_senders: JSON.parse(row.top_senders),
    by_hour: JSON.parse(row.by_hour),
  };
}

export function listCachedStatsForDate(date: string): StatsRow[] {
  const rows = db()
    .prepare(
      'SELECT chatroom_id, date, total, top_senders, by_hour FROM daily_stats WHERE date = ? ORDER BY total DESC',
    )
    .all(date) as Array<{
    chatroom_id: string;
    date: string;
    total: number;
    top_senders: string;
    by_hour: string;
  }>;
  return rows.map((r) => ({
    chatroom_id: r.chatroom_id,
    date: r.date,
    total: r.total,
    top_senders: JSON.parse(r.top_senders),
    by_hour: JSON.parse(r.by_hour),
  }));
}

export function listCachedStatsRange(since: string, until: string): StatsRow[] {
  const rows = db()
    .prepare(
      'SELECT chatroom_id, date, total, top_senders, by_hour FROM daily_stats WHERE date >= ? AND date <= ?',
    )
    .all(since, until) as Array<{
    chatroom_id: string;
    date: string;
    total: number;
    top_senders: string;
    by_hour: string;
  }>;
  return rows.map((r) => ({
    chatroom_id: r.chatroom_id,
    date: r.date,
    total: r.total,
    top_senders: JSON.parse(r.top_senders),
    by_hour: JSON.parse(r.by_hour),
  }));
}

const upsert = () =>
  db().prepare(`
    INSERT INTO daily_stats (chatroom_id, date, total, top_senders, by_hour, refreshed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chatroom_id, date) DO UPDATE SET
      total = excluded.total,
      top_senders = excluded.top_senders,
      by_hour = excluded.by_hour,
      refreshed_at = excluded.refreshed_at
  `);

export function saveStats(row: StatsRow & { refreshed_at?: number }) {
  upsert().run(
    row.chatroom_id,
    row.date,
    row.total,
    JSON.stringify(row.top_senders),
    JSON.stringify(row.by_hour),
    row.refreshed_at ?? Date.now(),
  );
}

export interface RescanProgress {
  type: 'progress' | 'done' | 'error' | 'start';
  done: number;
  total: number;
  current?: string;
  error?: string;
  inserted_messages?: number;
}

export interface RescanTarget {
  chatroomId: string;
  display: string;
}

export interface SyncOptions {
  targets: RescanTarget[];
  since: string;
  until: string;
  concurrency?: number;
  onProgress?: (p: RescanProgress) => void;
}

const HISTORY_PAGE_SIZE = Number(process.env.WECHAT_RADAR_HISTORY_PAGE_SIZE ?? 10000);
const HISTORY_MAX_PAGES = Number(process.env.WECHAT_RADAR_HISTORY_MAX_PAGES ?? 30);
const INCREMENTAL_MAX_TARGETS = Number(process.env.WECHAT_RADAR_INCREMENTAL_MAX_TARGETS ?? 120);
const INCREMENTAL_LOOKBACK_DAYS = Number(process.env.WECHAT_RADAR_INCREMENTAL_LOOKBACK_DAYS ?? 2);
const INCREMENTAL_CONCURRENCY = Number(process.env.WECHAT_RADAR_INCREMENTAL_CONCURRENCY ?? 2);

// Helper: split a date range into month chunks ([{since, until}, ...])
function monthChunks(since: string, until: string): Array<{ since: string; until: string }> {
  const chunks: Array<{ since: string; until: string }> = [];
  const start = new Date(since);
  const end = new Date(until);
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const chunkStart = cur < start ? start : cur;
    const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0); // last day of cur month
    const chunkEnd = nextMonth > end ? end : nextMonth;
    chunks.push({
      since: ymd(chunkStart),
      until: ymd(chunkEnd),
    });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return chunks;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateList(since: string, until: string): string[] {
  const out: string[] = [];
  const start = new Date(since);
  const end = new Date(until);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(ymd(d));
  }
  return out;
}

/**
 * 全量同步：每群按月分批拉 wx history → 本地存 messages → 本地聚合 daily_stats。
 * 比起逐天调 wx stats 快 30 倍。
 */
export async function syncFullHistory({
  targets,
  since,
  until,
  concurrency = 6,
  onProgress,
}: SyncOptions): Promise<{ ok: number; failed: number; messages: number }> {
  const limit = pLimit(concurrency);
  const chunks = monthChunks(since, until);
  const total = targets.length * chunks.length;
  let done = 0;
  let ok = 0;
  let failed = 0;
  let totalMessages = 0;
  const byTarget = new Map<
    string,
    {
      fetched: number;
      inserted: number;
      failedChunks: number;
      emptyChunks: number;
      errors: string[];
    }
  >();
  for (const t of targets) {
    byTarget.set(t.chatroomId, {
      fetched: 0,
      inserted: 0,
      failedChunks: 0,
      emptyChunks: 0,
      errors: [],
    });
  }

  const tasks: Promise<void>[] = [];
  for (const t of targets) {
    for (const c of chunks) {
      tasks.push(
        limit(async () => {
          const state = byTarget.get(t.chatroomId)!;
          try {
            const messages = await wxHistoryPaged(t.chatroomId, c.since, c.until);
            const inserted = bulkInsertMessages(t.chatroomId, messages);
            state.fetched += messages.length;
            state.inserted += inserted;
            if (messages.length === 0) state.emptyChunks++;
            totalMessages += inserted;
            ok++;
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            state.failedChunks++;
            state.errors.push(`${c.since}~${c.until}: ${message}`);
            failed++;
            onProgress?.({
              type: 'error',
              done,
              total,
              current: `${t.display} ${c.since.slice(0, 7)}`,
              error: message,
              inserted_messages: totalMessages,
            });
          } finally {
            done++;
            onProgress?.({
              type: 'progress',
              done,
              total,
              current: `${t.display} ${c.since.slice(0, 7)}`,
              inserted_messages: totalMessages,
            });
          }
        }),
      );
    }
  }

  await Promise.all(tasks);

  // Now aggregate daily_stats from the new messages for each target
  const aggLimit = pLimit(8);
  const dates = dateList(since, until);
  await Promise.all(
    targets.map((t) =>
      aggLimit(async () => {
        const buckets = aggregateDailyStats(t.chatroomId, dates);
        for (const b of buckets) {
          if (b.total === 0) {
            // Don't overwrite if we already have non-zero stats from a prior wx-stats run
            const existing = getCachedStats(t.chatroomId, b.date);
            if (existing && existing.total > 0) continue;
          }
          saveStats({
            chatroom_id: t.chatroomId,
            date: b.date,
            total: b.total,
            top_senders: b.top_senders,
            by_hour: b.by_hour,
          });
        }

        // Update sync_state
        const firstRow = db()
          .prepare(
            'SELECT MIN(date) AS d, MAX(date) AS dx, COUNT(*) AS n FROM messages WHERE chatroom_id = ?',
          )
          .get(t.chatroomId) as { d: string | null; dx: string | null; n: number };
        const state = byTarget.get(t.chatroomId)!;
        const status =
          state.failedChunks === chunks.length
            ? 'failed'
            : state.failedChunks > 0
              ? 'partial'
              : firstRow.n === 0 && state.fetched === 0
                ? 'empty'
                : 'ok';
        upsertSyncState(t.chatroomId, firstRow.n, firstRow.d, firstRow.dx, {
          status,
          lastError: state.errors.slice(-3).join('\n') || null,
          failedChunks: state.failedChunks,
          emptyChunks: state.emptyChunks,
          totalChunks: chunks.length,
        });
      }),
    ),
  );

  rebuildMentionIndexFromMessages();
  if (totalMessages > 0) clearDerivedCaches(dates);

  onProgress?.({
    type: 'done',
    done: total,
    total,
    inserted_messages: totalMessages,
  });

  return { ok, failed, messages: totalMessages };
}

export interface IncrementalSyncResult {
  checked: number;
  targets: number;
  ok: number;
  failed: number;
  fetched: number;
  inserted: number;
  affectedDates: string[];
  failedTargets: Array<{ chatroom_id: string; name: string; error: string }>;
}

export async function syncChangedSessions({
  sessions,
  since,
  until,
  maxTargets = INCREMENTAL_MAX_TARGETS,
  lookbackDays = INCREMENTAL_LOOKBACK_DAYS,
  concurrency = INCREMENTAL_CONCURRENCY,
}: {
  sessions: WxSession[];
  since: string;
  until: string;
  maxTargets?: number;
  lookbackDays?: number;
  concurrency?: number;
}): Promise<IncrementalSyncResult> {
  const groups = sessions.filter((s) => s.is_group && s.username && s.timestamp > 0);
  const localLatest = latestMessageTimestamps();
  const sinceTs = unixStartOfDay(since);
  const untilTs = unixEndOfDay(until);

  const targets = groups
    .filter((s) => s.timestamp >= sinceTs && s.timestamp <= untilTs)
    .filter((s) => s.timestamp > (localLatest.get(s.username) ?? 0))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, Math.max(0, maxTargets));

  if (targets.length === 0) {
    return {
      checked: groups.length,
      targets: 0,
      ok: 0,
      failed: 0,
      fetched: 0,
      inserted: 0,
      affectedDates: [],
      failedTargets: [],
    };
  }

  const affected = new Map<string, Set<string>>();
  const limit = pLimit(Math.max(1, concurrency));
  let ok = 0;
  let failed = 0;
  let fetched = 0;
  let inserted = 0;
  const failedTargets: Array<{ chatroom_id: string; name: string; error: string }> = [];

  await Promise.all(
    targets.map((s) =>
      limit(async () => {
        const latest = localLatest.get(s.username) ?? 0;
        const fetchSince = latest > 0
          ? dateFromUnix(Math.max(sinceTs, latest - 60))
          : boundedLookbackSince(since, until, lookbackDays);
        try {
          const messages = await wxHistoryPaged(s.username, fetchSince, until, HISTORY_PAGE_SIZE, 3);
          fetched += messages.length;
          const newDates = new Set(
            messages
              .filter((m) => latest === 0 || m.timestamp >= latest)
              .map(dateOfMessage)
              .filter((d) => d !== 'unknown' && d >= since && d <= until),
          );
          const count = bulkInsertMessages(s.username, messages);
          inserted += count;
          if (messages.length > 0 || count > 0) {
            const dates = affected.get(s.username) ?? new Set<string>();
            for (const d of newDates) dates.add(d);
            affected.set(s.username, dates);
          }
          ok++;
        } catch (e) {
          failed++;
          failedTargets.push({
            chatroom_id: s.username,
            name: s.chat || s.username,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }),
    ),
  );

  refreshAggregates(affected);
  if (inserted > 0) {
    rebuildMentionIndexFromMessages();
    clearDerivedCaches(Array.from(new Set(Array.from(affected.values()).flatMap((s) => Array.from(s)))));
  }

  return {
    checked: groups.length,
    targets: targets.length,
    ok,
    failed,
    fetched,
    inserted,
    affectedDates: Array.from(new Set(Array.from(affected.values()).flatMap((s) => Array.from(s)))).sort(),
    failedTargets,
  };
}

async function wxHistoryPaged(
  chatroomId: string,
  since: string,
  until: string,
  pageSize = HISTORY_PAGE_SIZE,
  maxPages = HISTORY_MAX_PAGES,
): Promise<WxMessage[]> {
  const all: WxMessage[] = [];
  const seen = new Set<number>();
  for (let page = 0; page < Math.max(1, maxPages); page++) {
    const offset = page * pageSize;
    const batch = await wxHistory(chatroomId, since, until, pageSize, offset);
    for (const m of batch) {
      if (seen.has(m.local_id)) continue;
      seen.add(m.local_id);
      all.push(m);
    }
    if (batch.length < pageSize) break;
  }
  return all.sort((a, b) => (a.timestamp - b.timestamp) || (a.local_id - b.local_id));
}

function refreshAggregates(affected: Map<string, Set<string>>) {
  for (const [chatroomId, datesSet] of affected.entries()) {
    const dates = Array.from(datesSet).sort();
    if (dates.length === 0) continue;
    const buckets = aggregateDailyStats(chatroomId, dates);
    for (const b of buckets) {
      saveStats({
        chatroom_id: chatroomId,
        date: b.date,
        total: b.total,
        top_senders: b.top_senders,
        by_hour: b.by_hour,
      });
    }

    const firstRow = db()
      .prepare(
        'SELECT MIN(date) AS d, MAX(date) AS dx, COUNT(*) AS n FROM messages WHERE chatroom_id = ?',
      )
      .get(chatroomId) as { d: string | null; dx: string | null; n: number };
    upsertSyncState(chatroomId, firstRow.n, firstRow.d, firstRow.dx, {
      status: firstRow.n > 0 ? 'ok' : 'empty',
      totalChunks: dates.length,
    });
  }
}

function clearDerivedCaches(dates: string[]) {
  cache.flushAll();
  if (dates.length === 0) return;
  const placeholders = dates.map(() => '?').join(',');
  db()
    .prepare(`DELETE FROM link_intelligence_cache WHERE date IN (${placeholders})`)
    .run(...dates);
}

function boundedLookbackSince(since: string, until: string, days: number): string {
  const end = parseLocalDate(until);
  end.setDate(end.getDate() - Math.max(0, days - 1));
  const candidate = ymd(end);
  return candidate > since ? candidate : since;
}

function unixStartOfDay(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(new Date(year, month - 1, day, 0, 0, 0, 0).getTime() / 1000);
}

function unixEndOfDay(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(new Date(year, month - 1, day, 23, 59, 59, 999).getTime() / 1000);
}

function dateFromUnix(timestamp: number): string {
  return ymd(new Date(timestamp * 1000));
}

function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * 兼容旧调用：单天 wx stats 模式（保留以备需要）
 */
export interface RescanOptions {
  targets: RescanTarget[];
  dates: string[];
  concurrency?: number;
  onProgress?: (p: RescanProgress) => void;
}

export async function rescan({
  targets,
  dates,
  concurrency = 5,
  onProgress,
}: RescanOptions): Promise<{ ok: number; failed: number }> {
  const limit = pLimit(concurrency);
  const total = targets.length * dates.length;
  let done = 0;
  let ok = 0;
  let failed = 0;

  const tasks: Promise<void>[] = [];
  for (const t of targets) {
    for (const d of dates) {
      tasks.push(
        limit(async () => {
          try {
            const res: WxStats = await wxStats(t.chatroomId, d, d);
            saveStats({
              chatroom_id: t.chatroomId,
              date: d,
              total: res.total ?? 0,
              top_senders: res.top_senders ?? [],
              by_hour: res.by_hour ?? [],
            });
            ok++;
          } catch {
            failed++;
            saveStats({
              chatroom_id: t.chatroomId,
              date: d,
              total: 0,
              top_senders: [],
              by_hour: [],
            });
          } finally {
            done++;
            onProgress?.({ type: 'progress', done, total, current: t.display });
          }
        }),
      );
    }
  }

  await Promise.all(tasks);
  onProgress?.({ type: 'done', done, total });
  return { ok, failed };
}
