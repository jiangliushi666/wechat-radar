import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  WxDaemonStatus,
  WxMember,
  WxMessage,
  WxNewMessage,
  WxSession,
  WxStats,
} from './wx-types';

const run = promisify(execFile);

const DEFAULT_OPTS = {
  maxBuffer: 64 * 1024 * 1024,
  timeout: 60_000,
} as const;

async function wxRaw(args: string[], opts = DEFAULT_OPTS): Promise<string> {
  const { stdout } = await run('wx', args, opts);
  return stdout;
}

async function wxJson<T>(args: string[], opts = DEFAULT_OPTS): Promise<T> {
  const stdout = await wxRaw([...args, '--json'], opts);
  return JSON.parse(stdout) as T;
}

export async function wxSessions(limit = 500): Promise<WxSession[]> {
  const out = await wxJson<WxSession[] | { sessions?: WxSession[] }>([
    'sessions',
    '-n',
    String(limit),
  ]);
  return Array.isArray(out) ? out : (out.sessions ?? []);
}

export async function wxStats(
  chat: string,
  since: string,
  until: string,
): Promise<WxStats> {
  return wxJson<WxStats>(['stats', chat, '--since', since, '--until', until]);
}

export async function wxHistory(
  chat: string,
  since: string,
  until: string,
  limit = 1000,
  offset = 0,
): Promise<WxMessage[]> {
  let out: WxMessage[] | { messages?: WxMessage[] };
  const args = [
    'history',
    chat,
    '--since',
    since,
    '--until',
    until,
    '-n',
    String(limit),
  ];
  if (offset > 0) args.push('--offset', String(offset));
  try {
    out = await wxJson<WxMessage[] | { messages?: WxMessage[] }>(args);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('找不到') && message.includes('消息记录')) return [];
    throw e;
  }
  return Array.isArray(out) ? out : (out.messages ?? []);
}

export async function wxNewMessages(limit = 50): Promise<WxNewMessage[]> {
  const out = await wxJson<WxNewMessage[] | { messages?: WxNewMessage[] }>([
    'new-messages',
    '-n',
    String(limit),
  ]);
  return Array.isArray(out) ? out : (out.messages ?? []);
}

export async function wxMembers(chat: string): Promise<WxMember[]> {
  const out = await wxJson<WxMember[] | { members?: WxMember[] }>(['members', chat]);
  return Array.isArray(out) ? out : (out.members ?? []);
}

export async function wxDaemonStatus(): Promise<WxDaemonStatus> {
  try {
    const out = await wxRaw(['daemon', 'status']);
    const lower = out.toLowerCase();
    const running = lower.includes('running') || lower.includes('运行');
    const pidMatch = out.match(/pid[^\d]*(\d+)/i);
    return {
      running,
      pid: pidMatch ? Number(pidMatch[1]) : undefined,
    };
  } catch {
    return { running: false };
  }
}

export async function wxAvailable(): Promise<boolean> {
  try {
    await run('wx', ['--version'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
