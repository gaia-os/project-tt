import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';
import { getVoter, isValidTarget, rateLimited } from '@/lib/voterAuth';

const MAX_TARGETS = 500;

// POST {topic, targets: string[]} -> {votes: {targetId: {up, down, userVote}}}
// POST rather than GET so large paper dossiers don't hit URL length limits.
export async function POST(request: NextRequest) {
  try {
    if (rateLimited(request, 120)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { topic, targets } = await request.json();
    if (!topic || !(await getTopic(topic as TopicKey)) || !Array.isArray(targets) || !targets.length) {
      return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
    }
    if (targets.length > MAX_TARGETS) {
      return NextResponse.json({ error: `At most ${MAX_TARGETS} targets` }, { status: 413 });
    }
    const valid = [...new Set(targets.filter(isValidTarget))];

    const voter = getVoter(request, false);
    if ('error' in voter) return voter.error;

    const rows = valid.length
      ? await (await clientPromise)
          .db((await getTopic(topic as TopicKey))!.dbName)
          .collection('kg_votes')
          .find({ targetId: { $in: valid } }, { projection: { _id: 0, targetId: 1, voterId: 1, vote: 1 } })
          .toArray()
      : [];

    const votes: Record<string, { up: number; down: number; userVote: 'up' | 'down' | null }> = {};
    for (const t of valid) votes[t] = { up: 0, down: 0, userVote: null };
    for (const r of rows) {
      const v = votes[r.targetId];
      if (!v) continue;
      if (r.vote === 'up') v.up++;
      else if (r.vote === 'down') v.down++;
      if (voter.voterId && r.voterId === voter.voterId) v.userVote = r.vote;
    }

    return NextResponse.json({ votes });
  } catch (err) {
    console.error('Error fetching votes:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
