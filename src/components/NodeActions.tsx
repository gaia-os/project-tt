'use client';

import React from 'react';
import { Button } from '@/components/ui/button';

interface NodeActionsProps {
  nodeId: string;
  onShowDetails: (nodeId: string) => void;
  onShowConnected: (nodeId: string) => void;
  onShowCompanies?: (nodeId: string) => void;
  companiesExpanded?: boolean;
  onShowLiterature?: (nodeId: string) => void;
  literatureExpanded?: boolean;
  literatureCount?: number;
}

export const NodeActions: React.FC<NodeActionsProps> = ({
  nodeId,
  onShowDetails,
  onShowConnected,
  onShowCompanies,
  companiesExpanded,
  onShowLiterature,
  literatureExpanded,
  literatureCount,
}) => {
  const handleShowDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    onShowDetails(nodeId);
  };

  const handleShowConnected = (e: React.MouseEvent) => {
    e.stopPropagation();
    onShowConnected(nodeId);
  };

  const handleShowCompanies = (e: React.MouseEvent) => {
    e.stopPropagation();
    onShowCompanies?.(nodeId);
  };

  const handleShowLiterature = (e: React.MouseEvent) => {
    e.stopPropagation();
    onShowLiterature?.(nodeId);
  };

  return (
    <div className="flex gap-1 opacity-100">
      {onShowLiterature && (
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 w-6 p-0 border shadow-sm ${
            literatureExpanded
              ? 'bg-indigo-100 border-indigo-400 hover:bg-indigo-200'
              : 'bg-white border-gray-200 hover:bg-gray-50'
          }`}
          onClick={handleShowLiterature}
          title={
            literatureExpanded
              ? 'Hide literature'
              : `Show literature${literatureCount ? ` (${literatureCount} papers)` : ''}`
          }
          aria-label={
            literatureExpanded
              ? 'Hide literature'
              : `Show literature${literatureCount ? ` (${literatureCount} papers)` : ''}`
          }
        >
          <svg
            className="h-3 w-3 text-indigo-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
        </Button>
      )}
      {onShowCompanies && (
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 w-6 p-0 border shadow-sm ${
            companiesExpanded
              ? 'bg-gray-200 border-gray-400 hover:bg-gray-300'
              : 'bg-white border-gray-200 hover:bg-gray-50'
          }`}
          onClick={handleShowCompanies}
          title={companiesExpanded ? 'Hide linked companies' : 'Show linked companies'}
          aria-label={
            companiesExpanded ? 'Hide linked companies' : 'Show linked companies'
          }
        >
          <svg
            className="h-3 w-3 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 bg-white border border-gray-200 shadow-sm hover:bg-gray-50"
        onClick={handleShowDetails}
        title="Show node details"
        aria-label="Show node details"
      >
        <svg
          className="h-3 w-3 text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 bg-white border border-gray-200 shadow-sm hover:bg-gray-50"
        onClick={handleShowConnected}
        title="Show connected nodes only"
        aria-label="Show connected nodes only"
      >
        <svg
          className="h-3 w-3 text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
          />
        </svg>
      </Button>
    </div>
  );
};
