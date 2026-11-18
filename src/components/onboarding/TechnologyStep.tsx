'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowUpRight, Search } from 'lucide-react';
import { TopicKey } from '@/lib/topicConfig';
import {
  buildTechnologyCatalog,
  suggestTechnologies,
  TechnologyCatalogEntry,
} from '@/lib/technologyCatalog';
import { useTechTree } from '@/hooks/useTechTree';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { sectorCopyFor } from './sectors';

interface TechnologyStepProps {
  topic: TopicKey;
  sectorLabel: string;
  lastTechnologyId: string | null;
  onBack: () => void;
  onSkip: () => void;
  onSelectTechnology: (technologyId: string) => void;
}

export function TechnologyStep({
  topic,
  sectorLabel,
  lastTechnologyId,
  onBack,
  onSkip,
  onSelectTechnology,
}: TechnologyStepProps) {
  const { techTree, isLoading, error, retry } = useTechTree(topic);
  const [query, setQuery] = useState('');
  const [browsingAll, setBrowsingAll] = useState(false);

  const catalog = useMemo(
    () => (techTree ? buildTechnologyCatalog(techTree) : []),
    [techTree],
  );
  const suggested = useMemo(
    () => suggestTechnologies(catalog, lastTechnologyId, 5),
    [catalog, lastTechnologyId],
  );
  const visible = useMemo(() => {
    const source = browsingAll ? catalog : suggested;
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return browsingAll
        ? [...source].sort((a, b) => a.label.localeCompare(b.label))
        : source;
    }
    return source.filter((entry) =>
      [entry.label, entry.category, entry.blurb].some((text) =>
        text?.toLowerCase().includes(needle),
      ),
    );
  }, [browsingAll, catalog, suggested, query]);

  const { pickerNoun } = sectorCopyFor(topic);

  return (
    <div className="animate-fade-rise flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 inline-flex items-center gap-1.5 text-[13px] text-neutral-500 transition hover:text-neutral-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Sectors
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="text-[13px] text-neutral-500 transition hover:text-neutral-900"
        >
          Explore map
        </button>
      </header>

      <div className="mt-8 shrink-0 space-y-2 sm:mt-10">
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.22em] text-neutral-500">
          {sectorLabel}
        </p>
        <DialogTitle className="max-w-[14ch] text-[2.1rem] font-semibold leading-[1.05] tracking-[-0.045em] text-neutral-900 sm:text-[2.45rem]">
          Which path will you follow?
        </DialogTitle>
        <DialogDescription className="max-w-[32ch] text-[15px] leading-relaxed text-neutral-500">
          One {pickerNoun}. We stage its prerequisites and
          walk them with you.
        </DialogDescription>
      </div>

      <div className="mt-8 flex min-h-0 flex-1 flex-col">
        {error ? (
          <div className="mt-2 space-y-3 border-t border-neutral-900/10 pt-6">
            <p className="flex items-center gap-2 text-[15px] font-medium text-red-800">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Couldn&apos;t load {sectorLabel}
            </p>
            <p className="text-sm text-red-700">{error}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={retry}>
                Try again
              </Button>
              <Button size="sm" variant="outline" onClick={onBack}>
                Back to sectors
              </Button>
            </div>
          </div>
        ) : (
          <>
            {browsingAll && (
              <div className="relative mb-4 shrink-0">
                <Search
                  className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
                  aria-hidden
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search designs"
                  aria-label="Search technologies"
                  className="h-11 rounded-none border-0 border-b border-neutral-900/15 bg-transparent pl-7 shadow-none focus-visible:ring-0"
                />
              </div>
            )}

            <div className="mb-2 flex shrink-0 items-baseline justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">
                {isLoading
                  ? 'Loading'
                  : browsingAll
                    ? `${visible.length} designs`
                    : 'Suggested'}
              </p>
              {!isLoading && catalog.length > suggested.length && (
                <button
                  type="button"
                  className="text-[13px] text-neutral-700 underline-offset-4 transition hover:underline"
                  onClick={() => {
                    setBrowsingAll((current) => !current);
                    setQuery('');
                  }}
                >
                  {browsingAll ? 'Show less' : `Browse all ${catalog.length}`}
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-neutral-900/10">
              {isLoading &&
                Array.from({ length: 4 }, (_, index) => (
                  <div
                    key={index}
                    className="border-b border-neutral-900/10 py-5"
                  >
                    <div className="h-6 w-2/3 animate-pulse rounded bg-neutral-200/70" />
                    <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
                  </div>
                ))}

              {visible.map((entry, index) => (
                <div
                  key={entry.id}
                  className="animate-fade-rise"
                  style={{
                    animationDelay: `${50 + index * 45}ms`,
                    animationFillMode: 'both',
                  }}
                >
                  <TechnologyChoice
                    entry={entry}
                    isLastViewed={entry.id === lastTechnologyId}
                    onSelect={() => onSelectTechnology(entry.id)}
                  />
                </div>
              ))}

              {!isLoading && visible.length === 0 && (
                <p className="py-8 text-[14px] text-neutral-600">
                  {catalog.length === 0
                    ? `No deployment concepts yet for ${sectorLabel}.`
                    : 'Nothing matches that search.'}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TechnologyChoice({
  entry,
  isLastViewed,
  onSelect,
}: {
  entry: TechnologyCatalogEntry;
  isLastViewed: boolean;
  onSelect: () => void;
}) {
  const meta = [
    entry.category,
    entry.trl != null ? `TRL ${entry.trl}` : null,
    entry.prerequisiteCount > 0
      ? `${entry.prerequisiteCount} steps`
      : null,
    isLastViewed ? 'Last viewed' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex w-full items-baseline gap-4 border-b border-neutral-900/10 py-4 text-left transition duration-300',
        'hover:border-neutral-900/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[1.2rem] font-semibold tracking-[-0.03em] text-neutral-900 transition group-hover:translate-x-0.5 sm:text-[1.35rem]">
          {entry.label}
        </span>
        {meta && (
          <span className="mt-1 block text-[12px] text-neutral-500">{meta}</span>
        )}
        {entry.blurb && (
          <span className="mt-1.5 line-clamp-2 block text-[13px] leading-snug text-neutral-500">
            {entry.blurb}
          </span>
        )}
      </span>
      <span className="mt-1 flex shrink-0 items-center gap-1 text-[12px] font-medium text-neutral-400 transition group-hover:text-neutral-900">
        Follow
        <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}
