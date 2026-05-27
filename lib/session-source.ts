import { cache, CK } from './cache';
import { readConfig } from './config';
import { db } from './db';
import { wxSessions } from './wx';
import type { WxSession } from './wx-types';

export type SessionLoadSource = 'demo' | 'live' | 'live_merged' | 'cache' | 'known' | 'empty';

export interface SessionLoadResult {
  sessions: WxSession[];
  source: SessionLoadSource;
  partial: boolean;
  liveCount: number | null;
  liveGroupCount: number | null;
  knownCount: number;
  knownGroupCount: number;
  cachedCount: number;
  total: number;
  groupCount: number;
}

const PARTIAL_GROUP_RATIO = Number(process.env.WECHAT_RADAR_SESSION_PARTIAL_RATIO ?? 0.75);
const PARTIAL_MIN_GROUPS = Number(process.env.WECHAT_RADAR_SESSION_PARTIAL_MIN_GROUPS ?? 20);

export async function loadSessionsSafe(limit = 500): Promise<SessionLoadResult> {
  const cached = (cache.get(CK.sessions()) as WxSession[] | undefined) ?? [];
  const known = listKnownSessions(limit);

  if (readConfig().demoMode) {
    return buildResult(listLocalSessionsFallback(limit), {
      source: 'demo',
      partial: false,
      liveCount: null,
      liveGroupCount: null,
      known,
      cached,
    });
  }

  try {
    const live = await wxSessions(limit);
    if (live.length > 0) upsertKnownSessions(live);

    const baseline = cached.length > 0 ? cached : known;
    const partial = isSuspiciouslyPartial(live, baseline);
    const sessions = partial
      ? mergeSessions(live, baseline, limit)
      : mergeSessions(live, known, limit);

    cache.set(CK.sessions(), sessions, 60);
    return buildResult(sessions, {
      source: partial ? 'live_merged' : 'live',
      partial,
      liveCount: live.length,
      liveGroupCount: groupCount(live),
      known,
      cached,
    });
  } catch {
    if (cached.length > 0) {
      return buildResult(cached, {
        source: 'cache',
        partial: true,
        liveCount: null,
        liveGroupCount: null,
        known,
        cached,
      });
    }

    if (known.length > 0) {
      return buildResult(known, {
        source: 'known',
        partial: true,
        liveCount: null,
        liveGroupCount: null,
        known,
        cached,
      });
    }

    return buildResult([], {
      source: 'empty',
      partial: true,
      liveCount: null,
      liveGroupCount: null,
      known,
      cached,
    });
  }
}

export function sessionNameMap(sessions: WxSession[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const s of sessions) {
    if (s.username) names.set(s.username, s.chat || s.username);
  }
  return names;
}

function buildResult(
  sessions: WxSession[],
  meta: {
    source: SessionLoadSource;
    partial: boolean;
    liveCount: number | null;
    liveGroupCount: number | null;
    known: WxSession[];
    cached: WxSession[];
  },
): SessionLoadResult {
  return {
    sessions,
    source: meta.source,
    partial: meta.partial,
    liveCount: meta.liveCount,
    liveGroupCount: meta.liveGroupCount,
    knownCount: meta.known.length,
    knownGroupCount: groupCount(meta.known),
    cachedCount: meta.cached.length,
    total: sessions.length,
    groupCount: groupCount(sessions),
  };
}

function isSuspiciouslyPartial(live: WxSession[], baseline: WxSession[]): boolean {
  const baselineGroups = groupCount(baseline);
  if (baselineGroups < PARTIAL_MIN_GROUPS) return false;

  const liveGroups = groupCount(live);
  if (liveGroups === 0) return true;

  return liveGroups < Math.floor(baselineGroups * PARTIAL_GROUP_RATIO);
}

function mergeSessions(primary: WxSession[], fallback: WxSession[], limit: number): WxSession[] {
  const byId = new Map<string, WxSession>();
  for (const s of primary) {
    if (s.username) byId.set(s.username, normalizeSession(s));
  }
  for (const s of fallback) {
    if (s.username && !byId.has(s.username)) byId.set(s.username, normalizeSession(s));
  }
  return Array.from(byId.values())
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, limit);
}

