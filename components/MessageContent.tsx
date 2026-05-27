'use client';

import { useEffect, useState } from 'react';

const IMG_RE = /\[图片\]\s*local_id=(\d+)/g;

function WxImage({
  chatroomId,
  localId,
}: {
  chatroomId: string;
  localId: number;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      try {
        const url = `/api/wx-image?chatroom=${encodeURIComponent(chatroomId)}&local_id=${localId}`;
        const res = await fetch(url);
        const contentType = res.headers.get('content-type') ?? '';
        if (!res.ok || res.status === 204 || !contentType.startsWith('image/')) {
          if (!cancelled) setMissing(true);
          return;
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
      } catch {
        if (!cancelled) setMissing(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [chatroomId, localId]);

  if (missing) {
    return <span className="text-[var(--text-3)]">{`[图片缺失 local_id=${localId}]`}</span>;
  }

  if (!src) {
    return <span className="text-[var(--text-3)]">{`[图片 local_id=${localId}]`}</span>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`图片 ${localId}`}
      loading="lazy"
      className="my-1 inline-block max-h-[280px] max-w-full rounded border border-[var(--border)] align-middle"
    />
  );
}

export default function MessageContent({
  content,
  chatroomId,
}: {
  content: string;
  chatroomId: string;
}) {
  if (!content) return null;

  // 没有图片占位符直接返回文本
  if (!content.includes('[图片]')) {
    return <span className="whitespace-pre-wrap break-words">{content}</span>;
  }

  // 切片：文本 + 图片 + 文本 + ...
  const parts: Array<{ type: 'text'; v: string } | { type: 'img'; localId: number }> = [];
  let last = 0;
  for (const m of content.matchAll(IMG_RE)) {
    if (m.index === undefined) continue;
    if (m.index > last) {
      parts.push({ type: 'text', v: content.slice(last, m.index) });
    }
    parts.push({ type: 'img', localId: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    parts.push({ type: 'text', v: content.slice(last) });
  }

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => {
        if (p.type === 'text') return <span key={i}>{p.v}</span>;
        return <WxImage key={i} chatroomId={chatroomId} localId={p.localId} />;
      })}
    </span>
  );
}
