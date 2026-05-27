import Link from 'next/link';
import { FileText, Flame, MessageCircle, UsersRound } from 'lucide-react';

export interface ActiveGroup {
  chatroom_id: string;
  name: string;
  chat_type?: string;
  is_group?: boolean;
  kind?: string;
  summary: string;
  total: number;
  top_senders: Array<{ sender: string; count: number }>;
}

export default function ActiveGroupsList({ groups, date }: { groups: ActiveGroup[]; date?: string }) {
  const max = groups[0]?.total ?? 1;
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[14px] font-semibold">
          <Flame size={14} className="text-[var(--warn)]" />
          智能活跃会话
        </div>
        <div className="text-[11px] text-[var(--text-3)]">
          去噪后 {groups.length} 个 · 群聊可看日报
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="py-10 text-center text-[12px] text-[var(--text-3)]">
          暂无数据 · 点击「重扫」加载
        </div>
      ) : (
        <div className="space-y-1">
          {groups.slice(0, 12).map((g, i) => (
            <Row key={g.chatroom_id} group={g} rank={i + 1} max={max} date={date} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  group,
  rank,
  max,
  date,
}: {
  group: ActiveGroup;
  rank: number;
  max: number;
  date?: string;
}) {
  const senders = group.top_senders
    .slice(0, 3)
    .map((s) => s.sender)
    .join(' · ');
  const pct = (group.total / max) * 100;
  const groupHref = `/groups/${encodeURIComponent(group.chatroom_id)}${date ? `?date=${date}` : ''}`;
  const reportHref = `/reports/groups/${encodeURIComponent(group.chatroom_id)}?date=${date}`;
  const isGroup = group.is_group ?? group.chatroom_id.endsWith('@chatroom');

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-[var(--surface-2)]">
      <Link
        href={groupHref}
        className="grid min-w-0 grid-cols-[24px_36px_1fr_88px] items-center gap-3"
        title="查看群详情"
      >
        <span className="rounded bg-[var(--surface-2)] py-0.5 text-center text-[10px] tabular-nums text-[var(--text-3)]">
          {rank}
        </span>
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] text-[11px] text-[var(--text-2)]">
          {isGroup ? <UsersRound size={14} /> : <MessageCircle size={14} />}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] text-[var(--text)]">{group.name}</span>
            {!isGroup && (
              <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]">
                联系人
              </span>
            )}
          </div>
          {senders && (
            <div className="truncate text-[11px] text-[var(--text-3)]">{senders}</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[14px] font-semibold tabular-nums text-[var(--text)]">
            {group.total.toLocaleString()}
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--accent)]"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </Link>
      {isGroup && rank <= 10 && date ? (
        <Link
          href={reportHref}
          className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border-soft)] bg-[var(--accent-soft)] px-2 text-[11px] font-medium text-[var(--accent)] transition-colors hover:border-[var(--accent)]"
          title="查看群日报"
        >
          <FileText size={12} />
          日报
        </Link>
      ) : (
        <span className="w-[52px]" />
      )}
    </div>
  );
}
