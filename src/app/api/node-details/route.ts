import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';
import { readSmrInfactAnalysis } from '@/lib/infactAnalysis.server';
import { loadSmrInfactV2Analysis } from '@/lib/infactAnalysisV2.server';

// GET ?topic=smr&nodeId=smr:bwrx-300 -> rich node payload from `node_details`
// (404 when the topic has no details for that node).
export async function GET(request: NextRequest) {
  const topic = request.nextUrl.searchParams.get('topic') as TopicKey;
  const nodeId = request.nextUrl.searchParams.get('nodeId');

  const topicConfig = await getTopic(topic);
  if (!topic || !topicConfig) {
    return NextResponse.json(
      { error: 'Invalid or missing topic parameter' },
      { status: 400 },
    );
  }
  if (!nodeId) {
    return NextResponse.json(
      { error: 'Missing nodeId parameter' },
      { status: 400 },
    );
  }

  try {
    const client = await clientPromise;
    const details = await client
      .db(topicConfig.dbName)
      .collection('node_details')
      .findOne({ id: nodeId }, { projection: { _id: 0 } });

    if (!details) {
      return NextResponse.json(
        { error: 'No details for this node' },
        { status: 404 },
      );
    }

    const responseDetails = { ...details };
    if (details.kind === 'technology') {
      const infactV2 =
        typeof details.name === 'string'
          ? loadSmrInfactV2Analysis(nodeId, details.name)
          : null;
      responseDetails.infact_analysis =
        infactV2?.analysis ??
        (await readSmrInfactAnalysis(topicConfig.dbName, nodeId));
    }

    return NextResponse.json(responseDetails, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (error) {
    console.error('Error fetching node details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch node details' },
      { status: 500 },
    );
  }
}
