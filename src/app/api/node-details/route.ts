import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { TOPICS, TopicKey } from '@/lib/topicConfig';

// GET ?topic=smr&nodeId=smr:bwrx-300 -> rich node payload from `node_details`
// (404 when the topic has no details for that node).
export async function GET(request: NextRequest) {
  const topic = request.nextUrl.searchParams.get('topic') as TopicKey;
  const nodeId = request.nextUrl.searchParams.get('nodeId');

  if (!topic || !TOPICS[topic]) {
    return NextResponse.json({ error: 'Invalid or missing topic parameter' }, { status: 400 });
  }
  if (!nodeId) {
    return NextResponse.json({ error: 'Missing nodeId parameter' }, { status: 400 });
  }

  try {
    const client = await clientPromise;
    const details = await client
      .db(TOPICS[topic].dbName)
      .collection('node_details')
      .findOne({ id: nodeId }, { projection: { _id: 0 } });

    if (!details) {
      return NextResponse.json({ error: 'No details for this node' }, { status: 404 });
    }
    return NextResponse.json(details, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (error) {
    console.error('Error fetching node details:', error);
    return NextResponse.json({ error: 'Failed to fetch node details' }, { status: 500 });
  }
}
