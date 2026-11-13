import { NextRequest, NextResponse } from 'next/server';
import { getCompanyViewData } from '@/lib/companyData';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';

export async function GET(request: NextRequest) {
  const topic = request.nextUrl.searchParams.get('topic') as TopicKey;

  if (!topic || !(await getTopic(topic))) {
    return NextResponse.json(
      { error: 'Invalid or missing topic parameter' },
      { status: 400 },
    );
  }

  try {
    const response = await getCompanyViewData(topic);
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching company view data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch company view data' },
      { status: 500 },
    );
  }
}
