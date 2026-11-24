import { NextRequest, NextResponse } from 'next/server';

// LLM switching can take a while: a large model must be offloaded and the
// new one loaded on the Ollama host before the route can answer.
export const maxDuration = 300;
const SWITCH_TIMEOUT_MS = 280_000;

function serviceTarget(): { url: string; key: string } | NextResponse {
  const url = process.env.KG_SERVICE_URL;
  const key = process.env.KG_API_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: 'KG service is not configured (KG_SERVICE_URL / KG_API_KEY)' },
      { status: 503 },
    );
  }
  return { url: url.replace(/\/$/, ''), key };
}

// GET -> { models: string[], current: string }
export async function GET() {
  const target = serviceTarget();
  if (target instanceof NextResponse) return target;
  try {
    const res = await fetch(`${target.url}/llm/models`, {
      headers: { 'X-API-Key': target.key },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data.error ?? `KG service error (HTTP ${res.status})` },
        { status: 502 },
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching LLM models:', error);
    return NextResponse.json(
      { error: 'Failed to reach the knowledge-graph service' },
      { status: 502 },
    );
  }
}

// POST { model } -> switches the active LLM on the kg-service: the old
// model is offloaded first, then the new one is loaded.
export async function POST(request: NextRequest) {
  const target = serviceTarget();
  if (target instanceof NextResponse) return target;
  try {
    const body = (await request.json()) as { model?: unknown };
    if (typeof body.model !== 'string' || !body.model.trim()) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 });
    }
    const res = await fetch(`${target.url}/llm/model`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': target.key,
      },
      body: JSON.stringify({ model: body.model.trim() }),
      signal: AbortSignal.timeout(SWITCH_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data.error ?? `KG service error (HTTP ${res.status})` },
        { status: res.status === 400 || res.status === 401 ? res.status : 502 },
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error switching LLM model:', error);
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    return NextResponse.json(
      {
        error: isTimeout
          ? 'Model switch timed out — the new model may still be loading.'
          : 'Failed to reach the knowledge-graph service',
      },
      { status: isTimeout ? 504 : 502 },
    );
  }
}
