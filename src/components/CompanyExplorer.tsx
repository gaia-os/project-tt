'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Edge,
  NodeProps,
  ReactFlow,
  ReactFlowInstance,
} from '@xyflow/react';
import { Building2, ChevronRight, MapPin, Network, RotateCcw } from 'lucide-react';
import {
  CompanyGraphCompanyNodeData,
  CompanyGraphNode,
  CompanyGraphTechnologyNodeData,
  CompanySummary,
  CompanyViewResponse,
  PRODUCT_REGIONS,
  ProductRegion,
  TechTree,
  UiNode,
} from '@/lib/types';
import { TopicKey } from '@/lib/topicConfig';
import {
  buildCompanyDirectory,
  buildSelectedCompanyGraphProjection,
  CompanyDirectorySort,
  layoutCompanyGraph,
} from '@/lib/companyGraph';
import {
  CompanyGraphCompanyNode,
  CompanyGraphTechnologyNode,
} from './CompanyGraphNodes';
import { CompanySelectionDetails } from './CompanySelectionDetails';
import { LoadingSpinner } from './LoadingSpinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface CompanyExplorerProps {
  topic: TopicKey;
  isActive: boolean;
  data: CompanyViewResponse | null;
  techTree: TechTree | null;
  isLoading: boolean;
  error: string | null;
  selectedEntityId?: string;
  requestedFocusNodeId?: string | null;
  /** When set, the directory is already filtered to this technology id. */
  techFilter?: string | null;
  onSelectCompany: (company: CompanySummary) => void;
  onSelectTechnology: (node: UiNode) => void;
}

