'use client';

import { ChevronRight, MapPin } from 'lucide-react';
import { CompanySummary } from '@/lib/types';
import {
  COMPANY_ROLE_LABELS,
  COMPANY_ROLE_STYLES,
  CompanyRole,
} from '@/lib/companyRoles';
import { Badge } from '@/components/ui/badge';

interface CompanyDirectoryCardProps {
  company: CompanySummary;
  technologyCount: number;
  isSelected?: boolean;
  /** Colours the card by the company's role (ChatView). */
  role?: CompanyRole;
  onClick: () => void;
}

/** A company row as listed in the Company view's directory. */
export function CompanyDirectoryCard({
  company,
  technologyCount,
  isSelected = false,
  role,
  onClick,
}: CompanyDirectoryCardProps) {
  const roleStyle = role ? COMPANY_ROLE_STYLES[role] : null;
  return (
    <button
      id={`company-row-${company.id}`}
      type="button"
      className={`w-full rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:bg-gray-50'
      } ${roleStyle ? `border-l-4 ${roleStyle.accent}` : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">
            {company.canonical_name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
            {role && roleStyle && (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${roleStyle.chip}`}
              >
                {COMPANY_ROLE_LABELS[role]}
              </span>
            )}
            {company.country_iso && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {company.country_iso}
              </span>
            )}
            {company.trl_level != null && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                TRL {company.trl_level}
              </Badge>
            )}
          </div>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-gray-400" />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-gray-600">
          {company.primary_approach ?? 'Approach not specified'}
        </span>
        <span className="shrink-0 text-gray-400">
          {technologyCount}{' '}
          {technologyCount === 1 ? 'technology' : 'technologies'}
        </span>
      </div>
    </button>
  );
}
