import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';
import { KgEntity } from '@/lib/types';

// Serves the materialized KG enrichment produced by enrich.py
// (fusion_kg_builder). No live dependency on the KG server.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const nodeId = searchParams.get('nodeId');
    const topic = searchParams.get('topic') as TopicKey;

    if (!topic || !(await getTopic(topic))) {
      return NextResponse.json({ error: 'Invalid or missing topic parameter' }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db((await getTopic(topic))!.dbName);

    // Availability lookup: which nodes have enrichment (drives icon visibility).
    if (!nodeId) {
      const docs = await db
        .collection('kg_node_enrichment')
        .find(
          { 'entities.0': { $exists: true } },
          { projection: { techTreeNodeId: 1, 'meta.paper_count': 1, 'meta.weakMatch': 1, _id: 0 } },
        )
        .toArray();
      return NextResponse.json({
        enrichedNodes: docs.map((d) => ({
          nodeId: d.techTreeNodeId,
          papers: d.meta?.paper_count ?? 0,
          weakMatch: d.meta?.weakMatch ?? false,
        })),
      });
    }

    const doc = await db
      .collection('kg_node_enrichment')
      .findOne({ techTreeNodeId: nodeId }, { projection: { _id: 0 } });

    if (!doc) {
      return NextResponse.json({ entities: [], meta: { enriched: false } });
    }

    // Apply human curations: 'reject' moves an entity out of the overlay,
    // 'accept' resurrects one from meta.rejected.
    const curations = await db
      .collection('kg_curations')
      .find({ techTreeNodeId: nodeId })
      .toArray();
    const verdicts = new Map(curations.map((c) => [c.entityId, c.verdict]));

    let entities = ((doc.entities ?? []) as KgEntity[]).filter(
      (entity) => verdicts.get(entity.id) !== 'reject',
    );
    const resurrected = ((doc.meta?.rejected ?? []) as KgEntity[]).filter(
      (entity) => verdicts.get(entity.id) === 'accept',
    );
    entities = [...entities, ...resurrected];

    if (!entities.length) {
      return NextResponse.json({ entities: [], meta: { enriched: false } });
    }

    return NextResponse.json({ entities, meta: doc.meta });
  } catch (err) {
    console.error('Error fetching KG enrichment:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
