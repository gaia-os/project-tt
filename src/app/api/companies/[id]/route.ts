import { NextRequest, NextResponse } from 'next/server';
import { getCompanyById } from '@/lib/companyData';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';

interface CompanyRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest,
  context: CompanyRouteContext,
) {
  const topic = request.nextUrl.searchParams.get('topic') as TopicKey;

  if (!topic || !(await getTopic(topic))) {
    return NextResponse.json(
      { error: 'Invalid or missing topic parameter' },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { error: 'Missing company id parameter' },
      { status: 400 },
    );
  }

  try {
    const company = await getCompanyById(topic, decodeURIComponent(id));
    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    return NextResponse.json({ company });
  } catch (error) {
    console.error('Error fetching company details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch company details' },
      { status: 500 },
    );
  }
}
