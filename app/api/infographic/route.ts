import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MODEL = 'gpt-image-2';

const BodySchema = z.object({
  apiKey: z.string().optional().default(''),
  baseUrl: z.string().optional().default(''),
  prompt: z.string().min(20),
  size: z.string().optional().default('1024x1536'),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
    }

    const apiKey = parsed.data.apiKey.trim() || process.env.WECHAT_RADAR_IMAGE_API_KEY || process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: '缺少 API Key' }, { status: 400 });
    }

    const endpoint = imageEndpoint(
      parsed.data.baseUrl.trim() || process.env.WECHAT_RADAR_IMAGE_BASE_URL || 'https://api.openai.com/v1',
    );
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        prompt: parsed.data.prompt,
        size: parsed.data.size,
        quality: 'auto',
      }),
    });

    const text = await response.text();
    const json = parseJson(text);
    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: errorMessage(json) || text || `图片生成失败 (${response.status})`,
        },
        { status: response.status },
      );
    }

    const image = extractImage(json);
    if (!image) {
      return NextResponse.json({ ok: false, error: '图片接口没有返回可识别的图片数据' }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      model: MODEL,
      image: image.startsWith('data:') || image.startsWith('http') ? image : `data:image/png;base64,${image}`,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : '图片生成失败' },
      { status: 500 },
    );
  }
}

function imageEndpoint(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, '');
  if (clean.endsWith('/images/generations')) return clean;
  if (clean.endsWith('/v1')) return `${clean}/images/generations`;
  return `${clean}/v1/images/generations`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorMessage(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as { error?: unknown };
  if (!obj.error) return null;
  if (typeof obj.error === 'string') return obj.error;
  if (typeof obj.error === 'object' && obj.error && 'message' in obj.error) {
    const message = (obj.error as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
  }
  return null;
}

function extractImage(json: unknown): string | null {
  const found = findImageValue(json, 0);
  return typeof found === 'string' && found.trim() ? found.trim() : null;
}

function findImageValue(value: unknown, depth: number): unknown {
  if (depth > 6 || !value) return null;
  if (typeof value === 'string') {
    if (value.startsWith('data:image/') || value.startsWith('http')) return value;
    if (/^[A-Za-z0-9+/=]{200,}$/.test(value)) return value;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageValue(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['b64_json', 'image_base64', 'base64', 'url']) {
      const found = findImageValue(obj[key], depth + 1);
      if (found) return found;
    }
    for (const item of Object.values(obj)) {
      const found = findImageValue(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}
