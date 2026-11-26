import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  extractLatestInfactAnalysis,
  formatInfactPercent,
  infactAnalysisSlug,
  infactProbabilityColorClass,
  parseSmrInfactAnalysis,
} from '@/lib/infactAnalysis';
import { loadInfactAnalysisDocuments } from '@/lib/infactAnalysisIngestion.server';

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

test('stored InFact summaries are validated before being exposed by the API', () => {
  const stored = {
    node_label: '7LiF-UF4 fuel salt',
    trl_current: '5-6',
    probability: 0.48671342133014284,
    interval: [0.26223247854459225, 0.7141071938322496],
    evidence_count: 2,
    has_report: true,
  };
  assert.deepEqual(parseSmrInfactAnalysis(stored), stored);
  assert.equal(
    parseSmrInfactAnalysis({ ...stored, has_report: undefined }),
    null,
  );
  assert.equal(parseSmrInfactAnalysis({ ...stored, interval: [0.2] }), null);
  assert.equal(parseSmrInfactAnalysis({ ...stored, probability: 1.2 }), null);
});

test('ingestion stores the full analysis and HTML report under the matched technology id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infact-ingestion-'));
  try {
    const detailsDir = path.join(
      root,
      'infact-smr-analysis',
      'nodes',
      'node-infact-details',
    );
    fs.mkdirSync(detailsDir, { recursive: true });
    const payload = {
      node_label: '7LiF-UF4 fuel salt',
      trl_current: '5-6',
      hypothesis: 'hypothesis',
      evidence: [
        { probability: 0.2, interval: [0.1, 0.4] },
        { probability: 0.5, interval: [0.3, 0.7] },
      ],
    };
    fs.writeFileSync(
      path.join(detailsDir, '7lif-uf4-fuel-salt.json'),
      JSON.stringify(payload),
    );
    fs.writeFileSync(
      path.join(detailsDir, '7lif-uf4-fuel-salt.html'),
      '<html>report</html>',
    );

    const result = loadInfactAnalysisDocuments(
      root,
      new Map([['7LiF-UF4 fuel salt', 'tech:7lif-uf4-fuel-salt']]),
    );

    assert.equal(result.invalidFiles.length, 0);
    assert.equal(result.unmatchedLabels.length, 0);
    assert.equal(result.missingReports.length, 0);
    assert.equal(result.documents.length, 1);
    const [document] = result.documents;
    assert.equal(document.id, 'tech:7lif-uf4-fuel-salt');
    assert.equal(document.slug, '7lif-uf4-fuel-salt');
    assert.equal(document.probability, 0.5);
    assert.deepEqual(document.interval, [0.3, 0.7]);
    assert.equal(document.evidence_count, 2);
    assert.equal(document.has_report, true);
    assert.equal(document.report_html, '<html>report</html>');
    assert.deepEqual(document.analysis, payload);
    assert.deepEqual(document.source_files, {
      analysis: '7lif-uf4-fuel-salt.json',
      report: '7lif-uf4-fuel-salt.html',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ingestion reports invalid, unmatched and report-less inputs without stopping', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infact-ingestion-'));
  try {
    const detailsDir = path.join(
      root,
      'infact-smr-analysis',
      'nodes',
      'node-infact-details',
    );
    fs.mkdirSync(detailsDir, { recursive: true });
    const analysis = (label: string) => ({
      node_label: label,
      trl_current: '5',
      evidence: [{ probability: 0.5, interval: [0.3, 0.7] }],
    });
    fs.writeFileSync(
      path.join(detailsDir, 'matched.json'),
      JSON.stringify(analysis('Matched')),
    );
    fs.writeFileSync(
      path.join(detailsDir, 'unmatched.json'),
      JSON.stringify(analysis('Unmatched')),
    );
    fs.writeFileSync(path.join(detailsDir, 'invalid.json'), '{not json');

    const result = loadInfactAnalysisDocuments(
      root,
      new Map([['Matched', 'tech:matched']]),
    );

    assert.deepEqual(
      result.documents.map((document) => document.id),
      ['tech:matched'],
    );
    assert.deepEqual(result.unmatchedLabels, ['Unmatched']);
    assert.deepEqual(result.invalidFiles, ['invalid.json']);
    assert.deepEqual(result.missingReports, ['matched.json']);
    assert.equal(result.documents[0].has_report, false);
    assert.equal(result.documents[0].report_html, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
