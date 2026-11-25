import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { readSmrInfactAnalysisReport } from '@/lib/infactAnalysis.server';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';

export async function GET(request: NextRequest) {
  const topic = request.nextUrl.searchParams.get('topic') as TopicKey;
  const nodeId = request.nextUrl.searchParams.get('nodeId');

  if (!topic || !(await getTopic(topic))) {
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
      .db((await getTopic(topic))!.dbName)
      .collection('node_details')
      .findOne({ id: nodeId }, { projection: { kind: 1, name: 1 } });

    if (
      !details ||
      details.kind !== 'technology' ||
      typeof details.name !== 'string'
    ) {
      return NextResponse.json(
        { error: 'No technology details for this node' },
        { status: 404 },
      );
    }

    const report = await readSmrInfactAnalysisReport(topic, details.name);
    if (!report) {
      return NextResponse.json(
        { error: 'No InFact report for this node' },
        { status: 404 },
      );
    }

    return new NextResponse(report, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'Content-Security-Policy':
          "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Error fetching InFact analysis report:', error);
    return NextResponse.json(
      { error: 'Failed to fetch InFact analysis report' },
      { status: 500 },
    );
  }
}
