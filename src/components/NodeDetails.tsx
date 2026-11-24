'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Compass, LucideIcon } from 'lucide-react';
import { LABEL_COLORS, UiNode, CompanyInfo } from '@/lib/types';
import { TopicKey } from '@/lib/topicConfig';
import { nodeRoleLabel } from '@/lib/nodeRoles';
import { NodeHistoryControls, NodeHistoryItem } from '@/hooks/useNodeHistory';
import { Manual } from './Manual';
import CompanyDetails from './CompanyDetails';
import { SmrNodeDetails } from './SmrNodeDetails';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export type NodeDetailsSubView = 'info' | 'companies';

type NodeDetailsProps = {
  selectedNode?: UiNode;
  topic: TopicKey;
  activeSubView: NodeDetailsSubView;
  onSubViewChange: (v: NodeDetailsSubView) => void;
  onSelectNode?: (nodeId: string) => void;
  onChooseTechnology?: () => void;
  /** Opens the guided pathway; the button shows on reactor concepts only. */
  onShowPathway?: (nodeId: string) => void;
  /** Back/forward through previously viewed nodes. */
  history?: NodeHistoryControls;
};

interface InfactAnalysis {
  probability?: string | number;
  uncertainty?: string | number;
  interpretation?: string;
}

const formatTextWithBreaks = (text: string): string => {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const formattedParagraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    formattedParagraphs.push(sentences.slice(i, i + 3).join(' '));
  }
  return formattedParagraphs.join('\n\n');
};

const HISTORY_LONG_PRESS_MS = 450;

/** A back/forward arrow that jumps one step on click, or opens the full
 *  list of jump targets in that direction after a long press. */
