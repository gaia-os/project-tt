import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { requireAdmin } from '@/lib/adminAuth';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';
import { isExperimentKey, PAPER_PART_SCOPE } from '@/lib/kgKeys';

// POST {nodeId, entityId, verdict: 'accept'|'reject', topic} — human curation
// verdicts live in kg_curations and are merged over kg_node_enrichment at
// read time, so they survive enrichment rebuilds.
export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const { nodeId, entityId, verdict, topic } = body;

    if (!nodeId || !entityId || !['accept', 'reject'].includes(verdict)) {
      return NextResponse.json({ error: 'Missing/invalid fields' }, { status: 400 });
    }
    // Paper parts (experiments) are curated globally under the '*' scope.
    if (nodeId === PAPER_PART_SCOPE && !isExperimentKey(entityId)) {
      return NextResponse.json({ error: 'Invalid paper part key' }, { status: 400 });
    }
    if (!topic || !(await getTopic(topic as TopicKey))) {
      return NextResponse.json({ error: 'Invalid topic' }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db((await getTopic(topic as TopicKey))!.dbName);

    await db.collection('kg_curations').updateOne(
      { techTreeNodeId: nodeId, entityId },
      {
        $set: {
          techTreeNodeId: nodeId,
          entityId,
          verdict,
          source: 'human',
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error saving curation:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
