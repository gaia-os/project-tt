import { NextResponse } from 'next/server';
import { listTopics } from '@/lib/topics.server';

// GET /api/topics -> [{ id, label }] for the tech-tree selector.
export async function GET() {
  const topics = await listTopics();
  return NextResponse.json(topics.map(({ id, label }) => ({ id, label })));
}
