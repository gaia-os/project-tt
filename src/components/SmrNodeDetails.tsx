'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Maximize2 } from 'lucide-react';
import {
  SmrImageRef,
  SmrNodeDetails as SmrNodeDetailsData,
  SmrNodeRef,
  SmrReactorDetails,
  SmrTechnologyDetails,
} from '@/lib/types';
import { TopicKey } from '@/lib/topicConfig';
import { topicImageUrl } from '@/lib/smrImages';
import { getCountryName } from '@/lib/geography';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface SmrNodeDetailsProps {
  nodeId: string;
  topic: TopicKey;
  /** Select another tech-tree node (only works for nodes in the current layout). */
  onSelectNode?: (nodeId: string) => void;
}

const humanize = (value: string) =>
  value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const PROVENANCE_STYLES: Record<string, string> = {
  source: 'bg-emerald-100 text-emerald-800',
  literature: 'bg-sky-100 text-sky-800',
  llm_inferred: 'bg-amber-100 text-amber-800',
};

const MILESTONE_DOT: Record<string, string> = {
  completed: 'bg-green-500',
  ongoing: 'bg-blue-500',
  planned: 'bg-gray-300',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 pb-3 border-b">
      <h4 className="font-semibold text-sm text-gray-700">{title}</h4>
      {children}
    </section>
  );
}

function ProvenanceBadges({ provenance }: { provenance: string[] }) {
  if (!provenance.length) return null;
  return (
    <>
      {provenance.map((p) => (
        <span
          key={p}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PROVENANCE_STYLES[p] ?? 'bg-gray-100 text-gray-700'}`}
          title={p === 'llm_inferred' ? 'Inferred by an LLM, not stated in a source' : undefined}
        >
          {p === 'llm_inferred' ? 'LLM-inferred' : p}
        </span>
      ))}
    </>
  );
}

function NodeLink({
  node,
  onSelectNode,
}: {
  node: SmrNodeRef;
  onSelectNode?: (nodeId: string) => void;
}) {
  if (!onSelectNode) return <span className="font-medium">{node.name}</span>;
  return (
    <button
      type="button"
      onClick={() => onSelectNode(node.id)}
      className="font-medium text-blue-700 hover:underline text-left"
      title="Select in tech tree (if visible at the current detail level)"
    >
      {node.name}
    </button>
  );
}

function LevelBar({ level, max, label }: { level: number | null; max: number; label: string }) {
  const value = level ?? 0;
  return (
    <div className="flex items-center gap-2" aria-label={`${label}: ${value} of ${max}`}>
      <div className="flex gap-0.5">
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 w-5 rounded-sm ${i < value ? 'bg-blue-600' : 'bg-gray-200'}`}
          />
        ))}
      </div>
      <span className="text-xs tabular-nums text-gray-600">
        {value}/{max}
      </span>
    </div>
  );
}

