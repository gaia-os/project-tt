'use client';

import { useEffect, useState } from 'react';
import { Network } from 'lucide-react';
import { CompanyInfo, CompanySummary } from '@/lib/types';
import { TopicKey } from '@/lib/topicConfig';
import CompanyDetails from './CompanyDetails';
import { LoadingSpinner } from './LoadingSpinner';
import { Button } from '@/components/ui/button';

interface CompanySelectionDetailsProps {
  company: CompanySummary | CompanyInfo;
  topic: TopicKey;
  onShowInCompanyGraph?: (company: CompanySummary | CompanyInfo) => void;
  onShowTechnology: (technologyId: string) => void;
  embedded?: boolean;
}

export function CompanySelectionDetails({
  company,
  topic,
  onShowInCompanyGraph,
  onShowTechnology,
  embedded = false,
}: CompanySelectionDetailsProps) {
  const [details, setDetails] = useState<CompanyInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setDetails(null);

    fetch(
      `/investment-tech-tree/api/companies/${encodeURIComponent(company.id)}?topic=${topic}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load company details');
        return response.json() as Promise<{ company: CompanyInfo }>;
      })
      .then((response) => setDetails(response.company))
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load company details',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [company.id, topic]);

  const displayedCompany = details ?? (company as CompanyInfo);
  const primaryTechnology =
    typeof displayedCompany.tech_tree_primary_node === 'string'
      ? displayedCompany.tech_tree_primary_node
      : null;

  return (
    <div className="flex h-full flex-col">
      {(!embedded || error) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 p-3">
          {!embedded && onShowInCompanyGraph && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => onShowInCompanyGraph(company)}
            >
              <Network className="h-4 w-4" />
              Show in Company view
            </Button>
          )}
          {!embedded && primaryTechnology && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onShowTechnology(primaryTechnology)}
            >
              Open primary technology
            </Button>
          )}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {isLoading && !details ? (
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : (
          <CompanyDetails company={displayedCompany} topic={topic} />
        )}
      </div>
    </div>
  );
}
