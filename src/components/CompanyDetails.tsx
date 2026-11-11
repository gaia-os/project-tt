'use client';

import React from 'react';
import { CompanyInfo } from '@/lib/types';
import { TopicKey } from '@/lib/topicConfig';
import { topicImageUrl } from '@/lib/smrImages';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface CompanyDetailsProps {
  company: CompanyInfo;
  /** Needed to resolve `logo_image_id` against the topic's image store. */
  topic?: TopicKey;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <div className="space-y-1 pb-2 border-b last:border-b-0">
      <h4 className="font-semibold text-sm text-gray-700">{label}</h4>
      <div className="text-sm text-gray-800">{value}</div>
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Badge key={item} variant="secondary" className="text-xs">
          {item}
        </Badge>
      ))}
    </div>
  );
}

function RiskBlock({
  title,
  score,
  label,
  summary,
}: {
  title: string;
  score?: number | string | null;
  label?: string | null;
  summary?: string | null;
}) {
  if (score == null && summary == null && label == null) return null;
  const isHighRisk = typeof score === 'number' && score >= 0.7;
  return (
    <div className="bg-slate-50 border border-slate-200 p-3 rounded-md space-y-1 mb-3 last:mb-0">
      <div className="flex justify-between items-start">
        <h5 className="font-semibold text-sm text-slate-800">{title}</h5>
        {score != null && (
          <Badge
            variant={isHighRisk ? 'destructive' : 'secondary'}
            className="ml-2 shrink-0"
          >
            {score}
          </Badge>
        )}
      </div>
      {label && (
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          {label}
        </div>
      )}
      {summary && (
        <div className="text-sm text-slate-700 mt-1 leading-snug">{summary}</div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

const CompanyDetails: React.FC<CompanyDetailsProps> = ({ company, topic }) => {
  const logoId = typeof company.logo_image_id === 'string' ? company.logo_image_id : null;
  return (
    <div className="p-4 flex flex-col h-full">
      <Card className="flex flex-col h-full">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4 gap-4 border-b-2 mb-4">
          {logoId && topic && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={topicImageUrl(topic, logoId)}
              alt={`${company.canonical_name} logo`}
              className="h-12 w-12 flex-shrink-0 rounded border bg-white object-contain p-0.5"
              loading="lazy"
            />
          )}
          <div className="flex-1">
            <CardTitle className="text-lg font-bold leading-tight">
              {company.canonical_name}
            </CardTitle>
            {company.domain && (
              <a
                href={`https://${company.domain}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 hover:underline mt-1 block"
              >
                {company.domain}
              </a>
            )}
          </div>
          <Badge className="bg-yellow-400 text-yellow-900 shrink-0">Company</Badge>
        </CardHeader>

        <CardContent className="overflow-auto flex-grow space-y-3">
          {company.is_primary && (
            <div className="bg-yellow-50 border border-yellow-300 rounded px-3 py-2 text-xs text-yellow-800 font-medium">
              Primary match for this tech tree node
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <MetricCard
              label="Headquarters"
              value={
                company.linkedin_headquarters ??
                company.country_iso ??
                'Not available'
              }
            />
            <MetricCard
              label="Readiness"
              value={
                company.trl_level != null
                  ? `TRL ${company.trl_level}${
                      company.trl_band ? ` · ${company.trl_band}` : ''
                    }`
                  : 'Not available'
              }
            />
            <MetricCard
              label="Funding"
              value={
                company.funding_total_usd != null
                  ? `$${(company.funding_total_usd / 1_000_000).toFixed(1)}M`
                  : company.vc_funding_stage ?? 'Not available'
              }
            />
            <MetricCard
              label="Geopolitical risk"
              value={
                company.geopolitical_risk_label ??
                company.geopolitical_risk_score ??
                'Not available'
              }
            />
          </div>

          {company.description && (
            <div className="text-sm text-gray-700 italic border-l-4 border-gray-300 pl-3 mb-4">
              {company.description}
            </div>
          )}

          <InfoRow
            label="Headquarters Location"
            value={company.linkedin_headquarters ?? null}
          />
          <InfoRow label="Country" value={company.country_iso ?? null} />
          <InfoRow label="Country Tier" value={
            company.country_tier != null
              ? `${company.country_tier}${company.country_tier_label ? ` — ${company.country_tier_label}` : ''}`
              : null
          } />
          <InfoRow label="TRL Level" value={
            company.trl_level != null
              ? `${company.trl_level}${company.trl_band ? ` (${company.trl_band})` : ''}${
                  company.trl_confidence != null
                    ? ` · ${(company.trl_confidence * 100).toFixed(0)}% confidence`
                    : ''
                }`
              : null
          } />

          {(company.founded_year || company.funding_total_usd || company.vc_funding_stage || company.headcount_range) && (
            <div className="space-y-2 pb-2 border-b">
              <h4 className="font-semibold text-sm text-gray-700">Financials &amp; Scale</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <InfoRow label="Founded" value={company.founded_year ?? null} />
                <InfoRow label="Funding Stage" value={company.vc_funding_stage ?? null} />
                <InfoRow
                  label="Total Funding"
                  value={
                    company.funding_total_usd
                      ? `$${(company.funding_total_usd / 1_000_000).toFixed(1)}M`
                      : null
                  }
                />
                <InfoRow label="Headcount" value={company.headcount_range ?? null} />
                <InfoRow label="Customers" value={company.customer_count_band ?? null} />
                <InfoRow label="Current Capacity" value={company.current_capacity ?? null} />
              </div>
            </div>
          )}

          {/* SMR organisation fields (smr_tt_db) */}
          <InfoRow label="Organisation Type" value={(company.organisation_kind as string) ?? null} />
          <InfoRow label="Ticker" value={(company.ticker as string) ?? null} />
          <InfoRow label="Valuation" value={(company.valuation as string) ?? null} />
          <InfoRow
            label="Supply-chain Roles"
            value={
              Array.isArray(company.supply_roles) && company.supply_roles.length ? (
                <TagList items={(company.supply_roles as string[]).map((r) => r.replace(/_/g, ' '))} />
              ) : null
            }
          />
          {Array.isArray(company.stakeholders) && company.stakeholders.length > 0 && (
            <InfoRow
              label="Stakeholders"
              value={
                <ul className="space-y-0.5">
                  {(company.stakeholders as { name: string; relation: string; url: string | null }[]).map((s, i) => (
                    <li key={i}>
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                          {s.name}
                        </a>
                      ) : (
                        s.name
                      )}{' '}
                      <span className="text-xs text-gray-500">({s.relation})</span>
                    </li>
                  ))}
                </ul>
              }
            />
          )}

          <Accordion type="multiple" className="w-full">
            {(company.role_in_supply_chain ||
              company.critical_material_deps?.length ||
              company.sole_source_dependency != null) && (
              <AccordionItem value="supply-chain">
                <AccordionTrigger className="text-sm font-semibold text-gray-700">
                  Supply Chain Position
                </AccordionTrigger>
                <AccordionContent className="space-y-3">
                  <InfoRow
                    label="Role"
                    value={company.role_in_supply_chain ?? null}
                  />
                  <InfoRow
                    label="Role Confidence"
                    value={
                      company.role_in_supply_chain_confidence != null
                        ? `${(
                            company.role_in_supply_chain_confidence * 100
                          ).toFixed(0)}%`
                        : null
                    }
                  />
                  <InfoRow
                    label="Sole-Source Dependency"
                    value={
                      company.sole_source_dependency == null
                        ? null
                        : company.sole_source_dependency
                          ? 'Yes'
                          : 'No'
                    }
                  />
                  {company.critical_material_deps?.length ? (
                    <TagList items={company.critical_material_deps} />
                  ) : null}
                </AccordionContent>
              </AccordionItem>
            )}

            <AccordionItem value="risks">
              <AccordionTrigger className="text-sm font-semibold text-gray-700">
                Risk Assessment Profiles
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <RiskBlock
                  title="Commercial Risk"
                  score={company.commercial_risk_score}
                  label={company.commercial_risk_label}
                  summary={company.commercial_risk_summary}
                />
                <RiskBlock
                  title="Financial Risk"
                  score={company.financial_risk_score}
                  label={company.financial_risk_label}
                  summary={company.financial_risk_summary}
                />
                <RiskBlock
                  title="Manufacturing Risk"
                  score={company.manufacturing_risk_score}
                  label={company.manufacturing_risk_label}
                  summary={company.manufacturing_risk_summary}
                />
                <RiskBlock
                  title="Geopolitical Risk"
                  score={company.geopolitical_risk_score}
                  label={company.geopolitical_risk_label}
                  summary={company.geopolitical_risk_summary}
                />
                <RiskBlock
                  title="Regulatory Risk"
                  score={company.regulatory_risk_score}
                  summary={company.regulatory_risk_score_reasoning}
                />
                <RiskBlock
                  title="Export Control Exposure"
                  score={company.export_control_exposure}
                  summary={company.export_control_exposure_reasoning}
                />
              </AccordionContent>
            </AccordionItem>

            {company.key_investors?.length ? (
              <AccordionItem value="investors">
                <AccordionTrigger className="text-sm font-semibold text-gray-700">
                  Key Investors ({company.key_investors.length})
                </AccordionTrigger>
                <AccordionContent>
                  <TagList items={company.key_investors} />
                </AccordionContent>
              </AccordionItem>
            ) : null}

            {company.manufacturing_countries?.length ? (
              <AccordionItem value="manufacturing">
                <AccordionTrigger className="text-sm font-semibold text-gray-700">
                  Manufacturing Countries
                </AccordionTrigger>
                <AccordionContent>
                  <TagList items={company.manufacturing_countries} />
                </AccordionContent>
              </AccordionItem>
            ) : null}

            {company.critical_material_deps?.length ? (
              <AccordionItem value="materials">
                <AccordionTrigger className="text-sm font-semibold text-gray-700">
                  Critical Material Dependencies
                </AccordionTrigger>
                <AccordionContent>
                  <TagList items={company.critical_material_deps} />
                </AccordionContent>
              </AccordionItem>
            ) : null}

            {company.ownership_top_shareholders?.length ? (
              <AccordionItem value="shareholders">
                <AccordionTrigger className="text-sm font-semibold text-gray-700">
                  Top Shareholders
                </AccordionTrigger>
                <AccordionContent>
                  <TagList items={company.ownership_top_shareholders} />
                </AccordionContent>
              </AccordionItem>
            ) : null}

            {(company.foreign_ownership_flag != null ||
              company.foreign_ownership_flag_reasoning) && (
              <AccordionItem value="ownership">
                <AccordionTrigger className="text-sm font-semibold text-gray-700">
                  Ownership Assessment
                </AccordionTrigger>
                <AccordionContent className="space-y-3">
                  <InfoRow
                    label="Foreign Ownership Flag"
                    value={
                      company.foreign_ownership_flag == null
                        ? null
                        : company.foreign_ownership_flag
                          ? 'Yes'
                          : 'No'
                    }
                  />
                  <InfoRow
                    label="Assessment"
                    value={company.foreign_ownership_flag_reasoning ?? null}
                  />
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>

          <InfoRow
            label="Primary Approach"
            value={company.primary_approach ?? null}
          />
          <InfoRow
            label="All Approaches"
            value={
              company.all_approaches?.length
                ? <TagList items={company.all_approaches} />
                : null
            }
          />

          {(company.tech_tree_primary_node ||
            company.tech_tree_primary_method ||
            company.tech_tree_primary_reasoning ||
            company.tech_tree_product_clusters?.length ||
            company.relation_confidence != null ||
            company.relation_method != null ||
            company.relation_reasoning != null) && (
            <div className="space-y-2 pb-2 border-b">
              <h4 className="font-semibold text-sm text-gray-700">
                Tech Tree Mapping
              </h4>
              <div className="space-y-1 text-sm">
                {company.tech_tree_primary_node && (
                  <p>
                    <span className="font-medium">Primary Node:</span>{' '}
                    {company.tech_tree_primary_node}
                  </p>
                )}
                {company.tech_tree_primary_method && (
                  <p>
                    <span className="font-medium">Primary Method:</span>{' '}
                    {company.tech_tree_primary_method}
                  </p>
                )}
                {company.tech_tree_primary_confidence != null && (
                  <p>
                    <span className="font-medium">Primary Confidence:</span>{' '}
                    {(company.tech_tree_primary_confidence * 100).toFixed(0)}%
                  </p>
                )}
                {company.tech_tree_primary_reasoning && (
                  <p>
                    <span className="font-medium">Primary Reasoning:</span>{' '}
                    {company.tech_tree_primary_reasoning}
                  </p>
                )}
                {company.relation_method && (
                  <p>
                    <span className="font-medium">Method:</span>{' '}
                    {company.relation_method}
                  </p>
                )}
                {company.relation_confidence != null && (
                  <p>
                    <span className="font-medium">Confidence:</span>{' '}
                    {typeof company.relation_confidence === 'number'
                      ? `${(company.relation_confidence * 100).toFixed(0)}%`
                      : company.relation_confidence}
                  </p>
                )}
                {company.relation_reasoning && (
                  <p>
                    <span className="font-medium">Reasoning:</span>{' '}
                    {company.relation_reasoning}
                  </p>
                )}
                {company.tech_tree_product_clusters?.length ? (
                  <div className="pt-2">
                    <span className="mb-1 block font-medium">
                      Product Clusters
                    </span>
                    <TagList items={company.tech_tree_product_clusters} />
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {(company.source_url ||
            company.linkedin_url ||
            company.trl_source_url ||
            company.tech_tree_primary_source_url) && (
            <div className="space-y-2 pb-2 border-b">
              <h4 className="font-semibold text-sm text-gray-700">
                Sources &amp; Verification
              </h4>
              <div className="flex flex-col gap-1 text-sm">
                {[
                  ['Company Source', company.source_url],
                  ['LinkedIn', company.linkedin_url],
                  ['TRL Evidence', company.trl_source_url],
                  ['Mapping Evidence', company.tech_tree_primary_source_url],
                ].map(([label, url]) =>
                  url ? (
                    <a
                      key={label}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {label}
                    </a>
                  ) : null,
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CompanyDetails;
