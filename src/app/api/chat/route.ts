import { NextRequest, NextResponse } from 'next/server';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';
import { TechTree } from '@/lib/types';
import { formatChatContext, parseChatScope } from '@/lib/chatContext';

interface ChatRequestBody {
  message?: string;
  context?: TechTree;
  /** What `context` is: a pathway, custom tree, view… Absent = whole tree. */
  scope?: unknown;
  history?: unknown[];
  topic: TopicKey;
  fileData?: { base64: string; mimeType: string; fileName?: string };
  mode?: string;
}

/** Drops malformed nodes/edges instead of failing on them. */
function isTreeShaped(value: unknown): value is TechTree {
  if (!value || typeof value !== 'object') return false;
  const tree = value as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(tree.nodes)) return false;
  tree.nodes = tree.nodes.filter(
    (node) =>
      !!node &&
      typeof (node as { id?: unknown }).id === 'string' &&
      !!(node as { data?: unknown }).data &&
      typeof (node as { data: { label?: unknown } }).data.label === 'string',
  );
  tree.edges = Array.isArray(tree.edges)
    ? tree.edges.filter(
        (edge) =>
          !!edge &&
          typeof (edge as { source?: unknown }).source === 'string' &&
          typeof (edge as { target?: unknown }).target === 'string',
      )
    : [];
  return true;
}

// Agentic chat can take a while: deep-analysis mode allows up to 25 tool
// rounds on the KG service. maxDuration must exceed KG_TIMEOUT_MS so the
// fetch abort fires inside the function budget and returns a clean 504
// instead of a truncated stream.
export const maxDuration = 200;
const KG_TIMEOUT_MS = 180_000;

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
    const { message, context, scope, history, topic, fileData, mode } = body;

    if (!message && !fileData) {
      return NextResponse.json({ error: 'Message or file is required' }, { status: 400 });
    }
    const topicConfig = (await getTopic(topic as TopicKey))!;
    if (!topicConfig) {
      return NextResponse.json({ error: 'Invalid topic' }, { status: 400 });
    }

    // Condensed tech-tree context so the model knows the tree's vocabulary
    // (the KG remains the evidence source; the service appends this text).
    // A scope says the context is a selection (pathway, custom tree, view)
    // and adds its structure; without one this is the whole-tree text.
    const contextText = formatChatContext({
      systemPrompt: topicConfig.systemPrompt,
      topicLabel: topicConfig.label,
      context: isTreeShaped(context) ? context : undefined,
      scope: parseChatScope(scope),
    });

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
