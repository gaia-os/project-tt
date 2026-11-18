import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPathway,
  buildPathwaySteps,
  parseTrl,
  pathwaySubtree,
} from '@/lib/pathway';
import { NodeLabel, TechTree } from '@/lib/types';
import { loadDatasetTree } from './helpers/datasetTree';

const nuclear = loadDatasetTree('nuclear_tt_v2.json');
const fossil = loadDatasetTree('fossil_fuel_tt_v2.json');

const node = (id: string, nodeLabel: NodeLabel, trl?: string) => ({
  id,
  data: { label: id, nodeLabel, description: id, trl_current: trl },
});
const edge = (source: string, target: string) => ({
  id: `${source}->${target}`,
  source,
  target,
});

test('parseTrl reads the first integer and rejects out-of-range values', () => {
  assert.equal(parseTrl('4-5'), 4);
  assert.equal(parseTrl('TRL 7'), 7);
  assert.equal(parseTrl('12'), null);
  assert.equal(parseTrl(undefined), null);
});

test('HTS tokamak pathway has 12 prerequisites over 3 levels', () => {
  const pathway = buildPathway(nuclear, 'concept_hts_tokamak');
  assert.ok(pathway);
  assert.equal(pathway.prerequisiteCount, 12);
  assert.equal(pathway.nodeIds.length, 13);
  assert.equal(pathway.hiddenCount, 0);
  assert.equal(pathway.stages.length, 4);

  const last = pathway.stages[pathway.stages.length - 1];
  assert.deepEqual(last.nodeIds, ['concept_hts_tokamak']);
  assert.equal(pathway.stages[0].title, 'Foundations');
  assert.ok(pathway.bottleneck);
});

test('every pathway edge points from an earlier stage to a later one', () => {
  for (const tree of [nuclear, fossil]) {
    for (const concept of tree.nodes.filter(
      (candidate) => candidate.data.nodeLabel === 'ReactorConcept',
    )) {
      const pathway = buildPathway(tree, concept.id)!;
      const levelOf = new Map<string, number>();
      pathway.stages.forEach((stage) =>
        stage.nodeIds.forEach((id) => levelOf.set(id, stage.level)),
      );
      for (const pathwayEdge of pathway.edges) {
        assert.ok(
          levelOf.get(pathwayEdge.source)! < levelOf.get(pathwayEdge.target)!,
          `${concept.id}: ${pathwayEdge.id}`,
        );
      }
    }
  }
});

test('a fossil concept without prerequisites yields a single empty step', () => {
  const pathway = buildPathway(fossil, 'scgt_peaking');
  assert.ok(pathway);
  assert.equal(pathway.prerequisiteCount, 0);
  assert.deepEqual(pathway.stages.map((stage) => stage.nodeIds), [['scgt_peaking']]);

  const steps = buildPathwaySteps(pathway);
  assert.deepEqual(steps.map((step) => step.kind), ['empty']);
});

test('steps are overview, one per prerequisite stage, then the finale', () => {
  const pathway = buildPathway(nuclear, 'concept_hts_tokamak')!;
  const steps = buildPathwaySteps(pathway);
  assert.deepEqual(
    steps.map((step) => step.kind),
    ['overview', 'stage', 'stage', 'stage', 'finale'],
  );
  assert.equal(steps[1].dimOthers, true);
  assert.equal(steps[1].focusNodeId, pathway.stages[0].nodeIds[0]);
  assert.equal(steps[4].focusNodeId, 'concept_hts_tokamak');

  const subtree = pathwaySubtree(nuclear, pathway);
  assert.equal(subtree.nodes.length, pathway.nodeIds.length);
  assert.equal(subtree.edges.length, pathway.edgeIds.length);
});

test('stages sort enabling technologies first, then lowest TRL', () => {
  const tree: TechTree = {
    nodes: [
      node('target', 'ReactorConcept', '5'),
      node('m', 'Milestone', '2'),
      node('t-high', 'EnablingTechnology', '6'),
      node('t-low', 'EnablingTechnology', '3'),
    ],
    edges: [edge('m', 'target'), edge('t-high', 'target'), edge('t-low', 'target')],
  };
  const pathway = buildPathway(tree, 'target')!;
  assert.deepEqual(pathway.stages[0].nodeIds, ['t-low', 't-high', 'm']);
  assert.equal(pathway.stages[0].title, 'Foundations');
  assert.deepEqual(pathway.bottleneck, { nodeId: 'm', trl: 2 });
});

test('a single-node stage past the foundations is named after its node', () => {
  const tree: TechTree = {
    nodes: [
      node('target', 'ReactorConcept'),
      node('Concept: Earlier', 'ReactorConcept'),
      node('root', 'EnablingTechnology'),
    ],
    edges: [edge('root', 'Concept: Earlier'), edge('Concept: Earlier', 'target')],
  };
  const pathway = buildPathway(tree, 'target')!;
  assert.deepEqual(
    pathway.stages.map((stage) => stage.title),
    ['Foundations', 'Earlier', 'The deployment concept'],
  );
});

test('a cycle does not hang and the target stays alone in the last stage', () => {
  const tree: TechTree = {
    nodes: [
      node('target', 'ReactorConcept'),
      node('a', 'EnablingTechnology'),
      node('b', 'Milestone'),
    ],
    edges: [edge('a', 'b'), edge('b', 'a'), edge('b', 'target'), edge('target', 'a')],
  };
  const pathway = buildPathway(tree, 'target')!;
  assert.equal(pathway.prerequisiteCount, 2);
  assert.deepEqual(pathway.stages.at(-1)!.nodeIds, ['target']);
});

test('maxNodes keeps the nearest prerequisites and reports the rest', () => {
  const pathway = buildPathway(nuclear, 'concept_hts_tokamak', { maxNodes: 4 })!;
  assert.equal(pathway.prerequisiteCount, 4);
  assert.equal(pathway.hiddenCount, 8);
  const directPrerequisites = new Set(
    nuclear.edges
      .filter((candidate) => candidate.target === 'concept_hts_tokamak')
      .map((candidate) => candidate.source),
  );
  // Every kept prerequisite still reaches the target inside the pathway.
  for (const id of pathway.nodeIds) {
    if (id === 'concept_hts_tokamak') continue;
    const reaches =
      directPrerequisites.has(id) ||
      pathway.edges.some((pathwayEdge) => pathwayEdge.source === id);
    assert.ok(reaches, id);
  }
});

test('unknown targets return null', () => {
  assert.equal(buildPathway(nuclear, 'does-not-exist'), null);
});
