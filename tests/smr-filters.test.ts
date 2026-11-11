import assert from 'node:assert/strict';
import test from 'node:test';
import { chatContextTree, filterSmrTechTree, isSmrTree } from '@/lib/smrFilters';
import { buildCompanyViewResponse } from '@/lib/companyData';
import { SmrNodeMeta, TechTree } from '@/lib/types';

const reactorMeta = (id: string): SmrNodeMeta => ({
  kind: 'reactor',
  status: 'Basic design',
  status_level: 2,
  coverage: 'matched',
  electric_mwe: 300,
  thermal_mwth: 900,
  coolant: 'light water',
  neutron_spectrum: 'Thermal',
  countries: ['US'],
  developers: [`org:${id}`],
  image_count: 0,
  cover_image_id: null,
});

const techMeta = (relevance: number): SmrNodeMeta => ({
  kind: 'technology',
  relevance,
  importance_score: null,
  reactor_reach: null,
  tree_level: 1,
  origin: 'source_document',
  availability: null,
});

const node = (id: string, category: string, smr: SmrNodeMeta) => ({
  id,
  data: {
    label: id,
    nodeLabel: smr.kind === 'reactor' ? ('ReactorConcept' as const) : ('EnablingTechnology' as const),
    description: id,
    category,
    smr,
  },
});

const edge = (source: string, target: string, sourceBacked: boolean) => ({
  id: `${source}->${target}`,
  source,
  target,
  data: { source_backed: sourceBacked },
});

const smrTree: TechTree = {
  nodes: [
    node('smr:a', 'Water-cooled SMRs', reactorMeta('a')),
    node('tech:core', 'Fuel', techMeta(5)),
    node('tech:mid', 'Material', techMeta(4)),
    node('tech:low', 'Material', techMeta(2)),
    node('tech:unrated', 'Process', techMeta(0)),
  ],
  edges: [
    edge('tech:core', 'smr:a', true),
    edge('tech:mid', 'tech:core', false),
    edge('tech:low', 'tech:mid', true),
    edge('tech:unrated', 'smr:a', true),
  ],
};

const allFilters = { minRelevance: 0, sourceBackedOnly: false, category: 'All' };

test('isSmrTree detects SMR metadata', () => {
  assert.equal(isSmrTree(smrTree), true);
  assert.equal(isSmrTree({ nodes: [{ id: 'x', data: { label: 'x', nodeLabel: 'Milestone', description: '' } }], edges: [] }), false);
  assert.equal(isSmrTree(null), false);
});

test('relevance threshold keeps reactors and drops low-relevance technologies with their edges', () => {
  const filtered = filterSmrTechTree(smrTree, { ...allFilters, minRelevance: 4 });
  assert.deepEqual(filtered.nodes.map((n) => n.id), ['smr:a', 'tech:core', 'tech:mid']);
  assert.deepEqual(filtered.edges.map((e) => e.id), ['tech:core->smr:a', 'tech:mid->tech:core']);
});

test('threshold 0 shows everything, including unrated technologies', () => {
  const filtered = filterSmrTechTree(smrTree, allFilters);
  assert.equal(filtered.nodes.length, smrTree.nodes.length);
  assert.equal(filtered.edges.length, smrTree.edges.length);
});

test('source-backed toggle removes LLM-only relations but keeps nodes', () => {
  const filtered = filterSmrTechTree(smrTree, { ...allFilters, sourceBackedOnly: true });
  assert.equal(filtered.nodes.length, smrTree.nodes.length);
  assert.ok(!filtered.edges.some((e) => e.id === 'tech:mid->tech:core'));
});

test('category filter keeps the category plus direct neighbours', () => {
  const filtered = filterSmrTechTree(smrTree, { ...allFilters, category: 'Fuel' });
  assert.deepEqual(filtered.nodes.map((n) => n.id).sort(), ['smr:a', 'tech:core', 'tech:mid']);
  assert.equal(filtered.edges.length, 2);
});

test('chat context keeps reactors with facts and only relevance-5 technologies', () => {
  const context = chatContextTree(smrTree);
  assert.deepEqual(context.nodes.map((n) => n.id), ['smr:a', 'tech:core']);
  assert.match(String(context.nodes[0].data.detailedDescription), /300 MWe/);
  assert.deepEqual(context.edges, []);
});

test('company view response passes through topic locations', () => {
  const response = buildCompanyViewResponse(
    [{ id: 'acme', canonical_name: 'Acme', country_iso: 'us' }],
    [{ company_id: 'acme', tech_tree_node_id: 'smr:a', is_primary: true }],
    'SMR',
    [
      { company_id: 'acme', label: 'Wilmington', country_iso: 'us', latitude: 34.2, longitude: -77.9, source_field: 'hq' },
      { company_id: 'broken', label: 'Nowhere', country_iso: 'US', latitude: null, longitude: 1 },
    ],
  );
  assert.equal(response.available, true);
  assert.ok(response.available);
  assert.deepEqual(response.locations?.map((l) => [l.company_id, l.country_iso, l.source_field]), [['acme', 'US', 'hq']]);
});