function upsertKnownSessions(sessions: WxSession[]) {
  const stmt = db().prepare(`
    INSERT INTO known_sessions (
      username,
      chat,
      chat_type,
      is_group,
      last_msg_type,
      last_sender,
      summary,
      time,
      timestamp,
      unread,
      last_seen_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      chat = COALESCE(NULLIF(excluded.chat, ''), known_sessions.chat),
      chat_type = excluded.chat_type,
      is_group = excluded.is_group,
      last_msg_type = CASE
        WHEN excluded.timestamp >= known_sessions.timestamp THEN excluded.last_msg_type
        ELSE known_sessions.last_msg_type
      END,
      last_sender = CASE
        WHEN excluded.timestamp >= known_sessions.timestamp THEN excluded.last_sender
        ELSE known_sessions.last_sender
      END,
      summary = CASE
        WHEN excluded.timestamp >= known_sessions.timestamp THEN excluded.summary
        ELSE known_sessions.summary
      END,
      time = CASE
        WHEN excluded.timestamp >= known_sessions.timestamp THEN excluded.time
        ELSE known_sessions.time
      END,
      timestamp = MAX(excluded.timestamp, known_sessions.timestamp),
      unread = excluded.unread,
      last_seen_at = excluded.last_seen_at
  `);
  const now = Date.now();
  const tx = db().transaction((rows: WxSession[]) => {
    for (const raw of rows) {
      const s = normalizeSession(raw);
      if (!s.username) continue;
      stmt.run(
        s.username,
        s.chat,
        s.chat_type,
        s.is_group ? 1 : 0,
        s.last_msg_type,
        s.last_sender,
        s.summary,
        s.time,
        s.timestamp,
        s.unread,
        now,
      );
    }
  });
  tx(sessions);
}

function listKnownSessions(limit: number): WxSession[] {
  const rows = db()
    .prepare(
      `SELECT username, chat, chat_type, is_group, last_msg_type, last_sender, summary, time, timestamp, unread
       FROM known_sessions
       ORDER BY timestamp DESC, last_seen_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    username: string;
    chat: string;
    chat_type: string;
    is_group: number;
    last_msg_type: string;
    last_sender: string;
    summary: string;
    time: string;
    timestamp: number;
    unread: number;
  }>;

  return rows.map((r) => ({
    username: r.username,
    chat: r.chat,
    chat_type: r.chat_type,
    is_group: r.is_group === 1,
    last_msg_type: r.last_msg_type,
    last_sender: r.last_sender,
    summary: r.summary,
    time: r.time,
    timestamp: r.timestamp,
    unread: r.unread,
  }));
}

function listLocalSessionsFallback(limit: number): WxSession[] {
  const rows = db()
    .prepare(
      `
      SELECT m.chatroom_id, m.sender, m.content, m.time, m.timestamp, m.type
      FROM messages m
      JOIN (
        SELECT chatroom_id, MAX(timestamp) AS timestamp
        FROM messages
        GROUP BY chatroom_id
      ) latest
        ON latest.chatroom_id = m.chatroom_id
       AND latest.timestamp = m.timestamp
      GROUP BY m.chatroom_id
      ORDER BY m.timestamp DESC
      LIMIT ?
    `,
    )
    .all(limit) as Array<{
    chatroom_id: string;
    sender: string;
    content: string;
    time: string;
    timestamp: number;
    type: string;
  }>;

  return rows.map((r) => ({
    chat: r.chatroom_id,
    chat_type: 'group',
    is_group: true,
    last_msg_type: r.type,
    last_sender: r.sender,
    summary: r.content,
    time: r.time,
    timestamp: r.timestamp,
    unread: 0,
    username: r.chatroom_id,
  }));
}

function normalizeSession(s: WxSession): WxSession {
  return {
    username: s.username ?? '',
    chat: s.chat ?? s.username ?? '',
    chat_type: s.chat_type ?? '',
    is_group: Boolean(s.is_group),
    last_msg_type: s.last_msg_type ?? '',
    last_sender: s.last_sender ?? '',
    summary: s.summary ?? '',
    time: s.time ?? '',
    timestamp: Number(s.timestamp ?? 0),
    unread: Number(s.unread ?? 0),
  };
}

function groupCount(sessions: WxSession[]): number {
  return sessions.filter((s) => s.is_group).length;
}
