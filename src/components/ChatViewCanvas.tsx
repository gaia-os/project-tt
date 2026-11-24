'use client';

import { useMemo, useRef, useState } from 'react';
import { Background, Controls, Edge } from '@xyflow/react';
import {
  ChatMention,
  CompanyInfo,
  CompanySummary,
  CompanyTechnologyMapping,
  DataNode,
  TechTree,
} from '@/lib/types';
import { TopicKey } from '@/lib/topicConfig';
import { CompanyDirectoryEntry } from '@/lib/companyGraph';
import {
  COMPANY_ROLE_LABELS,
  COMPANY_ROLE_ORDER,
  COMPANY_ROLE_STYLES,
  companyRole,
} from '@/lib/companyRoles';
import {
  MentionFlow,
  buildMentionFlowEdges,
  buildMentionFlowNodes,
} from './MentionFlow';
import { CompanyDirectoryCard } from './CompanyDirectoryCard';
import CompanyDetails from './CompanyDetails';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/*
 * ChatView's canvas: the entities mentioned in a chat answer, drawn as a
 * graph over the whole left pane. Clicking a node selects it, lights its
 * direct neighbours and opens the details tab on the right. Companies the
 * answer names are listed as Company-view cards in a column on the left;
 * clicking one opens its details in a pop-up.
 */

interface ChatViewCanvasProps {
  /** Tree nodes mentioned in the answer, in mention order. */
  nodes: DataNode[];
  /** Tree edges among `nodes` (see mentionEdges). */
  edges: Edge[];
  /** Company cards named in the answer, in mention order. */
  companies?: CompanyDirectoryEntry[];
  /** All company mappings, so the pop-up can list a company's designs. */
  companyMappings?: CompanyTechnologyMapping[];
  topic: TopicKey;
  techTree?: TechTree | null;
  /** Resolved KG entities with no node on this tree. */
  unmatched: ChatMention[];
  /** Also highlights the node on the underlying tree. */
  onSelect?: (nodeId: string) => void;
  onShowDetails: (nodeId: string) => void;
}

export function ChatViewCanvas({
  nodes,
  edges,
  companies = [],
  companyMappings,
  topic,
  techTree,
  unmatched,
  onSelect,
  onShowDetails,
}: ChatViewCanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalCompany, setModalCompany] = useState<CompanyInfo | null>(null);
  const companyRequestRef = useRef<string | null>(null);

  // Full profile from the API; the card's summary covers a failed request.
  const openCompany = (company: CompanySummary) => {
    companyRequestRef.current = company.id;
    fetch(
      `/investment-tech-tree/api/companies/${encodeURIComponent(company.id)}?topic=${topic}`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { company: CompanyInfo }) => data.company)
      .catch(() => company as CompanyInfo)
      .then((details) => {
        if (companyRequestRef.current === company.id) setModalCompany(details);
      });
  };
  const flowNodes = useMemo(
    () =>
      buildMentionFlowNodes(nodes, edges, {
        onShowDetails,
        selectedId,
        draggable: true,
      }),
    [nodes, edges, onShowDetails, selectedId],
  );
  const flowEdges = useMemo(
    () => buildMentionFlowEdges(edges, selectedId),
    [edges, selectedId],
  );
  const companyRoles = useMemo(
    () =>
      new Map(
        companies.map((entry) => [entry.company.id, companyRole(entry.mappings)]),
      ),
    [companies],
  );
  const legendRoles = COMPANY_ROLE_ORDER.filter((role) =>
    [...companyRoles.values()].includes(role),
  );

  if (nodes.length === 0 && companies.length === 0) {
    return (
      <div className="nowheel flex h-full w-full flex-col items-center justify-center gap-2 bg-gray-50 px-8 text-center">
        <div className="text-sm font-medium text-gray-600">
          Nothing to graph yet
        </div>
        <div className="max-w-md text-xs leading-relaxed text-gray-500">
          Ask the assistant about technologies, designs or organisations —
          entities it names that exist on this tree are drawn here. The &ldquo;N
          on tree&rdquo; chip under an older answer replays its graph.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full">
      {companies.length > 0 && (
        <aside className="nowheel flex w-72 shrink-0 flex-col border-r border-gray-200 bg-white pt-28">
          <div className="border-b border-gray-200 px-3 pb-3">
            <h2 className="text-sm font-semibold text-gray-900">
              Companies in this answer
            </h2>
            <p className="text-xs text-gray-500">
              {companies.length}{' '}
              {companies.length === 1 ? 'company' : 'companies'}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {legendRoles.map((role) => (
                <span
                  key={role}
                  className="flex items-center gap-1 text-[10px] text-gray-600"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${COMPANY_ROLE_STYLES[role].dot}`}
                    aria-hidden
                  />
                  {COMPANY_ROLE_LABELS[role]}
                </span>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
            {companies.map(({ company, technologyCount }) => (
              <CompanyDirectoryCard
                key={company.id}
                company={company}
                technologyCount={technologyCount}
                isSelected={modalCompany?.id === company.id}
                role={companyRoles.get(company.id)}
                onClick={() => openCompany(company)}
              />
            ))}
          </div>
        </aside>
      )}

      <div className="relative min-w-0 flex-1">
        {nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-xs text-gray-500">
            No technologies or designs from this answer are on this tree.
          </div>
        ) : (
          <>
            <MentionFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodesDraggable
              onNodeClick={(nodeId) => {
                setSelectedId(nodeId);
                onSelect?.(nodeId);
                onShowDetails(nodeId);
              }}
              onPaneClick={() => setSelectedId(null)}
              className="bg-gray-50"
            >
              <Background gap={20} size={1} color="#e5e7eb" />
              <Controls showInteractive={false} position="bottom-right" />
            </MentionFlow>

            <div className="pointer-events-none absolute left-4 top-16 z-10 rounded-lg border border-gray-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm">
              In this answer · {nodes.length} node{nodes.length === 1 ? '' : 's'}
            </div>
          </>
        )}

        {unmatched.length > 0 && (
          <div className="pointer-events-none absolute bottom-20 left-4 z-10 max-w-md rounded-lg border border-gray-200 bg-white/95 px-3 py-1.5 text-[10px] leading-snug text-gray-500 shadow-sm">
            In the knowledge graph, not on this tree:{' '}
            {unmatched.map((mention) => mention.name).join(', ')}
          </div>
        )}
      </div>

      <Dialog
        open={!!modalCompany}
        onOpenChange={(open) => {
          if (open) return;
          companyRequestRef.current = null;
          setModalCompany(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto p-0">
          <DialogTitle className="sr-only">
            {modalCompany?.canonical_name ?? 'Company details'}
          </DialogTitle>
          {modalCompany && (
            <CompanyDetails
              company={modalCompany}
              topic={topic}
              mappings={companyMappings}
              techTree={techTree}
              onSelectDesign={(nodeId) => {
                setModalCompany(null);
                onShowDetails(nodeId);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
