import assert from 'node:assert/strict';
import test from 'node:test';
import {
  designsForCompany,
  groupEntitiesForReactor,
  isReactorNode,
  stripEntityPrefix,
} from '@/lib/reactorEntities';
import {
  CompanySummary,
  CompanyTechnologyMapping,
  SmrNodeMeta,
  TechTree,
} from '@/lib/types';

const reactorMeta = (): SmrNodeMeta => ({
  kind: 'reactor',
  status: 'Basic design',
  status_level: 2,
  coverage: 'matched',
  electric_mwe: 77,
  thermal_mwth: 250,
  coolant: 'light water',
  neutron_spectrum: 'Thermal',
  countries: ['US'],
  developers: ['org:nuscale'],
  image_count: 0,
  cover_image_id: null,
});

const company = (id: string, name = id): CompanySummary => ({
  id,
  canonical_name: name,
  country_iso: 'US',
  manufacturing_countries: [],
  primary_approach: null,
  tech_tree_primary_node: null,
  trl_level: null,
  trl_band: null,
  funding_total_usd: null,
  vc_funding_stage: null,
  headcount_range: null,
  description: null,
  domain: null,
  geopolitical_risk_score: null,
  geopolitical_risk_label: null,
});

const mapping = (
  companyId: string,
  nodeId: string,
  overrides: Partial<CompanyTechnologyMapping> = {},
): CompanyTechnologyMapping => ({
  id: `${companyId}__${nodeId}`,
  company_id: companyId,
  tech_tree_node_id: nodeId,
  is_primary: false,
  confidence: null,
  method: null,
  reasoning: null,
  ...overrides,
});

const techTree: TechTree = {
  nodes: [
    {
      id: 'smr:voygr',
      data: {
        label: 'VOYGR',
        nodeLabel: 'ReactorConcept',
        description: '',
        smr: reactorMeta(),
      },
    },
    {
      id: 'tech:fuel',
      data: {
        label: 'Fuel fabrication',
        nodeLabel: 'EnablingTechnology',
        description: '',
        smr: {
          kind: 'technology',
          relevance: 5,
          importance_score: null,
          reactor_reach: null,
          tree_level: 1,
          origin: null,
          availability: null,
        },
      },
    },
  ],
  edges: [{ id: 'e1', source: 'tech:fuel', target: 'smr:voygr' }],
};

test('stripEntityPrefix and isReactorNode recognise stable ids', () => {
  assert.equal(stripEntityPrefix('org:nuscale'), 'nuscale');
  assert.equal(stripEntityPrefix('smr:voygr'), 'voygr');
  assert.equal(isReactorNode(techTree.nodes[0]), true);
  assert.equal(isReactorNode(techTree.nodes[1]), false);
});

test('groupEntitiesForReactor groups developers and suppliers by role', () => {
  const companies = [
    company('nuscale', 'NuScale'),
    company('bwxt', 'BWXT'),
    company('framatome', 'Framatome'),
  ];
  const mappings = [
    mapping('nuscale', 'smr:voygr', {
      method: 'develops',
      is_primary: true,
    }),
    mapping('bwxt', 'smr:voygr', {
      method: 'supplies',
      roles: ['manufacturer'],
    }),
    mapping('framatome', 'tech:fuel', {
      method: 'supplies',
      roles: ['fuel_supplier'],
    }),
  ];

  const groups = groupEntitiesForReactor(
    'smr:voygr',
    companies,
    mappings,
    techTree,
  );
  const byRole = Object.fromEntries(
    groups.map((group) => [group.role, group.entities.map((entity) => entity.id)]),
  );

  assert.deepEqual(byRole.developer, ['nuscale']);
  assert.deepEqual(byRole.manufacturer, ['bwxt']);
  assert.deepEqual(byRole.supplier, ['framatome']);
  assert.equal(
    groups.find((group) => group.role === 'supplier')?.entities[0].viaTechnologyId,
    'tech:fuel',
  );
});

test('designsForCompany lists every design a company participates in', () => {
  const mappings = [
    mapping('nuscale', 'smr:voygr', {
      method: 'develops',
      is_primary: true,
    }),
    mapping('nuscale', 'tech:fuel', {
      method: 'supplies',
      roles: ['manufacturer'],
    }),
  ];
  const designs = designsForCompany('nuscale', mappings, techTree, [
    'smr:voygr',
  ]);
  assert.equal(designs[0].nodeId, 'smr:voygr');
  assert.equal(designs[0].isReactor, true);
  assert.equal(designs[0].isPrimary, true);
  assert.ok(designs.some((design) => design.nodeId === 'tech:fuel'));
});
