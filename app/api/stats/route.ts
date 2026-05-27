import { NextRequest, NextResponse } from 'next/server';
import { listCachedStatsRange, syncChangedSessions } from '@/lib/stats-aggregator';
import { listAllTags, listGroups, listFavorites } from '@/lib/groups';
import { effectiveGroupIds } from '@/lib/group-classifier';
import { rangeToWindow, dateList, normalizeDate, normalizeRangeKey } from '@/lib/range';
import { countMentionsBetween } from '@/lib/mentions';
import { buildDashboardIntelligence } from '@/lib/dashboard-intelligence';
import { readConfig } from '@/lib/config';
import { loadSessionsSafe } from '@/lib/session-source';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const range = normalizeRangeKey(url.searchParams.get('range'), 'week');
    const anchorDate = normalizeDate(url.searchParams.get('date'));
    const w = rangeToWindow(range, anchorDate);

  const cfg = readConfig();
  const sessionLoad = await loadSessionsSafe(500);
  const sessions = sessionLoad.sessions;
  const groups = sessions.filter((s) => s.is_group);
  const groupNames = new Map(groups.map((g) => [g.username, g.chat]));
  const allCount = groups.length;

  const freshness = cfg.demoMode
    ? null
    : await syncChangedSessions({ sessions: groups, since: w.since, until: w.until })
        .then((result) => ({ ...result, sessions: sessionSummary(sessionLoad) }))
        .catch((e) => ({
          error: e instanceof Error ? e.message : 'unknown error',
          sessions: sessionSummary(sessionLoad),
        }));

  const cached = listCachedStatsRange(w.since, w.until);
  const totalMessages = cached.reduce((sum, r) => sum + r.total, 0);

  const dates = dateList(w.since, w.until);
  const trendByDate = new Map<string, number>(dates.map((d) => [d, 0]));
  for (const r of cached) {
    if (trendByDate.has(r.date)) {
      trendByDate.set(r.date, (trendByDate.get(r.date) ?? 0) + r.total);
    }
  }
  const trend = dates.map((d) => ({ date: d, count: trendByDate.get(d) ?? 0 }));

  const peak = trend.reduce((max, t) => (t.count > max.count ? t : max), { date: '', count: 0 });
  const sumTrend = trend.reduce((s, t) => s + t.count, 0);
  const avg = trend.length > 0 ? sumTrend / trend.length : 0;

  const totalsByGroup = new Map<string, number>();
  const sendersByGroup = new Map<string, Map<string, number>>();
  for (const r of cached) {
    totalsByGroup.set(r.chatroom_id, (totalsByGroup.get(r.chatroom_id) ?? 0) + r.total);
    const senderMap = sendersByGroup.get(r.chatroom_id) ?? new Map<string, number>();
    for (const s of r.top_senders) {
      senderMap.set(s.sender, (senderMap.get(s.sender) ?? 0) + s.count);
    }
    sendersByGroup.set(r.chatroom_id, senderMap);
  }
  const active = groups.filter((g) => (totalsByGroup.get(g.username) ?? 0) > 0).length;
  const silent = allCount - active;

  const topActiveGroups = groups
    .map((g) => ({
      chatroom_id: g.username,
      name: g.chat,
      summary: g.summary,
      total: totalsByGroup.get(g.username) ?? 0,
      top_senders: Array.from(sendersByGroup.get(g.username)?.entries() ?? [])
        .map(([sender, count]) => ({ sender, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
    }))
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total);

  const tags = listAllTags();
  const cats = listGroups();
  const tagsByChatroom = new Map<string, number[]>();
  for (const t of tags) {
    const arr = tagsByChatroom.get(t.chatroom_id) ?? [];
    arr.push(t.group_id);
    tagsByChatroom.set(t.chatroom_id, arr);
  }
  const effectiveTagsByChatroom = new Map<string, number[]>();
  for (const g of groups) {
    effectiveTagsByChatroom.set(
      g.username,
      effectiveGroupIds(g.chat, g.summary, tagsByChatroom.get(g.username) ?? [], cats),
    );
  }
  const taggedChatroomIds = new Set(
    Array.from(effectiveTagsByChatroom.entries())
      .filter(([, ids]) => ids.length > 0)
      .map(([chatroomId]) => chatroomId),
  );
  const unsortedCount = groups.filter((g) => (effectiveTagsByChatroom.get(g.username) ?? []).length === 0).length;

  const categoryStats = cats.map((c) => {
    const memberIds = Array.from(effectiveTagsByChatroom.entries())
      .filter(([, ids]) => ids.includes(c.id))
      .map(([chatroomId]) => chatroomId);
    const memberSet = new Set(memberIds);
    let groupMessageCount = 0;
    for (const r of cached) {
      if (memberSet.has(r.chatroom_id)) groupMessageCount += r.total;
    }
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      emoji: c.emoji,
      group_count: memberIds.length,
      message_count: groupMessageCount,
    };
  });
  const unsortedMessageCount = cached
    .filter((r) => !taggedChatroomIds.has(r.chatroom_id))
    .reduce((s, r) => s + r.total, 0);
  if (unsortedCount > 0) {
    categoryStats.push({
      id: -1,
      name: '未分类',
      color: '#94a3b8',
      emoji: '❓',
      group_count: unsortedCount,
      message_count: unsortedMessageCount,
    });
  }

  const favorites = listFavorites();
  const mentionCount = countMentionsBetween(unixStartOfDay(w.since), unixEndOfDay(w.until));

    return NextResponse.json({
      ok: true,
      range,
      window: w,
      cards: {
        active_groups: active,
        total_groups: allCount,
        total_messages: totalMessages,
        mentions: mentionCount,
        silent_groups: silent,
        avg_per_group: allCount ? Math.round(totalMessages / allCount) : 0,
      },
      trend: {
        data: trend,
        peak,
        avg,
        total: sumTrend,
      },
      active_groups: topActiveGroups,
      categories: categoryStats,
      intelligence: buildDashboardIntelligence(w.until, groupNames),
      sidebar_counts: {
        all: allCount,
        favorites: favorites.length,
        unsorted: unsortedCount,
      },
      freshness,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/stats failed', e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function unixStartOfDay(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(new Date(year, month - 1, day, 0, 0, 0, 0).getTime() / 1000);
}

function unixEndOfDay(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(new Date(year, month - 1, day, 23, 59, 59, 999).getTime() / 1000);
}

function sessionSummary(load: Awaited<ReturnType<typeof loadSessionsSafe>>) {
  return {
    source: load.source,
    partial: load.partial,
    total: load.total,
    groups: load.groupCount,
    live_total: load.liveCount,
    live_groups: load.liveGroupCount,
    known_total: load.knownCount,
    known_groups: load.knownGroupCount,
    cached_total: load.cachedCount,
  };
}
