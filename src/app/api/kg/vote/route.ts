import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';
import { attachVoterCookie, getVoter, isValidTarget, rateLimited } from '@/lib/voterAuth';

const indexed = new Set<string>();

// POST {targetId, vote: 'up'|'down'|null, topic}
// The voter is identified by the signed httpOnly cookie (issued on first vote),
// never by the request body. vote: null removes the voter's vote.
export async function POST(request: NextRequest) {
  try {
    if (rateLimited(request)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { targetId, vote, topic } = await request.json();
    if (!isValidTarget(targetId) || !topic || !(await getTopic(topic as TopicKey))) {
      return NextResponse.json({ error: 'Missing/invalid fields' }, { status: 400 });
    }
    if (vote !== null && vote !== 'up' && vote !== 'down') {
      return NextResponse.json({ error: 'Invalid vote' }, { status: 400 });
    }

    const voter = getVoter(request, true);
    if ('error' in voter) return voter.error;
    const voterId = voter.voterId!;

    const dbName = (await getTopic(topic as TopicKey))!.dbName;
    const col = (await clientPromise).db(dbName).collection('kg_votes');
    if (!indexed.has(dbName)) {
      await col.createIndex({ targetId: 1, voterId: 1 }, { unique: true });
      indexed.add(dbName);
    }

    if (vote === null) {
      await col.deleteOne({ targetId, voterId });
    } else {
      await col.updateOne(
        { targetId, voterId },
        { $set: { vote, updatedAt: new Date() } },
        { upsert: true },
      );
    }

    const [up, down] = await Promise.all([
      col.countDocuments({ targetId, vote: 'up' }),
      col.countDocuments({ targetId, vote: 'down' }),
    ]);

    const res = NextResponse.json({ up, down, userVote: vote });
    return voter.issue ? attachVoterCookie(res, voter.issue.cookie) : res;
  } catch (err) {
    console.error('Error saving vote:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
