import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCompanyWorldFacets,
  buildWorldFilterCatalog,
  classifyReactorTypes,
  companyMatchesWorldFilters,
  countActiveWorldFilters,
  EMPTY_WORLD_FILTERS,
  filterCompaniesByWorldFilters,
  powerClassFromMwe,
  toggleWorldFilterValue,
  WorldViewFilters,
} from '@/lib/worldFilters';
import {
  CompanySummary,
  CompanyTechnologyMapping,
  SmrNodeMeta,
  TechTree,
} from '@/lib/types';

const reactorMeta = (
  overrides: Partial<Extract<SmrNodeMeta, { kind: 'reactor' }>> = {},
): SmrNodeMeta => ({
  kind: 'reactor',
  status: 'Basic design',
  status_level: 2,
  coverage: 'matched',
  electric_mwe: 77,
  thermal_mwth: 250,
  coolant: 'light water',
  neutron_spectrum: 'Thermal',
  countries: ['US'],
  developers: ['org:x'],
  image_count: 0,
  cover_image_id: null,
  ...overrides,
});

const company = (
  id: string,
  overrides: Partial<CompanySummary> = {},
): CompanySummary => ({
  id,
  canonical_name: id,
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
  ...overrides,
});

test('classifyReactorTypes maps design vocabulary onto filter families', () => {
  assert.deepEqual(classifyReactorTypes('Integral PWR'), ['PWR']);
  assert.deepEqual(classifyReactorTypes('Boiling water SMR'), ['BWR']);
  assert.deepEqual(classifyReactorTypes('Molten salt reactor'), ['Molten salt']);
  assert.deepEqual(classifyReactorTypes('HTGR helium-cooled'), ['HTGR']);
  assert.deepEqual(classifyReactorTypes('Sodium fast reactor'), ['Fast reactor']);
  assert.deepEqual(classifyReactorTypes('Heat-pipe microreactor'), [
    'Microreactor',
  ]);
  assert.deepEqual(classifyReactorTypes('Light-water microreactor'), [
    'Microreactor',
    'PWR',
  ]);
});

test('powerClassFromMwe uses SMR-style bands', () => {
  assert.equal(powerClassFromMwe(5), 'Micro (<20 MWe)');
  assert.equal(powerClassFromMwe(77), 'Small (20–300 MWe)');
  assert.equal(powerClassFromMwe(450), 'Medium (300–700 MWe)');
  assert.equal(powerClassFromMwe(1000), 'Large (≥700 MWe)');
  assert.equal(powerClassFromMwe(null), null);
});

test('facets and multi-select matching update company sets', () => {
  const companies = [
    company('nuscale', {
      country_iso: 'US',
      primary_approach: 'Integral PWR',
      tech_tree_primary_node: 'smr:nuscale',
    }),
    company('kairos', {
      country_iso: 'US',
      manufacturing_countries: ['CA'],
      tech_tree_primary_node: 'smr:kairos',
    }),
    company('terra', {
      country_iso: 'US',
      tech_tree_primary_node: 'concept_twr',
    }),
  ];
  const mappings: CompanyTechnologyMapping[] = [
    {
      id: 'm1',
      company_id: 'nuscale',
      tech_tree_node_id: 'smr:nuscale',
      is_primary: true,
      confidence: 1,
      method: 'test',
      reasoning: null,
    },
    {
      id: 'm2',
      company_id: 'kairos',
      tech_tree_node_id: 'smr:kairos',
      is_primary: true,
      confidence: 1,
      method: 'test',
      reasoning: null,
    },
  ];
  const techTree: TechTree = {
    nodes: [
      {
        id: 'smr:nuscale',
        data: {
          label: 'VOYGR',
          nodeLabel: 'ReactorConcept',
          description: '',
          category: 'Water-cooled SMRs',
          subtype: 'iPWR',
          smr: reactorMeta({
            coolant: 'light water',
            neutron_spectrum: 'Thermal',
            electric_mwe: 77,
            status: 'Basic design',
            status_level: 2,
            countries: ['US'],
          }),
        },
      },
      {
        id: 'smr:kairos',
        data: {
          label: 'KP-FHR',
          nodeLabel: 'ReactorConcept',
          description: '',
          category: 'Molten salt',
          smr: reactorMeta({
            coolant: 'molten salt',
            neutron_spectrum: 'Thermal',
            electric_mwe: 140,
            status: 'Detailed design',
            status_level: 3,
            countries: ['US'],
          }),
        },
      },
      {
        id: 'concept_twr',
        data: {
          label: 'Traveling Wave Reactor',
          nodeLabel: 'ReactorConcept',
          description: '',
          category: 'Fission',
        },
      },
    ],
    edges: [],
  };

  const facets = buildCompanyWorldFacets(companies, mappings, techTree);
  const catalog = buildWorldFilterCatalog(facets);

  assert.ok(facets.get('nuscale')?.reactorTypes.has('PWR'));
  assert.ok(facets.get('kairos')?.reactorTypes.has('Molten salt'));
  assert.ok(facets.get('terra')?.reactorTypes.has('Fast reactor'));
  assert.ok(facets.get('kairos')?.countries.has('CA'));
  assert.ok(catalog.coolants.some((option) => option.value === 'Light Water'));
  assert.ok(catalog.statusLevels.some((option) => option.value === 2));

  const moltenOnly: WorldViewFilters = {
    ...EMPTY_WORLD_FILTERS,
    reactorTypes: ['Molten salt'],
  };
  assert.deepEqual(
    filterCompaniesByWorldFilters(companies, facets, moltenOnly).map((c) => c.id),
    ['kairos'],
  );

  const thermalUs: WorldViewFilters = {
    ...EMPTY_WORLD_FILTERS,
    spectra: ['Thermal'],
    countries: ['US'],
  };
  assert.deepEqual(
    filterCompaniesByWorldFilters(companies, facets, thermalUs).map((c) => c.id).sort(),
    ['kairos', 'nuscale'],
  );

  const status3: WorldViewFilters = {
    ...EMPTY_WORLD_FILTERS,
    statusLevels: [3],
  };
  assert.equal(
    companyMatchesWorldFilters(facets.get('kairos'), status3),
    true,
  );
  assert.equal(
    companyMatchesWorldFilters(facets.get('nuscale'), status3),
    false,
  );

  assert.equal(countActiveWorldFilters(thermalUs), 2);
  assert.deepEqual(toggleWorldFilterValue(['PWR'], 'BWR'), ['PWR', 'BWR']);
  assert.deepEqual(toggleWorldFilterValue(['PWR', 'BWR'], 'PWR'), ['BWR']);
});
