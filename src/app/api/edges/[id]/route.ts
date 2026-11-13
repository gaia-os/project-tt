import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { requireAdmin } from '@/lib/adminAuth';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';

// DELETE - Delete an edge
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const edgeId = params.id;

    // Get topic from query parameters
    const topic = request.nextUrl.searchParams.get('topic') as TopicKey;
    if (!topic || !(await getTopic(topic))) {
      return NextResponse.json(
        { error: 'Invalid or missing topic parameter' },
        { status: 400 }
      );
    }

    const topicConfig = (await getTopic(topic))!;

    const client = await clientPromise;
    const db = client.db(topicConfig.dbName); // Dynamic database selection
    const edgesCollection = db.collection('edges');

    // Check if edge exists
    const existing = await edgesCollection.findOne({ id: edgeId });
    if (!existing) {
      return NextResponse.json(
        { error: 'Edge not found' },
        { status: 404 }
      );
    }

    // Delete the edge
    await edgesCollection.deleteOne({ id: edgeId });

    return NextResponse.json(
      { success: true, message: 'Edge deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting edge:', error);
    return NextResponse.json(
      { error: 'Failed to delete edge' },
      { status: 500 }
    );
  }
}