export function CompanyExplorer({
  topic,
  isActive,
  data,
  techTree,
  isLoading,
  error,
  selectedEntityId,
  requestedFocusNodeId,
  techFilter = null,
  onSelectCompany,
  onSelectTechnology,
}: CompanyExplorerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [region, setRegion] = useState<ProductRegion>('All');
  const [category, setCategory] = useState('All');
  const [primaryOnly, setPrimaryOnly] = useState(!techFilter);
  const [sort, setSort] = useState<CompanyDirectorySort>('name');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<CompanyGraphNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [isLayoutLoading, setIsLayoutLoading] = useState(false);
  const reactFlowInstanceRef = useRef<ReactFlowInstance<
    CompanyGraphNode,
    Edge
  > | null>(null);

  const categories = useMemo(() => {
    const values = new Set<string>(['All']);
    techTree?.nodes.forEach((node) => {
      if (typeof node.data.category === 'string') values.add(node.data.category);
    });
    return [...values].sort();
  }, [techTree]);

  const directory = useMemo(() => {
    if (!data?.available || !techTree) return [];
    return buildCompanyDirectory(
      data.companies,
      data.mappings,
      techTree,
      { searchTerm, region, category, primaryOnly },
      sort,
    );
  }, [
    data,
    techTree,
    searchTerm,
    region,
    category,
    primaryOnly,
    sort,
  ]);

  const requestedCompanyId =
    requestedFocusNodeId?.replace(/^company:/, '') ??
    selectedEntityId?.replace(/^company:/, '') ??
    null;

  useEffect(() => {
    if (
      requestedCompanyId &&
      directory.some((entry) => entry.company.id === requestedCompanyId)
    ) {
      setSelectedCompanyId(requestedCompanyId);
      return;
    }
    if (
      selectedCompanyId &&
      directory.some((entry) => entry.company.id === selectedCompanyId)
    ) {
      return;
    }
    setSelectedCompanyId(directory[0]?.company.id ?? null);
  }, [directory, selectedCompanyId, requestedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    document
      .getElementById(`company-row-${selectedCompanyId}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedCompanyId]);

  const selectedEntry = directory.find(
    (entry) => entry.company.id === selectedCompanyId,
  );
  const localProjection = useMemo(() => {
    if (!selectedEntry || !data?.available || !techTree) return null;
    return buildSelectedCompanyGraphProjection(
      selectedEntry.company,
      data.mappings,
      techTree,
      primaryOnly,
    );
  }, [selectedEntry, data, techTree, primaryOnly]);

  useEffect(() => {
    let cancelled = false;
    if (!localProjection) {
      setNodes([]);
      setEdges([]);
      return;
    }

    setIsLayoutLoading(true);
    void layoutCompanyGraph(localProjection)
      .then((layout) => {
        if (cancelled) return;
        setNodes(layout.nodes);
        setEdges(layout.edges);
      })
      .finally(() => {
        if (!cancelled) setIsLayoutLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [localProjection]);

  useEffect(() => {
    if (!isActive || nodes.length === 0) return;
    const timer = window.setTimeout(() => {
      void reactFlowInstanceRef.current?.fitView({
        padding: 0.25,
        minZoom: 0.5,
        maxZoom: 1.2,
        duration: 250,
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [nodes, isActive]);

  const selectTechnology = useCallback(
    (technologyId: string) => {
      const technology = techTree?.nodes.find((node) => node.id === technologyId);
      if (technology) {
        onSelectTechnology({ ...technology, position: { x: 0, y: 0 } });
      }
    },
    [techTree, onSelectTechnology],
  );

  const nodeTypes = useMemo(
    () => ({
      companyGraphCompany: (props: NodeProps) => (
        <CompanyGraphCompanyNode
          {...props}
          data={props.data as unknown as CompanyGraphCompanyNodeData}
          onShowDetails={() => {
            if (selectedEntry) onSelectCompany(selectedEntry.company);
          }}
        />
      ),
      companyGraphTechnology: (props: NodeProps) => (
        <CompanyGraphTechnologyNode
          {...props}
          data={props.data as unknown as CompanyGraphTechnologyNodeData}
          onShowDetails={selectTechnology}
        />
      ),
    }),
    [selectedEntry, onSelectCompany, selectTechnology],
  );

  const handleCompanySelection = (company: CompanySummary) => {
    setSelectedCompanyId(company.id);
    onSelectCompany(company);
  };

  const resetFilters = () => {
    setSearchTerm('');
    setRegion('All');
    setCategory('All');
    setPrimaryOnly(true);
    setSort('name');
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <LoadingSpinner />
      </div>
    );
  }
  if (error) {
    return <StatusMessage title="Unable to load company data" body={error} />;
  }
  if (data && !data.available) {
    return <StatusMessage title="Company view unavailable" body={data.reason} />;
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-50 md:flex-row">
      <aside className="flex h-[46%] w-full shrink-0 flex-col border-b border-gray-200 bg-white pt-28 md:h-full md:w-80 md:border-b-0 md:border-r">
        <div className="space-y-2 border-b border-gray-200 px-3 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Company directory
              </h2>
              <p className="text-xs text-gray-500">
                {directory.length} of{' '}
                {data?.available ? data.coverage.mappedCompanies : 0} companies
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label="Reset company filters"
              title="Reset filters"
              onClick={resetFilters}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search company or technology"
            className="h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />

          <div className="grid grid-cols-2 gap-2">
            <Select
              value={region}
              onValueChange={(value) => setRegion(value as ProductRegion)}
            >
              <SelectTrigger className="h-9 text-xs" aria-label="Headquarters region">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_REGIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === 'All' ? 'All regions' : option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9 text-xs" aria-label="Technology category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === 'All' ? 'All categories' : option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={primaryOnly ? 'primary' : 'all'}
              onValueChange={(value) => setPrimaryOnly(value === 'primary')}
            >
              <SelectTrigger className="h-9 text-xs" aria-label="Mapping scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="primary">Primary links</SelectItem>
                <SelectItem value="all">All links</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={sort}
              onValueChange={(value) => setSort(value as CompanyDirectorySort)}
            >
              <SelectTrigger className="h-9 text-xs" aria-label="Company sorting">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="trl">Highest TRL</SelectItem>
                <SelectItem value="funding">Most funding</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {directory.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">
              No companies match these filters.
            </div>
          ) : (
            <div className="space-y-1.5">
              {directory.map(({ company, technologyCount }) => {
                const isSelected = company.id === selectedCompanyId;
                return (
                  <button
                    key={company.id}
                    id={`company-row-${company.id}`}
                    type="button"
                    className={`w-full rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                    onClick={() => handleCompanySelection(company)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {company.canonical_name}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
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
              })}
            </div>
          )}
        </div>
      </aside>

      <section className="min-h-0 flex-1 overflow-y-auto">
        {!selectedEntry ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
              <Building2 className="mx-auto h-10 w-10 text-gray-300" />
              <h3 className="mt-3 font-semibold text-gray-900">Select a company</h3>
              <p className="mt-1 text-sm text-gray-500">
                Choose a company to inspect its profile and technology mappings.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-4 p-4 pb-24">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-amber-700" />
                    <h2 className="text-xl font-bold text-gray-900">
                      {selectedEntry.company.canonical_name}
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    {selectedEntry.company.primary_approach ??
                      'Primary approach not specified'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedEntry.company.country_iso && (
                    <Badge variant="secondary">
                      {selectedEntry.company.country_iso}
                    </Badge>
                  )}
                  <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">
                    {selectedEntry.technologyCount}{' '}
                    {selectedEntry.technologyCount === 1
                      ? 'technology'
                      : 'technologies'}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="relative h-72 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-gray-700 shadow-sm">
                <Network className="h-3.5 w-3.5" />
                Technology neighborhood
              </div>
              {isLayoutLoading && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60">
                  <LoadingSpinner />
                </div>
              )}
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onInit={(instance) => {
                  reactFlowInstanceRef.current = instance;
                }}
                nodesDraggable={false}
                nodesConnectable={false}
                fitView
                minZoom={0.35}
                maxZoom={1.5}
                className="h-full w-full"
              >
                <Background bgColor="white" variant={BackgroundVariant.Dots} />
              </ReactFlow>
            </div>

            <div className="min-h-[420px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <CompanySelectionDetails
                company={selectedEntry.company}
                topic={topic}
                mappings={data?.available ? data.mappings : []}
                techTree={techTree}
                embedded
                onShowTechnology={(technologyId) =>
                  selectTechnology(technologyId)
                }
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function StatusMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-white p-8">
      <div className="max-w-md rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm text-gray-600">{body}</p>
      </div>
    </div>
  );
}
