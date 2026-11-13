import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const nodeId = searchParams.get('nodeId');
    const topic = searchParams.get('topic') as TopicKey;

    if (!nodeId) {
      return NextResponse.json({ error: 'Missing nodeId parameter' }, { status: 400 });
    }

    if (!topic || !(await getTopic(topic))) {
      return NextResponse.json({ error: 'Invalid or missing topic parameter' }, { status: 400 });
    }

    const topicConfig = (await getTopic(topic))!;
    const client = await clientPromise;
    const db = client.db(topicConfig.dbName);

    const edges = await db
      .collection('company_tech_tree_edges')
      .find({ tech_tree_node_id: nodeId })
      .toArray();

    if (edges.length === 0) {
      return NextResponse.json({ companies: [] });
    }

    const companyIds = [...new Set(edges.map((e) => e.company_id as string))];

    const companiesDocs = await db
      .collection('tt_companies')
      .find({ id: { $in: companyIds } })
      .toArray();

    const result = companiesDocs.map((company) => {
      const edge = edges.find((e) => e.company_id === company.id);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _id, ...companyWithoutId } = company;
      return {
        ...companyWithoutId,
        is_primary: edge?.is_primary ?? false,
        relation_confidence: edge?.confidence ?? null,
        relation_method: edge?.method ?? null,
        relation_reasoning: edge?.reasoning ?? null,
      };
    });

    return NextResponse.json({ companies: result });
  } catch (err) {
    console.error('Error fetching companies:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
