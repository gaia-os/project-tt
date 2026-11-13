import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';
import { KgExperiment } from '@/lib/types';
import { experimentKeys, PAPER_PART_SCOPE } from '@/lib/kgKeys';

// Serves one materialized paper dossier (kg_papers collection).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> },
) {
  try {
    const { paperId } = await params;
    const topic = request.nextUrl.searchParams.get('topic') as TopicKey;

    if (!topic || !(await getTopic(topic))) {
      return NextResponse.json({ error: 'Invalid or missing topic parameter' }, { status: 400 });
    }
    if (!paperId) {
      return NextResponse.json({ error: 'Missing paperId' }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db((await getTopic(topic))!.dbName);

    const dossier = await db
      .collection('kg_papers')
      .findOne({ paperId }, { projection: { _id: 0 } });

    if (!dossier) {
      return NextResponse.json({ error: 'Paper not found' }, { status: 404 });
    }

    // Attach stable per-experiment keys (computed over the full list, before
    // filtering, so keys never shift) and hide experiments rejected by admins.
    const experiments: KgExperiment[] = dossier.experiments ?? [];
    const keys = experimentKeys(paperId, experiments);
    const rejected = new Set(
      (
        await db
          .collection('kg_curations')
          .find({ techTreeNodeId: PAPER_PART_SCOPE, entityId: { $in: keys }, verdict: 'reject' })
          .project({ entityId: 1 })
          .toArray()
      ).map((c) => c.entityId as string),
    );
    dossier.experiments = experiments
      .map((e, i) => ({ ...e, voteKey: keys[i] }))
      .filter((e) => !rejected.has(e.voteKey));

    return NextResponse.json(dossier);
  } catch (err) {
    console.error('Error fetching paper dossier:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
