'use client';

import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { TopicKey, TopicSummary } from '@/lib/topicConfig';
import { summarizeTree } from '@/lib/technologyCatalog';
import { peekTechTree, prefetchTechTree, useTechTree } from '@/hooks/useTechTree';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { sectorCopyFor } from './sectors';

interface SectorStepProps {
  topics: TopicSummary[];
  currentTopic: TopicKey;
  onSelectSector: (topic: TopicKey) => void;
  onSkip: () => void;
}

export function SectorStep({ topics, currentTopic, onSelectSector, onSkip }: SectorStepProps) {
  return (
    <div className="animate-fade-rise flex h-full flex-col">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.22em] text-neutral-500">
            GAIA Lab
          </p>
          <p className="mt-1 text-[1.65rem] font-semibold tracking-[-0.04em] text-neutral-900 sm:text-[1.85rem]">
            Investment Tech Tree
          </p>
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="shrink-0 pt-1 text-[13px] text-neutral-500 transition hover:text-neutral-900"
        >
          Explore map
        </button>
      </header>

      <div className="mt-auto space-y-3 pb-2 pt-16 sm:pt-20">
        <DialogTitle className="max-w-[16ch] text-[2.35rem] font-semibold leading-[1.05] tracking-[-0.045em] text-neutral-900 sm:text-[2.75rem]">
          Follow one technology home.
        </DialogTitle>
        <DialogDescription className="max-w-[28ch] text-[15px] leading-relaxed text-neutral-500 sm:text-base">
          Pick a sector. Then choose a design we can walk from prerequisites to
          deployment.
        </DialogDescription>
      </div>

      <nav className="mt-10 space-y-1 border-t border-neutral-900/10 pt-2" aria-label="Sectors">
        {topics.map((topicItem, index) => (
          <div
            key={topicItem.id}
            className="animate-fade-rise"
            style={{
              animationDelay: `${100 + index * 70}ms`,
              animationFillMode: 'both',
            }}
          >
            <SectorChoice
              topic={topicItem.id}
              label={topicItem.label}
              isCurrent={topicItem.id === currentTopic}
              onSelect={onSelectSector}
            />
          </div>
        ))}
      </nav>
    </div>
  );
}

interface SectorChoiceProps {
  topic: TopicKey;
  label: string;
  isCurrent: boolean;
  onSelect: (topic: TopicKey) => void;
}

function SectorChoice({ topic, label, isCurrent, onSelect }: SectorChoiceProps) {
  const { tagline } = sectorCopyFor(topic);
  const [showCounts, setShowCounts] = useState(
    () => isCurrent || peekTechTree(topic) !== null,
  );
  const reveal = () => {
    prefetchTechTree(topic);
    setShowCounts(true);
  };

  return (
    <button
      type="button"
      onMouseEnter={reveal}
      onFocus={reveal}
      onClick={() => onSelect(topic)}
      className="group flex w-full items-baseline gap-4 border-b border-neutral-900/10 py-4 text-left transition duration-300 hover:border-neutral-900/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[1.35rem] font-semibold tracking-[-0.03em] text-neutral-900 transition group-hover:translate-x-0.5 sm:text-[1.5rem]">
          {label}
        </span>
        <span className="mt-1 block max-w-[36ch] text-[13px] leading-snug text-neutral-500">
          {tagline}
        </span>
        <span className="mt-1.5 block min-h-4 text-[11px] tracking-wide text-neutral-400">
          {showCounts && <SectorCounts topic={topic} />}
        </span>
      </span>
      <ArrowUpRight
        className="mt-1 h-5 w-5 shrink-0 text-neutral-300 transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-neutral-800"
        aria-hidden
      />
    </button>
  );
}

function SectorCounts({ topic }: { topic: TopicKey }) {
  const { techTree, error } = useTechTree(topic);
  if (error) return <>Counts unavailable</>;
  if (!techTree) return <span className="animate-pulse">Loading…</span>;
  if (techTree.nodes.length === 0) return <>No data loaded yet</>;

  const summary = summarizeTree(techTree);
  const parts: Array<[number, string, string]> = [
    [summary.concepts, 'concept', 'concepts'],
    [summary.milestones, 'milestone', 'milestones'],
    [summary.technologies, 'technology', 'technologies'],
  ];
  return (
    <>
      {parts
        .filter(([count]) => count > 0)
        .map(([count, singular, plural]) => `${count} ${count === 1 ? singular : plural}`)
        .join(' · ')}
    </>
  );
}
