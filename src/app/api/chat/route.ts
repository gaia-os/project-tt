import { NextRequest, NextResponse } from 'next/server';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';
import { TechTree } from '@/lib/types';

interface ChatRequestBody {
  message?: string;
  context?: TechTree;
  history?: unknown[];
  topic: TopicKey;
  fileData?: { base64: string; mimeType: string; fileName?: string };
  mode?: string;
}

// Agentic chat can take a while (multiple LLM + Cypher rounds on the KG
// service). On Vercel, hobby plans cap serverless duration regardless.
export const maxDuration = 60;
const KG_TIMEOUT_MS = 55_000;

// POST {message, context, history, topic, fileData, mode} -> {response}
// Proxies to the KG service (Neo4j + Ollama); the service does the agentic
// loop so every tool call stays on the KG server instead of crossing the
// tunnel per call.
export async function POST(request: NextRequest) {
  try {
    const serviceUrl = process.env.KG_SERVICE_URL;
    const apiKey = process.env.KG_API_KEY;
    if (!serviceUrl || !apiKey) {
      return NextResponse.json(
        { error: 'KG service is not configured (KG_SERVICE_URL / KG_API_KEY)' },
        { status: 503 },
      );
    }

    const body = (await request.json()) as ChatRequestBody;
    const { message, context, history, topic, fileData, mode } = body;

    if (!message && !fileData) {
      return NextResponse.json({ error: 'Message or file is required' }, { status: 400 });
    }
    const topicConfig = (await getTopic(topic as TopicKey))!;
    if (!topicConfig) {
      return NextResponse.json({ error: 'Invalid topic' }, { status: 400 });
    }

    // Condensed tech-tree context so the model knows the tree's vocabulary
    // (the KG remains the evidence source; the service appends this text).
    const nodesContext = (context?.nodes || [])
      .map(
        (n) =>
          `- ${n.data.label} [${n.id}] (category: ${n.data.category || 'n/a'}, ` +
          `TRL ${n.data.trl_current || 'n/a'}): ${n.data.detailedDescription || n.data.description || ''}`,
      )
      .join('\n');
    const contextText = `${topicConfig.systemPrompt}\n\nTECH TREE NODES:\n${nodesContext}`;

    // PDF upload -> document verification pipeline on the service.
    // Both endpoints are streamed (NDJSON: tool/progress events, text deltas, done).
    const isVerify = !!fileData?.base64;
    const endpoint = isVerify ? 'verify-document/stream' : 'chat/stream';
    const payload = isVerify
      ? {
          fileBase64: fileData.base64,
          fileName: fileData.fileName ?? 'document.pdf',
          question: message ?? '',
        }
      : {
          message,
          history: history ?? [],
          contextText,
          mode: mode === 'thinking' ? 'thinking' : 'instant',
        };

    const res = await fetch(`${serviceUrl.replace(/\/$/, '')}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(KG_TIMEOUT_MS),
    });

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error ?? `KG service error (HTTP ${res.status})` },
        { status: res.status === 401 || res.status === 429 ? res.status : 502 },
      );
    }

    // Pass the NDJSON stream straight through to the client.
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Error in chat API:', error);
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    return NextResponse.json(
      { error: isTimeout ? 'The knowledge graph took too long to answer — try a narrower question.' : 'Failed to reach the knowledge-graph service' },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