function ImageGallery({ images, topic }: { images: SmrImageRef[]; topic: TopicKey }) {
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  if (!images.length) return null;
  const current = images[Math.min(index, images.length - 1)];
  const step = (delta: number) => setIndex((i) => (i + delta + images.length) % images.length);
  const caption = current.caption ?? humanize(current.category ?? 'figure');

  return (
    <div className="space-y-2">
      <div className="relative flex h-56 items-center justify-center rounded-md border bg-gray-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={topicImageUrl(topic, current.id)}
          alt={caption}
          className="max-h-full max-w-full object-contain cursor-zoom-in"
          onClick={() => setLightbox(true)}
          loading="lazy"
        />
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className="absolute top-2 right-2 rounded bg-white/90 p-1 shadow hover:bg-white"
          aria-label="Enlarge image"
        >
          <Maximize2 size={14} />
        </button>
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              className="absolute left-2 rounded-full bg-white/90 p-1 shadow hover:bg-white"
              aria-label="Previous image"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              className="absolute right-2 rounded-full bg-white/90 p-1 shadow hover:bg-white"
              aria-label="Next image"
            >
              <ChevronRight size={16} />
            </button>
          </>
        )}
      </div>
      <p className="text-xs text-gray-600">
        <span className="tabular-nums text-gray-400">
          {index + 1}/{images.length}
        </span>{' '}
        {caption} <span className="text-gray-400">· IAEA SMR Catalogue 2026</span>
      </p>
      {images.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {images.map((image, i) => (
            <button
              type="button"
              key={image.id}
              onClick={() => setIndex(i)}
              className={`h-12 w-16 flex-shrink-0 overflow-hidden rounded border-2 bg-white ${i === index ? 'border-blue-600' : 'border-transparent'}`}
              aria-label={`Show image ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={topicImageUrl(topic, image.id)} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      <Dialog open={lightbox} onOpenChange={setLightbox}>
        <DialogContent className="max-w-5xl">
          <DialogTitle className="text-sm font-medium pr-6">{caption}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={topicImageUrl(topic, current.id)}
            alt={caption}
            className="max-h-[75vh] w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReactorDetails({
  details,
  topic,
}: {
  details: SmrReactorDetails;
  topic: TopicKey;
}) {
  const [showAllSpecs, setShowAllSpecs] = useState(false);
  const specs = showAllSpecs ? details.specs : details.specs.slice(0, 8);
  const financingTotal = details.financing.reduce((sum, f) => sum + (f.usd ?? 0), 0);

  return (
    <div className="space-y-4">
      <ImageGallery images={details.images} topic={topic} />

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">{details.technology_line}</Badge>
        {details.classification.reactor_type_label && (
          <Badge variant="outline">{details.classification.reactor_type_label}</Badge>
        )}
        {details.classification.coolant && (
          <Badge variant="outline">Coolant: {details.classification.coolant}</Badge>
        )}
        {details.classification.deployment.map((d) => (
          <Badge key={d} variant="outline">{humanize(d)}</Badge>
        ))}
        <Badge variant="secondary" title="Source coverage">
          {details.coverage === 'matched' ? 'IAEA + NEA' : details.coverage === 'iaea_only' ? 'IAEA only' : 'NEA only'}
        </Badge>
      </div>

      <Section title="Developers & countries">
        <ul className="text-sm space-y-0.5">
          {details.developers.map((d) => (
            <li key={d.id}>{d.name}</li>
          ))}
        </ul>
        {details.countries.length > 0 && (
          <p className="text-xs text-gray-600">
            {details.countries.map((c) => getCountryName(c.iso) || c.name).join(' · ')}
            {details.headquarters?.city_region && ` — HQ ${details.headquarters.city_region}`}
          </p>
        )}
      </Section>

      {details.status && (
        <Section title="IAEA development status (ARIS)">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">{details.status.aris_status}</span>
            <LevelBar level={details.status.aris_level} max={details.status.aris_level_max ?? 5} label="ARIS level" />
          </div>
          {details.status.development_stages.length > 0 && (
            <p className="text-xs text-gray-500">Stages: {details.status.development_stages.join(' → ')}</p>
          )}
        </Section>
      )}

      {details.assessment.length > 0 && (
        <Section title="NEA progress to deployment">
          <Accordion type="multiple" className="w-full">
            {details.assessment.map((a) => (
              <AccordionItem key={a.dimension} value={a.dimension} className="border-b-0">
                <AccordionTrigger className="py-1.5 text-sm hover:no-underline" disabled={!a.text}>
                  <span className="flex w-full items-center justify-between gap-3 pr-2">
                    <span className="w-24 text-left">
                      {a.label}
                      {a.changed && <span title="Changed since 2nd edition (2024)"> Δ</span>}
                      {a.multiple_jurisdictions && <span title="Active in multiple jurisdictions"> ★</span>}
                    </span>
                    <span className="flex-1 truncate text-left text-xs text-gray-500" title={a.stage ?? undefined}>
                      {a.stage}
                    </span>
                    <LevelBar level={a.level} max={6} label={a.label} />
                  </span>
                </AccordionTrigger>
                {a.text && (
                  <AccordionContent>
                    <p className="text-xs text-gray-600 whitespace-pre-line">{a.text}</p>
                  </AccordionContent>
                )}
              </AccordionItem>
            ))}
          </Accordion>
        </Section>
      )}

      {specs.length > 0 && (
        <Section title="Key technical parameters">
          <table className="w-full text-xs">
            <tbody>
              {specs.map((s) => (
                <tr key={s.key} className="border-b last:border-0 align-top">
                  <td className="py-1 pr-3 text-gray-500">{s.label}</td>
                  <td className="py-1">
                    {s.value}
                    {s.conflict && (
                      <span className="ml-1 text-amber-700" title={`NEA reports: ${s.conflict}`}>
                        (NEA: {s.conflict})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {details.specs.length > 8 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAllSpecs((v) => !v)}>
              {showAllSpecs ? 'Show fewer' : `Show all ${details.specs.length} parameters`}
            </Button>
          )}
        </Section>
      )}

      {details.classification.applications.length > 0 && (
        <Section title="Target applications">
          <div className="flex flex-wrap gap-1.5">
            {details.classification.applications.map((a) => (
              <Badge key={a} variant="secondary">{humanize(a)}</Badge>
            ))}
          </div>
        </Section>
      )}

      {details.milestones.length > 0 && (
        <Section title="Development milestones">
          <ol className="relative ml-1.5 border-l border-gray-200 space-y-2">
            {details.milestones.map((m, i) => (
              <li key={i} className="ml-3 text-xs">
                <span
                  className={`absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full ${MILESTONE_DOT[m.status ?? ''] ?? 'bg-gray-300'}`}
                  title={m.status ?? undefined}
                />
                <span className="font-semibold tabular-nums">{m.year ?? '—'}</span>{' '}
                <span className="text-gray-700">{m.milestone}</span>
                {m.status && <span className="ml-1 text-gray-400">({m.status})</span>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {details.financing.length > 0 && (
        <Section title="Financing mentions (NEA)">
          {financingTotal > 0 && (
            <p className="text-xs text-gray-500">
              Sum of USD-denominated mentions: ${(financingTotal / 1e6).toFixed(0)}M (may double-count)
            </p>
          )}
          <ul className="list-disc list-inside text-xs text-gray-700 space-y-0.5">
            {details.financing.map((f, i) => (
              <li key={i}>
                {f.text} <span className="text-gray-400">· {humanize(f.section)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {details.sections.length > 0 && (
        <Section title="Design description (IAEA)">
          <Accordion type="single" collapsible className="w-full">
            {details.sections.map((s) => (
              <AccordionItem key={s.title} value={s.title}>
                <AccordionTrigger className="py-2 text-sm">{s.title}</AccordionTrigger>
                <AccordionContent className="space-y-2">
                  {s.blocks.map((b, i) => (
                    <div key={i}>
                      {b.heading && <p className="text-xs font-semibold text-gray-700">{b.heading}</p>}
                      <p className="text-xs text-gray-600 whitespace-pre-line">{b.text}</p>
                    </div>
                  ))}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Section>
      )}

      {(details.regulators.length > 0 || details.organisations.length > 0) && (
        <Section title="Regulators & involved organisations">
          {details.regulators.length > 0 && (
            <p className="text-xs"><span className="text-gray-500">Regulators:</span> {details.regulators.map((r) => r.name).join(', ')}</p>
          )}
          {details.organisations.length > 0 && (
            <p className="text-xs"><span className="text-gray-500">Organisations:</span> {details.organisations.map((o) => o.name).join(', ')}</p>
          )}
        </Section>
      )}

      <Section title="Sources">
        <ul className="list-disc list-inside text-xs text-gray-600">
          {details.sources.map((s, i) => (
            <li key={i}>{s.publisher}: {s.document} ({s.year})</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function TechnologyDetails({
  details,
  onSelectNode,
}: {
  details: SmrTechnologyDetails;
  onSelectNode?: (nodeId: string) => void;
}) {
  const { importance, deployment } = details;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">{details.category}</Badge>
        {importance.abstraction && <Badge variant="outline">{humanize(importance.abstraction)}</Badge>}
        {deployment?.availability && <Badge variant="secondary">{humanize(deployment.availability)}</Badge>}
        {deployment?.trl_band && <Badge variant="secondary">TRL {deployment.trl_band}</Badge>}
        {details.origin === 'llm_inferred' && (
          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100" title="Node inferred by an LLM, not found in the source documents">
            LLM-inferred node
          </Badge>
        )}
      </div>

      {details.description && (
        <Section title="Description">
          <p className="text-sm text-gray-700">{details.description}</p>
          <p className="text-[11px] italic text-gray-400">LLM-generated background, not a source statement.</p>
          {details.source_descriptions.length > 0 && (
            <ul className="list-disc list-inside text-xs text-gray-600">
              {details.source_descriptions.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
          {details.aliases.length > 0 && (
            <p className="text-xs text-gray-500">Also known as: {details.aliases.join(', ')}</p>
          )}
        </Section>
      )}

      <Section title="Decision relevance">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            Reaches {importance.reactor_reach ?? 0} reactor designs ({importance.direct_reactors ?? 0} directly)
          </span>
          <LevelBar level={importance.decision_relevance} max={5} label="Decision relevance" />
        </div>
        {importance.rationale && <p className="text-xs text-gray-600">{importance.rationale}</p>}
      </Section>

      {deployment && (
        <Section title="Deployment & supply chain">
          {deployment.summary && <p className="text-xs text-gray-700">{deployment.summary}</p>}
          {deployment.suppliers.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 font-medium">Organisation</th>
                  <th className="py-1 font-medium">Role</th>
                  <th className="py-1 font-medium">Location</th>
                </tr>
              </thead>
              <tbody>
                {deployment.suppliers.map((s, i) => (
                  <tr key={i} className="border-t align-top">
                    <td className="py-1 pr-2">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">
                          {s.name}
                        </a>
                      ) : s.name}
                    </td>
                    <td className="py-1 pr-2">{s.role ? humanize(s.role) : '—'}</td>
                    <td className="py-1 text-gray-600">{s.location && !/not stated/i.test(s.location) ? s.location : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {deployment.milestones.length > 0 && (
            <ul className="text-xs space-y-0.5">
              {deployment.milestones.map((m, i) => (
                <li key={i}>
                  <span className="font-semibold">{m.date}</span> — {m.event}
                </li>
              ))}
            </ul>
          )}
          {deployment.scaling_factors.length > 0 && (
            <p className="text-xs"><span className="text-gray-500">Scaling factors:</span> {deployment.scaling_factors.join('; ')}</p>
          )}
        </Section>
      )}

      {details.enables.reactors.length > 0 && (
        <Section title={`Used in reactor designs (${details.enables.reactors.length})`}>
          <ul className="space-y-1.5 text-xs">
            {details.enables.reactors.map((r) => (
              <li key={r.id}>
                <NodeLink node={r} onSelectNode={onSelectNode} />
                {r.verified && <span className="ml-1 text-green-700" title="Quote verified in source">✓</span>}
                {r.role && <span className="text-gray-600"> — {r.role}</span>}
                {r.quote && <p className="ml-2 border-l-2 pl-2 italic text-gray-500">“{r.quote}”</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {details.enabled_by.length > 0 && (
        <Section title={`Enabled by (${details.enabled_by.length})`}>
          <ul className="space-y-2 text-xs">
            {details.enabled_by.map((e) => (
              <li key={e.id}>
                <div className="flex flex-wrap items-center gap-1">
                  <NodeLink node={e} onSelectNode={onSelectNode} />
                  {e.relation_type && <span className="text-gray-400">({humanize(e.relation_type)})</span>}
                  <ProvenanceBadges provenance={e.provenance} />
                </div>
                {e.rationale && <p className="text-gray-600">{e.rationale}</p>}
                {e.citations.filter((c) => c.url).map((c, i) => (
                  <a
                    key={i}
                    href={c.url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 flex items-start gap-1 text-blue-700 hover:underline"
                  >
                    <ExternalLink size={10} className="mt-0.5 flex-shrink-0" />
                    <span>
                      {c.title} {c.year && `(${c.year})`}
                      {c.verdict && <span className="text-gray-400"> · {c.verdict}</span>}
                    </span>
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {details.enables.technologies.length > 0 && (
        <Section title={`Enables technologies (${details.enables.technologies.length})`}>
          <ul className="space-y-1 text-xs">
            {details.enables.technologies.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-1">
                <NodeLink node={t} onSelectNode={onSelectNode} />
                <ProvenanceBadges provenance={t.provenance} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(details.broader.length > 0 || details.narrower.length > 0) && (
        <Section title="Taxonomy">
          {details.broader.length > 0 && (
            <p className="text-xs">
              <span className="text-gray-500">Broader: </span>
              {details.broader.map((b, i) => (
                <span key={b.id}>{i > 0 && ', '}<NodeLink node={b} onSelectNode={onSelectNode} /></span>
              ))}
            </p>
          )}
          {details.narrower.length > 0 && (
            <p className="text-xs">
              <span className="text-gray-500">Narrower: </span>
              {details.narrower.map((b, i) => (
                <span key={b.id}>{i > 0 && ', '}<NodeLink node={b} onSelectNode={onSelectNode} /></span>
              ))}
            </p>
          )}
        </Section>
      )}
    </div>
  );
}

export function SmrNodeDetails({ nodeId, topic, onSelectNode }: SmrNodeDetailsProps) {
  const [details, setDetails] = useState<SmrNodeDetailsData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setDetails(null);
    fetch(
      `/investment-tech-tree/api/node-details?topic=${topic}&nodeId=${encodeURIComponent(nodeId)}`,
      { signal: controller.signal },
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: SmrNodeDetailsData) => {
        setDetails(data);
        setState('ready');
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState('error');
      });
    return () => controller.abort();
  }, [nodeId, topic]);

  if (state === 'loading') return <p className="text-sm text-gray-500">Loading details…</p>;
  if (state === 'error' || !details) return <p className="text-sm text-red-600">Could not load details for this node.</p>;

  return details.kind === 'reactor' ? (
    <ReactorDetails details={details} topic={topic} />
  ) : (
    <TechnologyDetails details={details} onSelectNode={onSelectNode} />
  );
}
