'use client';

import { useMemo, useState } from 'react';
import { Download, ImageIcon, Loader2, WandSparkles, X } from 'lucide-react';
import type { ActiveGroup } from './ActiveGroupsList';
import type { ChatRanking } from './ChatRankingsList';
import type { DashboardIntelligence } from './IntelligenceBrief';

type InfographicStats = {
  window: { since: string; until: string; days: number };
  cards: {
    active_groups: number;
    total_groups: number;
    total_messages: number;
    mentions: number;
    silent_groups: number;
    avg_per_group: number;
  };
  active_groups: ActiveGroup[];
  chat_rankings?: ChatRanking[];
  intelligence: DashboardIntelligence;
};

type GenerateResponse = {
  ok: boolean;
  error?: string;
  model?: string;
  image?: string;
  image_url?: string;
};

const BASE_URL_KEY = 'wechat-radar-image-base-url-v1';

export default function InfographicGenerator({ stats }: { stats?: InfographicStats | null }) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(() =>
    typeof window === 'undefined'
      ? 'https://api.openai.com/v1'
      : window.localStorage.getItem(BASE_URL_KEY) || 'https://api.openai.com/v1',
  );
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);

  const defaultPrompt = useMemo(() => (stats ? buildInfographicPrompt(stats) : ''), [stats]);

  function openPanel() {
    setPrompt(defaultPrompt);
    setError(null);
    setImage(null);
    setOpen(true);
  }

  async function generate() {
    if (!stats) return;
    setBusy(true);
    setError(null);
    try {
      window.localStorage.setItem(BASE_URL_KEY, baseUrl.trim());
      const r = await fetch('/api/infographic', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          baseUrl,
          prompt,
          size: '1024x1536',
        }),
      });
      const json = (await r.json()) as GenerateResponse;
      if (!r.ok || !json.ok) throw new Error(json.error ?? '生成失败');
      setImage(json.image ?? json.image_url ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn" onClick={openPanel} disabled={!stats || busy}>
        <ImageIcon size={13} />
        <span>今日信息图</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="card max-h-[88vh] w-full max-w-5xl overflow-hidden p-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-3">
              <div>
                <div className="report-kicker">GPT Image</div>
                <div className="mt-0.5 text-[15px] font-semibold">今日群聊信息图</div>
              </div>
              <button className="rounded p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="grid max-h-[calc(88vh-58px)] grid-cols-1 overflow-y-auto lg:grid-cols-[1fr_360px]">
              <div className="space-y-3 p-5">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-[11px] text-[var(--text-3)]">API Key</span>
                    <input
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      type="password"
                      autoComplete="off"
                      placeholder="可留空，使用服务端环境变量"
                      className="control-surface mt-1 w-full rounded-md px-3 py-2 text-[12px] outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-[var(--text-3)]">Base URL</span>
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.openai.com/v1"
                      className="control-surface mt-1 w-full rounded-md px-3 py-2 text-[12px] outline-none"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-[11px] text-[var(--text-3)]">提示词</span>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="control-surface mt-1 h-[420px] w-full resize-none rounded-md px-3 py-2 font-mono text-[12px] leading-5 outline-none"
                  />
                </label>

                {error && <div className="text-[12px] text-[var(--danger)]">{error}</div>}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] text-[var(--text-3)]">
                    模型固定 gpt-image-2 · 1024x1536
                  </div>
                  <div className="flex gap-2">
                    <button className="btn" onClick={() => setPrompt(defaultPrompt)} disabled={busy}>
                      恢复预设
                    </button>
                    <button className="btn btn-primary" onClick={generate} disabled={busy || !prompt.trim()}>
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <WandSparkles size={13} />}
                      <span>{busy ? '生成中…' : '生成信息图'}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="border-t border-[var(--border-soft)] bg-[var(--surface-2)] p-5 lg:border-l lg:border-t-0">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[13px] font-semibold">预览</div>
                  {image && (
                    <a
                      className="btn"
                      href={image}
                      download={`wechat-radar-infographic-${stats?.window.until ?? 'today'}.png`}
                    >
                      <Download size={13} />
                      下载
                    </a>
                  )}
                </div>
                <div className="flex min-h-[520px] items-center justify-center overflow-hidden rounded-md border border-[var(--border-soft)] bg-[var(--surface)]">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt="今日群聊信息图" className="max-h-[640px] w-full object-contain" />
                  ) : (
                    <div className="px-6 text-center text-[12px] text-[var(--text-3)]">
                      生成后在这里预览
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function buildInfographicPrompt(stats: InfographicStats): string {
  const groups = (stats.chat_rankings ?? stats.active_groups)
    .filter((chat) => chat.is_group ?? chat.chatroom_id.endsWith('@chatroom'))
    .filter((chat) => chat.total > 0)
    .map((chat) => `${chat.name}：${chat.total} 条，${chat.summary || '暂无摘要'}`)
    .slice(0, 8);
  const intel = stats.intelligence;
  const topMessages = intel.must_read.slice(0, 5);
  const actions = intel.action_items.slice(0, 4);
  const topics = intel.topic_lifecycle.slice(0, 5);
  const links = intel.link_highlights.slice(0, 4);
  const anomalies = intel.anomalies.slice(0, 3);

  return [
    'Use case: infographic-diagram',
    'Asset type: 9:16 mobile infographic for a private WeChat Radar daily report',
    'Primary request: 生成一张「今日群聊信息图」，基于下方真实数据做中文信息图，不要编造任何额外事实。',
    'Style/medium: 高级中文数据新闻信息图，清晰、现代、克制，适合手机长图分享。',
    'Composition/framing: 竖版 1024x1536；顶部是日期和总览，中间是关键洞察和活跃群排行，底部是待跟进项和资源。',
    'Color palette: 温润米白背景、深墨绿色文字、少量微信绿色与琥珀色强调；高对比，避免花哨渐变。',
    'Typography: 简体中文大字号标题，信息分层明显；每行文字短、可读，不要密集小字。',
    'Constraints: 不要生成聊天截图，不要出现二维码、Logo、水印、假头像、假昵称、用户 ID；只使用下面给出的群名、标题和摘要。若文字放不下，优先保留数字、标题和排行。',
    'Text accuracy: 所有数字和标题必须尽量照抄数据；不要新增群名、链接名或观点。',
    '',
    `日期范围：${stats.window.since} 至 ${stats.window.until}`,
    `总览：${stats.cards.total_messages} 条消息；${stats.cards.active_groups} 个活跃会话；${stats.cards.total_groups} 个统计会话；@我 ${stats.cards.mentions} 条。`,
    '',
    '活跃群排行：',
    ...fallbackLines(groups, '暂无活跃群').map((line, i) => `${i + 1}. ${line}`),
    '',
    '关键话题与消息：',
    ...fallbackLines(topMessages.map((item) => `${item.title}（${item.chat_name} / ${item.sender}）`), '暂无关键消息').map((line, i) => `${i + 1}. ${line}`),
    '',
    '待跟进行动：',
    ...fallbackLines(actions.map((item) => `${item.action}：${item.title}`), '暂无待跟进项').map((line, i) => `${i + 1}. ${line}`),
    '',
    '趋势话题：',
    ...fallbackLines(topics.map((item) => `${item.title}：${item.reason}`), '暂无趋势话题').map((line, i) => `${i + 1}. ${line}`),
    '',
    '资源链接：',
    ...fallbackLines(links.map((item) => `${item.title}（${item.domain}，${item.count} 次）`), '暂无资源链接').map((line, i) => `${i + 1}. ${line}`),
    '',
    '异动提醒：',
    ...fallbackLines(anomalies.map((item) => `${item.title}：${item.description}`), '暂无明显异动').map((line, i) => `${i + 1}. ${line}`),
  ].join('\n');
}

function fallbackLines(lines: string[], fallback: string): string[] {
  return lines.length > 0 ? lines : [fallback];
}
