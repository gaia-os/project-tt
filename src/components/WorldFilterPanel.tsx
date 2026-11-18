'use client';

import { useState } from 'react';
import { ChevronDown, Filter, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  countActiveWorldFilters,
  EMPTY_WORLD_FILTERS,
  PowerClassOption,
  ReactorTypeOption,
  toggleWorldFilterValue,
  WorldFilterCatalog,
  WorldViewFilters,
} from '@/lib/worldFilters';

interface WorldFilterPanelProps {
  catalog: WorldFilterCatalog;
  filters: WorldViewFilters;
  matchCount: number;
  totalCount: number;
  onChange: (filters: WorldViewFilters) => void;
}

type FacetKey = keyof WorldViewFilters;

const FACET_META: Array<{
  key: FacetKey;
  label: string;
}> = [
  { key: 'reactorTypes', label: 'Reactor type' },
  { key: 'coolants', label: 'Coolant' },
  { key: 'spectra', label: 'Spectrum' },
  { key: 'powerClasses', label: 'Power class' },
  { key: 'countries', label: 'Country' },
  { key: 'statusLevels', label: 'Status' },
];

function OptionList<T extends string | number>({
  options,
  selected,
  onToggle,
}: {
  options: Array<{ value: T; label: string; count: number }>;
  selected: T[];
  onToggle: (value: T) => void;
}) {
  if (options.length === 0) {
    return (
      <p className="px-1 py-2 text-[12px] text-neutral-400">
        No values in this dataset.
      </p>
    );
  }

  return (
    <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto pr-1">
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onToggle(option.value)}
            className={cn(
              'flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12px] transition',
              isSelected
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-700 hover:bg-white/80',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            <span
              className={cn(
                'shrink-0 text-[10px]',
                isSelected ? 'text-white/60' : 'text-neutral-400',
              )}
            >
              {option.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function chipLabel(
  key: FacetKey,
  value: string | number,
  catalog: WorldFilterCatalog,
): string {
  const lists = {
    reactorTypes: catalog.reactorTypes,
    coolants: catalog.coolants,
    spectra: catalog.spectra,
    powerClasses: catalog.powerClasses,
    countries: catalog.countries,
    statusLevels: catalog.statusLevels,
  } as const;
  const match = lists[key].find((option) => option.value === value);
  return match?.label ?? String(value);
}

export function WorldFilterPanel({
  catalog,
  filters,
  matchCount,
  totalCount,
  onChange,
}: WorldFilterPanelProps) {
  const [openFacet, setOpenFacet] = useState<FacetKey | null>('reactorTypes');
  const activeCount = countActiveWorldFilters(filters);

  const patch = <K extends FacetKey>(key: K, values: WorldViewFilters[K]) => {
    onChange({ ...filters, [key]: values });
  };

  const chips: Array<{ key: FacetKey; value: string | number; label: string }> =
    [];
  for (const facet of FACET_META) {
    for (const value of filters[facet.key] as Array<string | number>) {
      chips.push({
        key: facet.key,
        value,
        label: chipLabel(facet.key, value, catalog),
      });
    }
  }

  const optionsFor = (key: FacetKey) => {
    switch (key) {
      case 'reactorTypes':
        return catalog.reactorTypes.length > 0
          ? catalog.reactorTypes
          : (
              [
                'PWR',
                'BWR',
                'Molten salt',
                'HTGR',
                'Fast reactor',
                'Microreactor',
              ] as ReactorTypeOption[]
            ).map((value) => ({ value, label: value, count: 0 }));
      case 'coolants':
        return catalog.coolants;
      case 'spectra':
        return catalog.spectra;
      case 'powerClasses':
        return catalog.powerClasses.length > 0
          ? catalog.powerClasses
          : (
              [
                'Micro (<20 MWe)',
                'Small (20–300 MWe)',
                'Medium (300–700 MWe)',
                'Large (≥700 MWe)',
              ] as PowerClassOption[]
            ).map((value) => ({ value, label: value, count: 0 }));
      case 'countries':
        return catalog.countries;
      case 'statusLevels':
        return catalog.statusLevels;
    }
  };

  return (
    <div className="mt-3 border-t border-neutral-200/80 pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-neutral-400" />
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
            Filters
          </p>
          {activeCount > 0 && (
            <Badge
              variant="secondary"
              className="h-5 rounded-full bg-neutral-900 px-1.5 text-[10px] text-white hover:bg-neutral-900"
            >
              {activeCount}
            </Badge>
          )}
        </div>
        {activeCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-neutral-500"
            onClick={() => onChange(EMPTY_WORLD_FILTERS)}
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}
      </div>

      <p className="mb-2 text-[11px] text-neutral-400">
        {matchCount} of {totalCount} companies
        {activeCount > 0 ? ' match' : ''}
      </p>

      {chips.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button
              key={`${chip.key}:${String(chip.value)}`}
              type="button"
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-neutral-900 px-2.5 py-1 text-[11px] text-white transition hover:bg-neutral-700"
              onClick={() => {
                const current = filters[chip.key] as Array<string | number>;
                patch(
                  chip.key,
                  toggleWorldFilterValue(current, chip.value) as never,
                );
              }}
              title="Remove filter"
            >
              <span className="truncate">{chip.label}</span>
              <X className="h-3 w-3 shrink-0 opacity-70" />
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1">
        {FACET_META.map((facet) => {
          const selectedCount = (filters[facet.key] as unknown[]).length;
          const isOpen = openFacet === facet.key;
          return (
            <div
              key={facet.key}
              className="overflow-hidden rounded-xl bg-white/45"
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                onClick={() =>
                  setOpenFacet((current) =>
                    current === facet.key ? null : facet.key,
                  )
                }
                aria-expanded={isOpen}
              >
                <span className="flex-1 text-[12px] font-medium text-neutral-800">
                  {facet.label}
                </span>
                {selectedCount > 0 && (
                  <span className="text-[10px] font-medium text-sky-700">
                    {selectedCount}
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 text-neutral-400 transition',
                    isOpen && 'rotate-180',
                  )}
                />
              </button>
              {isOpen && (
                <div className="px-1.5 pb-2">
                  <OptionList
                    options={optionsFor(facet.key) as Array<{
                      value: string | number;
                      label: string;
                      count: number;
                    }>}
                    selected={filters[facet.key] as Array<string | number>}
                    onToggle={(value) => {
                      const current = filters[facet.key] as Array<
                        string | number
                      >;
                      patch(
                        facet.key,
                        toggleWorldFilterValue(current, value) as never,
                      );
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
