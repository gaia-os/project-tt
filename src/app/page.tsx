'use client';

import { useEffect, useState } from 'react';
import { ExplorerWorkspace } from '@/components/ExplorerWorkspace';
import { TopicKey } from '@/lib/topicConfig';
import '@xyflow/react/dist/style.css';

interface TopicSummary {
  id: string;
  label: string;
}

export default function Home() {
  const [currentTopic, setCurrentTopic] = useState<TopicKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/investment-tech-tree/api/topics')
      .then((res) => res.json())
      .then((list: TopicSummary[]) => {
        setCurrentTopic(list.find((t) => t.id === 'smr')?.id ?? list[0]?.id ?? null);
        if (!list.length) setError('No tech tree datasets found — run scripts/seed-dataset.ts first.');
      })
      .catch(() => setError('Failed to load tech tree datasets.'));
  }, []);

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center text-gray-600">{error}</div>
    );
  }
  if (!currentTopic) {
    return <div className="h-screen" />;
  }
  return (
    <div className="h-screen">
      <ExplorerWorkspace
        topic={currentTopic}
        onTopicChange={(value) => setCurrentTopic(value)}
      />
    </div>
  );
}
