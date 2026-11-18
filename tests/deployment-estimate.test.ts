import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SIMULATION_BASE_YEAR,
  createScheduleIndex,
  estimateCompletionYear,
  estimateDeploymentWindow,
  nodeDurationYears,
} from '@/lib/deploymentEstimate';
import { TechTree } from '@/lib/types';
import { loadDatasetTree } from './helpers/datasetTree';

const nuclear = loadDatasetTree('nuclear_tt_v2.json');

test('duration follows the scheduler rule of 2.5 years per remaining level', () => {
  assert.equal(nodeDurationYears({ trl_current: '4' }), 12.5);
  assert.equal(nodeDurationYears({ trl_current: '4-5' }), 12.5);
  assert.equal(nodeDurationYears({ trl_current: '9' }), 0);
  assert.equal(nodeDurationYears({}), 20);
  assert.equal(nodeDurationYears({ trl_current: 'unknown' }), 5);
  assert.equal(nodeDurationYears({ trl_current: '2', trl_projected_5_10_years: '5' }), 7.5);
  assert.equal(nodeDurationYears({ trl_current: '4' }, 1.5), 7.5);
});

test('reference concepts land on the years the scheduler produces', () => {
  const index = createScheduleIndex(nuclear);
  assert.equal(estimateCompletionYear(index, 'concept_lwr_smr'), 2046);
  assert.equal(estimateCompletionYear(index, 'concept_hts_tokamak'), 2074);
});

test('the window is ordered optimistic, base, cautious for every concept', () => {
  for (const node of nuclear.nodes.filter((n) => n.data.nodeLabel === 'ReactorConcept')) {
    const window = estimateDeploymentWindow(nuclear, node.id)!;
    assert.ok(window.optimistic <= window.base && window.base <= window.cautious, node.id);
    assert.ok(window.optimistic >= SIMULATION_BASE_YEAR, node.id);
  }
});

test('a node waits for its slowest prerequisite', () => {
  const tree: TechTree = {
    nodes: [
      { id: 'fast', data: { label: 'fast', nodeLabel: 'EnablingTechnology', description: '', trl_current: '8' } },
      { id: 'slow', data: { label: 'slow', nodeLabel: 'Milestone', description: '', trl_current: '5' } },
      { id: 'goal', data: { label: 'goal', nodeLabel: 'ReactorConcept', description: '', trl_current: '7' } },
    ],
    edges: [
      { id: 'fast->goal', source: 'fast', target: 'goal' },
      { id: 'slow->goal', source: 'slow', target: 'goal' },
    ],
  };
  assert.equal(estimateCompletionYear(createScheduleIndex(tree), 'goal'), SIMULATION_BASE_YEAR + 15);
});

test('cycles and unknown ids do not hang or throw', () => {
  const tree: TechTree = {
    nodes: [
      { id: 'a', data: { label: 'a', nodeLabel: 'Milestone', description: '', trl_current: '8' } },
      { id: 'b', data: { label: 'b', nodeLabel: 'Milestone', description: '', trl_current: '8' } },
    ],
    edges: [
      { id: 'a->b', source: 'a', target: 'b' },
      { id: 'b->a', source: 'b', target: 'a' },
    ],
  };
  const index = createScheduleIndex(tree);
  assert.equal(estimateCompletionYear(index, 'b'), SIMULATION_BASE_YEAR + 5);
  assert.equal(estimateCompletionYear(index, 'missing'), null);
});
