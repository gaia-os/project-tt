import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanConceptLabel } from '@/lib/pathway';
import {
  buildTechnologyCatalog,
  suggestTechnologies,
  summarizeBlurb,
  summarizeTree,
} from '@/lib/technologyCatalog';
import { SmrNodeMeta, TechTree } from '@/lib/types';
import { loadDatasetTree } from './helpers/datasetTree';

const nuclear = loadDatasetTree('nuclear_tt_v2.json');
const fossil = loadDatasetTree('fossil_fuel_tt_v2.json');

test('nuclear labels lose the "Concept:" prefix', () => {
  assert.equal(cleanConceptLabel('Concept: LTS Tokamak'), 'LTS Tokamak');
  const catalog = buildTechnologyCatalog(nuclear);
  assert.equal(catalog.length, 12);
  assert.ok(catalog.every((entry) => !entry.label.startsWith('Concept:')));

  const hts = catalog.find((entry) => entry.id === 'concept_hts_tokamak');
  assert.equal(hts?.label, 'HTS Tokamak');
  assert.equal(hts?.prerequisiteCount, 12);
  assert.equal(hts?.category, 'Fusion');
  assert.equal(hts?.trl, 4);
});

test('duplicate fossil labels are disambiguated by TRL', () => {
  const catalog = buildTechnologyCatalog(fossil);
  assert.equal(catalog.length, 41);
  assert.equal(new Set(catalog.map((entry) => entry.label)).size, catalog.length);

  const labels = catalog
    .filter((entry) => entry.label.startsWith('Coal–Ammonia Co-firing (50%+ target)'))
    .map((entry) => entry.label)
    .sort();
  assert.deepEqual(labels, [
    'Coal–Ammonia Co-firing (50%+ target) (TRL 4)',
    'Coal–Ammonia Co-firing (50%+ target) (TRL 6)',
  ]);
});

test('fossil cards get a one-sentence blurb from the description', () => {
  const catalog = buildTechnologyCatalog(fossil);
  assert.ok(catalog.every((entry) => entry.blurb));
  assert.ok(catalog.every((entry) => entry.blurb!.length <= 181));
});

test('blurbs keep the first sentence and cut long ones at a word boundary', () => {
  assert.equal(summarizeBlurb('First one. Second one.'), 'First one.');
  assert.equal(summarizeBlurb('Pressure of 24.1 MPa is used. Then more.'), 'Pressure of 24.1 MPa is used.');
  const long = summarizeBlurb(`${'word '.repeat(60)}end.`)!;
  assert.ok(long.endsWith('…'));
  assert.ok(long.length <= 181);
  assert.equal(summarizeBlurb('   '), null);
});

test('SMR reactors use catalogue facts and count prerequisites at the default detail level', () => {
  const reactor: SmrNodeMeta = {
    kind: 'reactor',
    status: 'Licensing',
    status_level: 3,
    coverage: 'matched',
    electric_mwe: 77,
    thermal_mwth: 250,
    coolant: 'Light water',
    neutron_spectrum: 'Thermal',
    countries: ['US'],
    developers: [],
    image_count: 1,
    cover_image_id: 'img-1',
  };
  const technology = (relevance: number): SmrNodeMeta => ({
    kind: 'technology',
    relevance,
    importance_score: null,
    reactor_reach: null,
    tree_level: 1,
    origin: null,
    availability: null,
  });
  const tree: TechTree = {
    nodes: [
      { id: 'smr:a', data: { label: 'SMR A', nodeLabel: 'ReactorConcept', description: 'SMR A', smr: reactor } },
      { id: 'tech:core', data: { label: 'Core', nodeLabel: 'EnablingTechnology', description: 'Core', smr: technology(5) } },
      { id: 'tech:minor', data: { label: 'Minor', nodeLabel: 'EnablingTechnology', description: 'Minor', smr: technology(1) } },
    ],
    edges: [
      { id: 'tech:core->smr:a', source: 'tech:core', target: 'smr:a' },
      { id: 'tech:minor->smr:a', source: 'tech:minor', target: 'smr:a' },
    ],
  };

  const [entry] = buildTechnologyCatalog(tree);
  assert.equal(entry.blurb, 'Licensing · 77 MWe · Light water');
  assert.equal(entry.smr?.coverImageId, 'img-1');
  assert.equal(entry.prerequisiteCount, 1);
});

test('tree summary counts nodes by role', () => {
  assert.deepEqual(summarizeTree(nuclear), {
    concepts: 12,
    milestones: 21,
    technologies: 12,
  });
});

test('suggestTechnologies keeps a short diverse shortlist', () => {
  const catalog = buildTechnologyCatalog(nuclear);
  const suggested = suggestTechnologies(catalog, 'concept_hts_tokamak', 6);
  assert.equal(suggested.length, 6);
  assert.equal(suggested[0].id, 'concept_hts_tokamak');
  assert.equal(new Set(suggested.map((entry) => entry.id)).size, 6);
});
