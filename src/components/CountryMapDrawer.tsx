'use client';

import { useMemo, useState } from 'react';
import { Building2, Factory, MapPin, Network, Search, X } from 'lucide-react';
import {
  CompanySummary,
  CompanyTechnologyMapping,
  GeographyLayer,
  TechTree,
} from '@/lib/types';
import {
  buildTechnologyDistribution,
  CompanyLocationGroup,
  CountryCompanyAggregate,
} from '@/lib/geography';
import { isReactorNode } from '@/lib/reactorEntities';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface CountryMapDrawerProps {
  aggregate: CountryCompanyAggregate;
  layer: GeographyLayer;
  mappings: CompanyTechnologyMapping[];
  techTree: TechTree | null;
  verifiedLocations: CompanyLocationGroup[];
  onClose: () => void;
  onShowCompany: (company: CompanySummary) => void;
  onShowTechnology: (technologyId: string) => void;
  /** Prefer for reactor designs so the world view keeps map context. */
  onShowReactor?: (technologyId: string, label: string) => void;
}

export function CountryMapDrawer({
  aggregate,
  layer,
  mappings,
  techTree,
  verifiedLocations,
  onClose,
  onShowCompany,
  onShowTechnology,
  onShowReactor,
}: CountryMapDrawerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const filteredCompanies = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) return aggregate.companies;
    return aggregate.companies.filter(
      (company) =>
        company.canonical_name.toLowerCase().includes(normalized) ||
        company.primary_approach?.toLowerCase().includes(normalized),
    );
  }, [aggregate.companies, searchTerm]);
  const technologies = useMemo(
    () =>
      buildTechnologyDistribution(aggregate.companies, mappings, techTree),
    [aggregate.companies, mappings, techTree],
  );
  const verifiedCompanyIds = useMemo(
    () =>
      new Set(
        verifiedLocations.flatMap((location) =>
          location.companies.map((company) => company.id),
        ),
      ),
    [verifiedLocations],
  );
  const countryLevelOnlyCount = aggregate.companies.filter(
    (company) => !verifiedCompanyIds.has(company.id),
  ).length;

  return (
    <div className="glass-sheet flex h-full flex-col overflow-hidden">
      <header className="border-b border-neutral-200/70 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
              {layer === 'headquarters' ? (
                <MapPin className="h-3.5 w-3.5" />
              ) : (
                <Factory className="h-3.5 w-3.5" />
              )}
              {layer === 'headquarters' ? 'Headquarters' : 'Manufacturing'}
            </div>
            <h2 className="mt-1.5 truncate text-xl font-semibold tracking-tight text-neutral-900">
              {aggregate.countryName}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className="rounded-full bg-neutral-100 text-neutral-700"
            >
              {aggregate.countryIso}
            </Badge>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 w-8 rounded-full p-0"
              onClick={onClose}
              aria-label="Close country drawer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[13px] text-neutral-500">
          {aggregate.companies.length}{' '}
          {aggregate.companies.length === 1 ? 'company' : 'companies'} ·{' '}
          {technologies.length} mapped technologies
        </p>
        {layer === 'headquarters' && (
          <p className="mt-1 text-[11px] text-neutral-400">
            {verifiedCompanyIds.size} city-verified · {countryLevelOnlyCount}{' '}
            country-level only
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-neutral-500" />
            <h3 className="text-[13px] font-semibold text-neutral-900">
              Companies
            </h3>
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search this country"
              className="h-10 w-full rounded-xl border border-neutral-200/80 bg-white/70 pl-10 pr-3 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
            />
          </label>
          <div className="mt-3 space-y-2">
            {filteredCompanies.map((company) => (
              <button
                key={company.id}
                type="button"
                className="choice-row"
                onClick={() => onShowCompany(company)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-neutral-900">
                    {company.canonical_name}
                  </p>
                  <p className="truncate text-[12px] text-neutral-500">
                    {company.primary_approach ?? 'Approach not specified'}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="shrink-0 rounded-full bg-neutral-100 text-neutral-600"
                >
                  Open
                </Badge>
              </button>
            ))}
            {filteredCompanies.length === 0 && (
              <p className="py-4 text-center text-sm text-neutral-500">
                No companies match this search.
              </p>
            )}
          </div>
        </section>

        {layer === 'headquarters' && verifiedLocations.length > 0 && (
          <section className="mt-6 border-t border-neutral-200/70 pt-5">
            <div className="mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-orange-500" />
              <h3 className="text-[13px] font-semibold text-neutral-900">
                Verified city locations
              </h3>
            </div>
            <div className="space-y-2">
              {verifiedLocations.map((location) => (
                <div
                  key={location.key}
                  className="rounded-2xl border border-orange-100/80 bg-orange-50/50 px-3.5 py-3"
                >
                  <p className="text-[14px] font-medium text-neutral-900">
                    {location.label}
                  </p>
                  <p className="mt-1 text-[12px] text-neutral-500">
                    {location.companies
                      .map((company) => company.canonical_name)
                      .join(', ')}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-6 border-t border-neutral-200/70 pt-5">
          <div className="mb-3 flex items-center gap-2">
            <Network className="h-4 w-4 text-neutral-500" />
            <h3 className="text-[13px] font-semibold text-neutral-900">
              Technology distribution
            </h3>
          </div>
          <div className="space-y-2">
            {technologies.map((technology) => {
              const node = techTree?.nodes.find(
                (entry) => entry.id === technology.technologyId,
              );
              const reactor = isReactorNode(node);
              return (
                <button
                  key={technology.technologyId}
                  type="button"
                  className="choice-row"
                  onClick={() => {
                    if (reactor && onShowReactor) {
                      onShowReactor(technology.technologyId, technology.label);
                      return;
                    }
                    onShowTechnology(technology.technologyId);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-neutral-900">
                      {technology.label}
                    </p>
                    {reactor && (
                      <p className="text-[11px] text-sky-700">
                        Reactor design · linked organisations
                      </p>
                    )}
                  </div>
                  <Badge
                    variant="secondary"
                    className="shrink-0 rounded-full bg-neutral-100 text-neutral-600"
                  >
                    {technology.companyCount}
                  </Badge>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
