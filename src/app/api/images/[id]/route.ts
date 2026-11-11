import { NextRequest, NextResponse } from 'next/server';
import { Binary } from 'mongodb';
import clientPromise from '@/lib/mongodb';
import { TOPICS, TopicKey } from '@/lib/topicConfig';

const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg']);

// GET /api/images/<id>?topic=smr -> raw image bytes stored as BSON Binary.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const topic = request.nextUrl.searchParams.get('topic') as TopicKey;

  if (!topic || !TOPICS[topic]) {
    return NextResponse.json({ error: 'Invalid or missing topic parameter' }, { status: 400 });
  }

  try {
    const client = await clientPromise;
    const image = await client
      .db(TOPICS[topic].dbName)
      .collection('images')
      .findOne({ id }, { projection: { data: 1, content_type: 1, sha1: 1 } });

    if (!image || !(image.data instanceof Binary)) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    const etag = `"${image.sha1 ?? id}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }

    const contentType = ALLOWED_CONTENT_TYPES.has(image.content_type)
      ? image.content_type
      : 'application/octet-stream';

    return new NextResponse(Buffer.from(image.data.buffer), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
        ETag: etag,
      },
    });
  } catch (error) {
    console.error('Error fetching image:', error);
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 });
  }
}
