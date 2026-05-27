'use client';

import Link from 'next/link';
import { MessageCircle, UsersRound } from 'lucide-react';

export interface ChatRanking {
  chatroom_id: string;
  name: string;
  chat_type?: string;
  is_group?: boolean;
  kind?: string;
  summary: string;
  total: number;
  top_senders: Array<{ sender: string; count: number }>;
  last_time?: string;
  timestamp?: number;
  unread?: number;
}

export default function ChatRankingsList({
  chats,
  date,
}: {
  chats: ChatRanking[];
  date?: string;
}) {
  const groups = chats.filter((chat) => chat.is_group).length;
  const contacts = chats.filter((chat) => !chat.is_group).length;

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[14px] font-semibold">
          <MessageCircle size={14} className="text-[var(--accent)]" />
          微信聊天列表排行
        </div>
        <div className="shrink-0 text-[11px] text-[var(--text-3)]">
          {groups} 群 · {contacts} 联系人
        </div>
      </div>

      {chats.length === 0 ? (
        <div className="py-10 text-center text-[12px] text-[var(--text-3)]">
          暂无会话 · 点击「重扫」加载
        </div>
      ) : (
        <div className="space-y-1">
          {chats.slice(0, 14).map((chat, index) => (
            <ChatRow key={chat.chatroom_id} chat={chat} rank={index + 1} date={date} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChatRow({
  chat,
  rank,
  date,
}: {
  chat: ChatRanking;
  rank: number;
  date?: string;
}) {
  const isGroup = chat.is_group ?? chat.chatroom_id.endsWith('@chatroom');
  const href = `/groups/${encodeURIComponent(chat.chatroom_id)}${date ? `?date=${date}` : ''}`;
  const tail = chat.total > 0
    ? `${chat.total.toLocaleString()} 条`
    : chat.unread && chat.unread > 0
      ? `${chat.unread} 未读`
      : chat.last_time || '';

  return (
    <Link
      href={href}
      className="grid grid-cols-[24px_32px_1fr_auto] items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-[var(--surface-2)]"
      title="查看聊天记录"
    >
      <span className="rounded bg-[var(--surface-2)] py-0.5 text-center text-[10px] tabular-nums text-[var(--text-3)]">
        {rank}
      </span>
      <span className="flex size-8 items-center justify-center rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] text-[var(--text-2)]">
        {isGroup ? <UsersRound size={14} /> : <MessageCircle size={14} />}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] text-[var(--text)]">{chat.name}</span>
          <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]">
            {isGroup ? '群聊' : '联系人'}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-[var(--text-3)]">
          {chat.summary || '暂无最近消息'}
        </span>
      </span>
      <span className="shrink-0 text-right text-[11px] tabular-nums text-[var(--text-3)]">
        {tail}
      </span>
    </Link>
  );
}
