import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { readSmrInfactAnalysisReport } from '@/lib/infactAnalysis.server';
import {
  loadSmrInfactV2Analysis,
  readSmrInfactV2Report,
} from '@/lib/infactAnalysisV2.server';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';

function htmlReportResponse(report: string): NextResponse {
  return new NextResponse(report, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

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
    let nodeLabel = request.nextUrl.searchParams.get('nodeLabel');
    if (!nodeLabel) {
      const client = await clientPromise;
      const details = await client
        .db(topicConfig.dbName)
        .collection('node_details')
        .findOne({ id: nodeId }, { projection: { _id: 0, name: 1 } });
      nodeLabel = typeof details?.name === 'string' ? details.name : null;
    }

    if (nodeLabel) {
      const infactV2 = loadSmrInfactV2Analysis(nodeId, nodeLabel);
      if (infactV2) {
        const report = readSmrInfactV2Report(infactV2);
        if (!report) {
          return NextResponse.json(
            { error: 'No InFact v2 report for this node' },
            { status: 404 },
          );
        }
        return htmlReportResponse(report);
      }
    }

    const report = await readSmrInfactAnalysisReport(
      topicConfig.dbName,
      nodeId,
    );
    if (!report) {
      return NextResponse.json(
        { error: 'No InFact report for this node' },
        { status: 404 },
      );
    }

    return htmlReportResponse(report);
  } catch (error) {
    console.error('Error fetching InFact analysis report:', error);
    return NextResponse.json(
      { error: 'Failed to fetch InFact analysis report' },
      { status: 500 },
    );
  }
}
