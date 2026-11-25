import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractLatestInfactAnalysis,
  formatInfactPercent,
  infactAnalysisSlug,
  infactProbabilityColorClass,
} from '@/lib/infactAnalysis';

test('the InFact slug follows the report generator filename convention', () => {
  assert.equal(infactAnalysisSlug('7LiF-UF4 fuel salt'), '7lif-uf4-fuel-salt');
  assert.equal(
    infactAnalysisSlug('Digital Instrumentation and Control (I&C)'),
    'digital-instrumentation-and-control-(i&c)',
  );
  assert.equal(infactAnalysisSlug('A/B technology'), 'a-b-technology');
});

test('the latest evidence entry supplies the cumulative probability and interval', () => {
  const analysis = extractLatestInfactAnalysis({
    node_label: '7LiF-UF4 fuel salt',
    trl_current: '5-6',
    evidence: [
      {
        probability: 0.05,
        interval: [0.0, 0.65],
      },
      {
        probability: 0.48671342133014284,
        interval: [0.26223247854459225, 0.7141071938322496],
      },
    ],
  });

  assert.deepEqual(analysis, {
    node_label: '7LiF-UF4 fuel salt',
    trl_current: '5-6',
    probability: 0.48671342133014284,
    interval: [0.26223247854459225, 0.7141071938322496],
    evidence_count: 2,
  });
});

test('malformed or out-of-range InFact payloads are rejected', () => {
  assert.equal(extractLatestInfactAnalysis(null), null);
  assert.equal(
    extractLatestInfactAnalysis({
      node_label: 'x',
      trl_current: '5',
      evidence: [],
    }),
    null,
  );
  assert.equal(
    extractLatestInfactAnalysis({
      node_label: 'x',
      trl_current: '5',
      evidence: [{ probability: 1.2, interval: [0, 1] }],
    }),
    null,
  );
  assert.equal(
    extractLatestInfactAnalysis({
      node_label: 'x',
      trl_current: '5',
      evidence: [{ probability: 0.5, interval: [0] }],
    }),
    null,
  );
});

test('percentages use one decimal and tiny nonzero values remain visibly nonzero', () => {
  assert.equal(formatInfactPercent(0.48671342133014284), '48.7%');
  assert.equal(formatInfactPercent(0.26223247854459225), '26.2%');
  assert.equal(formatInfactPercent(0.8), '80.0%');
  assert.equal(formatInfactPercent(0.00001), '<0.1%');
  assert.equal(formatInfactPercent(0), '0.0%');
});

test('probability colors implement five ordered levels with green at 80-100%', () => {
  assert.match(infactProbabilityColorClass(0.19), /bg-red-600/);
  assert.match(infactProbabilityColorClass(0.2), /bg-red-400/);
  assert.match(infactProbabilityColorClass(0.4), /bg-yellow-300/);
  assert.match(infactProbabilityColorClass(0.6), /bg-green-300/);
  assert.match(infactProbabilityColorClass(0.8), /bg-green-600/);
  assert.match(infactProbabilityColorClass(1), /bg-green-600/);
});