const HistoryNavButton = ({
  icon: Icon,
  direction,
  items,
  onJump,
}: {
  icon: LucideIcon;
  direction: 'back' | 'forward';
  items: NodeHistoryItem[];
  onJump: (delta: number) => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const clearPressTimer = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const nearest = items[0];
  const label =
    direction === 'back'
      ? nearest
        ? `Back to ${nearest.label}`
        : 'Back'
      : nearest
        ? `Forward to ${nearest.label}`
        : 'Forward';

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={items.length === 0}
          title={`${label} (hold for history)`}
          aria-label={label}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            // Keep the Radix trigger from opening the menu on press-down; it
            // should only open after a long press (or via keyboard).
            e.preventDefault();
            suppressClick.current = false;
            clearPressTimer();
            pressTimer.current = setTimeout(() => {
              pressTimer.current = null;
              suppressClick.current = true;
              setMenuOpen(true);
            }, HISTORY_LONG_PRESS_MS);
          }}
          onPointerUp={clearPressTimer}
          onPointerCancel={clearPressTimer}
          onPointerLeave={clearPressTimer}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            if (menuOpen) {
              setMenuOpen(false);
              return;
            }
            if (nearest) onJump(nearest.delta);
          }}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto max-w-72">
        {items.map((item) => (
          <DropdownMenuItem
            key={`${item.delta}:${item.id}`}
            className="truncate"
            onSelect={() => onJump(item.delta)}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const getProbabilityColor = (probabilityText: string): string => {
  let probValue = parseFloat(probabilityText.replace(/[^0-9.]/g, ''));
  if (probValue > 0 && probValue <= 1 && !probabilityText.includes('%')) probValue *= 100;
  if (isNaN(probValue)) return '';
  if (probValue < 20) return 'bg-red-600';
  if (probValue < 40) return 'bg-red-400';
  if (probValue < 60) return 'bg-yellow-400';
  if (probValue < 80) return 'bg-green-400';
  return 'bg-green-600';
};

const NodeDetails = ({
  selectedNode,
  topic,
  activeSubView,
  onSubViewChange,
  onSelectNode,
  onChooseTechnology,
  onShowPathway,
  history,
}: NodeDetailsProps) => {
  const [showInfactModal, setShowInfactModal] = useState(false);
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [modalCompany, setModalCompany] = useState<CompanyInfo | null>(null);

  // Fetch companies when the companies sub-view becomes active
  useEffect(() => {
    if (activeSubView !== 'companies' || !selectedNode) return;
    setCompaniesLoading(true);
    setCompanies([]);
    fetch(
      `/investment-tech-tree/api/companies?nodeId=${encodeURIComponent(selectedNode.id)}&topic=${topic}`,
    )
      .then((r) => r.json())
      .then((data) => setCompanies(data.companies ?? []))
      .catch(() => {})
      .finally(() => setCompaniesLoading(false));
  }, [activeSubView, selectedNode, topic]);

  if (!selectedNode) return <Manual onChooseTechnology={onChooseTechnology} />;

  const infactAnalysis = selectedNode.data?.infact_analysis as
    | InfactAnalysis
    | undefined;
  const infactStatus = selectedNode.data?.infact_status as string;
  let infactHtmlContent = selectedNode.data?.infact_analysis_html_content as string;

  const probabilityColorClass = infactAnalysis?.probability
    ? getProbabilityColor(String(infactAnalysis.probability))
    : '';

  if (infactHtmlContent && !infactHtmlContent.includes('viewport')) {
    infactHtmlContent = infactHtmlContent.replace(
      '<head>',
      `<head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
        <style>
          @media (max-width: 768px) {
            body { padding: 1rem !important; font-size: 14px !important; }
            .card { padding: 1rem !important; margin-bottom: 1rem !important; }
            .hypothesis { font-size: 1rem !important; padding: 0.75rem !important; }
            .probability { font-size: 2rem !important; }
            .uncertainty { font-size: 1rem !important; }
            .stats-grid { grid-template-columns: 1fr !important; gap: 0.75rem !important; }
            .evidence-grid { grid-template-columns: 1fr !important; }
            .chart-container { height: 300px !important; }
            h1 { font-size: 1.5rem !important; }
            h2 { font-size: 1.25rem !important; }
            h3 { font-size: 1.1rem !important; }
            h4 { font-size: 1rem !important; }
            pre { font-size: 0.75rem !important; overflow-x: auto !important; }
            .stat-value { font-size: 1.25rem !important; }
            .evidence-point { padding-left: 0.75rem !important; margin-bottom: 1.5rem !important; }
          }
        </style>
      `,
    );
  }

  return (
    <div className="p-4 flex flex-col h-full">
      {/* InFact HTML report modal */}
      {showInfactModal && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 bg-black bg-opacity-50 z-[9999] flex justify-center items-center p-0">
              <div className="bg-white rounded-none shadow-lg w-[90vw] h-[90vh] flex flex-col">
                <div className="flex justify-between items-center p-3 md:p-4 border-b border-gray-200 flex-shrink-0">
                  <h3 className="text-base md:text-lg font-bold truncate mr-2">InFact Analysis Details</h3>
                  <Button onClick={() => setShowInfactModal(false)} size="sm" className="flex-shrink-0">
                    Close
                  </Button>
                </div>
                <iframe
                  srcDoc={infactHtmlContent}
                  className="w-full flex-1 border-0"
                  title="Infact Analysis Report"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* Company deep-dive modal */}
      <Dialog open={!!modalCompany} onOpenChange={(open) => { if (!open) setModalCompany(null); }}>
        <DialogContent className="max-w-3xl p-0">
          <DialogTitle className="sr-only">
            {modalCompany?.canonical_name ?? 'Company Details'}
          </DialogTitle>
          {modalCompany && <CompanyDetails company={modalCompany} topic={topic} />}
        </DialogContent>
      </Dialog>

      <Card className="flex flex-col h-full">
        <CardHeader className="flex flex-row items-end justify-between space-y-0 pb-3 gap-4 border-b-2">
          <div className="flex items-end gap-2 min-w-0">
            {history && (history.back || history.forward) && (
              <div className="flex shrink-0 items-center gap-1">
                <HistoryNavButton
                  icon={ArrowLeft}
                  direction="back"
                  items={history.backItems}
                  onJump={history.jumpTo}
                />
                <HistoryNavButton
                  icon={ArrowRight}
                  direction="forward"
                  items={history.forwardItems}
                  onJump={history.jumpTo}
                />
              </div>
            )}
            <CardTitle className="text-lg font-bold">{selectedNode.data.label}</CardTitle>
          </div>
          <Badge
            variant="secondary"
            className={`bg-${LABEL_COLORS[selectedNode.data.nodeLabel]}`}
          >
            {nodeRoleLabel(selectedNode.data.nodeLabel)}
          </Badge>
        </CardHeader>

        {onShowPathway && selectedNode.data.nodeLabel === 'ReactorConcept' && (
          <div className="mx-4 mt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onShowPathway(selectedNode.id)}
              title={`Step through the prerequisites of ${selectedNode.data.label}`}
              className="gap-1.5"
            >
              <Compass className="h-4 w-4" aria-hidden />
              Show Pathway
            </Button>
          </div>
        )}

        {/* Sub-navigation */}
        <Tabs
          value={activeSubView}
          onValueChange={(v) => onSubViewChange(v as NodeDetailsSubView)}
          className="flex flex-col flex-1 min-h-0"
        >
          <TabsList className="mx-4 mt-3 mb-0 h-8 grid grid-cols-2">
            <TabsTrigger value="info" className="text-xs">Node Info</TabsTrigger>
            <TabsTrigger value="companies" className="text-xs">Associated Companies</TabsTrigger>
          </TabsList>

          {/* Node Info sub-view */}
          <TabsContent value="info" className="flex-1 overflow-auto mt-0">
            {selectedNode.data.smr ? (
              <CardContent className="pt-4">
                <SmrNodeDetails
                  nodeId={selectedNode.id}
                  topic={topic}
                  onSelectNode={onSelectNode}
                  onSelectCompany={(companyId) => {
                    fetch(
                      `/investment-tech-tree/api/companies/${encodeURIComponent(companyId)}?topic=${topic}`,
                    )
                      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
                      .then((data) => setModalCompany(data.company))
                      .catch(() => {});
                  }}
                />
              </CardContent>
            ) : (
            <CardContent className="space-y-4 pt-4">
              {typeof selectedNode.data.trl_current === 'string' && (
                <div className="space-y-2 pb-2 border-b-2">
                  <h4 className="font-semibold text-sm text-gray-700">TRL Current</h4>
                  <p className="text-sm">{selectedNode.data.trl_current}</p>
                </div>
              )}

              {infactAnalysis && (
                <div className="space-y-2 pb-2 border-b-2">
                  <h4 className="font-semibold text-sm text-gray-700">TRL InFact Analysis</h4>
                  <div className="space-y-1 text-sm">
                    <p className="flex items-center gap-2">
                      <strong>TRL Probability:</strong>
                      {probabilityColorClass && (
                        <span
                          className={`inline-block w-3 h-3 rounded-full border border-white shadow-sm flex-shrink-0 ${probabilityColorClass}`}
                          title={`Confidence: ${infactAnalysis.probability}`}
                        />
                      )}
                      <span>{infactAnalysis.probability}</span>
                    </p>
                    <p><strong>Uncertainty:</strong> {infactAnalysis.uncertainty}</p>
                    <p><strong>Interpretation:</strong> {infactAnalysis.interpretation}</p>
                    <p><strong>InFact Analysis Status:</strong> {infactStatus}</p>
                  </div>
                  {infactHtmlContent && (
                    <Button
                      onClick={() => setShowInfactModal(true)}
                      size="sm"
                      className="mt-2"
                      variant="outline"
                    >
                      View InFact Analysis Report
                    </Button>
                  )}
                </div>
              )}

              {typeof selectedNode.data.subtype === 'string' && (
                <div className="space-y-2 pb-2 border-b-2">
                  <h4 className="font-semibold text-sm text-gray-700">Subtype</h4>
                  <p className="text-sm">{selectedNode.data.subtype}</p>
                </div>
              )}

              {typeof selectedNode.data.trl_projected_5_10_years === 'string' && (
                <div className="space-y-2 pb-2 border-b-2">
                  <h4 className="font-semibold text-sm text-gray-700">TRL Projected (5-10 years)</h4>
                  <p className="text-sm">{selectedNode.data.trl_projected_5_10_years}</p>
                </div>
              )}

              {typeof selectedNode.data.detailedDescription === 'string' && (
                <div className="space-y-2">
                  <Accordion type="single" collapsible>
                    <AccordionItem value="description">
                      <AccordionTrigger className="text-sm font-semibold text-gray-700">
                        Description
                      </AccordionTrigger>
                      <AccordionContent>
                        <p className="text-sm text-gray-600 whitespace-pre-line">
                          {formatTextWithBreaks(selectedNode.data.detailedDescription)}
                        </p>
                      </AccordionContent>
                    </AccordionItem>
                    {Array.isArray(selectedNode.data.references) && (
                      <AccordionItem value="references">
                        <AccordionTrigger className="text-sm font-semibold text-gray-700">
                          References
                        </AccordionTrigger>
                        <AccordionContent>
                          <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                            {selectedNode.data.references.map((ref: string, idx: number) => {
                              const isLink = /^(https?:\/\/|doi:|arxiv:)/i.test(ref);
                              return (
                                <li key={idx} className="break-words">
                                  {isLink ? (
                                    <a
                                      href={ref.startsWith('http') ? ref : undefined}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 hover:underline"
                                    >
                                      {ref}
                                    </a>
                                  ) : (
                                    <span>{ref}</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </AccordionContent>
                      </AccordionItem>
                    )}
                  </Accordion>
                </div>
              )}
            </CardContent>
            )}
          </TabsContent>

          {/* Associated Companies sub-view */}
          <TabsContent value="companies" className="flex-1 overflow-auto mt-0">
            <div className="px-4 pt-4 pb-2">
              {companiesLoading ? (
                <p className="text-sm text-gray-500">Loading companies…</p>
              ) : companies.length === 0 ? (
                <p className="text-sm text-gray-500">No associated companies found for this node.</p>
              ) : (
                <>
                  <p className="text-xs text-gray-400 mb-3">{companies.length} companies</p>
                  <Accordion type="single" collapsible className="w-full">
                    {companies.map((company) => (
                      <AccordionItem key={company.id} value={company.id}>
                        <AccordionTrigger className="text-sm text-left">
                          <span className="flex flex-wrap items-center gap-2">
                            {company.canonical_name}
                            {company.is_primary && (
                              <Badge className="bg-yellow-400 text-yellow-900 text-[10px] px-1 py-0">
                                Primary
                              </Badge>
                            )}
                            {company.relation_method && (
                              <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                {company.relation_method}
                              </Badge>
                            )}
                            {Array.isArray(company.relation_roles) &&
                              (company.relation_roles as string[]).map((role) => (
                                <Badge
                                  key={role}
                                  variant="outline"
                                  className="text-[10px] px-1 py-0"
                                >
                                  {role.replace(/_/g, ' ')}
                                </Badge>
                              ))}
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-2 text-sm">
                            {company.description && (
                              <p className="italic text-gray-600 border-l-2 border-gray-200 pl-2 text-xs">
                                {company.description}
                              </p>
                            )}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-700">
                              {company.country_iso && (
                                <span><span className="font-medium">Country:</span> {company.country_iso}</span>
                              )}
                              {company.vc_funding_stage && (
                                <span><span className="font-medium">Stage:</span> {company.vc_funding_stage}</span>
                              )}
                              {company.funding_total_usd != null && (
                                <span>
                                  <span className="font-medium">Funding:</span>{' '}
                                  ${(company.funding_total_usd / 1_000_000).toFixed(1)}M
                                </span>
                              )}
                              {company.headcount_range && (
                                <span><span className="font-medium">Headcount:</span> {company.headcount_range}</span>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-1 h-7 text-xs"
                              onClick={() => setModalCompany(company)}
                            >
                              View Detailed Company Report
                            </Button>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
};

export default NodeDetails;
