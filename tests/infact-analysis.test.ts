import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  extractInfactV2Analysis,
  extractLatestInfactAnalysis,
  formatInfactPercent,
  infactAnalysisSlug,
  infactProbabilityColorClass,
  parseSmrInfactAnalysis,
} from '@/lib/infactAnalysis';
import { loadInfactAnalysisDocuments } from '@/lib/infactAnalysisIngestion.server';
import {
  loadSmrInfactV2Analysis,
  readSmrInfactV2Report,
} from '@/lib/infactAnalysisV2.server';

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
  assert.deepEqual(
    parseSmrInfactAnalysis({ ...stored, primary: 'technology' }),
    { ...stored, primary: 'technology' },
  );
  assert.equal(
    parseSmrInfactAnalysis({ ...stored, primary: 'unknown' }),
    null,
  );
  assert.equal(
    parseSmrInfactAnalysis({ ...stored, has_report: undefined }),
    null,
  );
  assert.equal(parseSmrInfactAnalysis({ ...stored, interval: [0.2] }), null);
  assert.equal(parseSmrInfactAnalysis({ ...stored, probability: 1.2 }), null);
});

test('InFact v2 summaries come from the primary technology/application result', () => {
  const analysis = extractInfactV2Analysis({
    method: 'infact-v2',
    node_id: 'tech:steam-turbine',
    node_label: 'Steam turbine',
    primary: 'technology',
    trl_current: '9',
    results: {
      technology: { probability: 0.9139, interval: [0.706, 0.9822] },
      application: { probability: 0.6002, interval: [0.2832, 0.7169] },
    },
    evidence: [{}, {}, {}],
  });

  assert.deepEqual(analysis, {
    node_label: 'Steam turbine',
    trl_current: '9',
    probability: 0.9139,
    interval: [0.706, 0.9822],
    evidence_count: 3,
    primary: 'technology',
  });
});

test('malformed InFact v2 payloads are rejected', () => {
  const valid = {
    method: 'infact-v2',
    node_label: 'Natural circulation',
    primary: 'application',
    trl_current: '9',
    results: {
      application: { probability: 0.25, interval: [0.08, 0.76] },
    },
    evidence: [{}],
  };
  assert.equal(
    extractInfactV2Analysis({ ...valid, method: 'infact-v1' }),
    null,
  );
  assert.equal(
    extractInfactV2Analysis({ ...valid, primary: 'technology' }),
    null,
  );
  assert.equal(extractInfactV2Analysis({ ...valid, evidence: [] }), null);
  assert.equal(
    extractInfactV2Analysis({
      ...valid,
      results: { application: { probability: 1.2, interval: [0, 1] } },
    }),
    null,
  );
});

test('the filesystem loader matches v2 files by node label and validates the node id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infact-v2-runtime-'));
  try {
    const slug = 'high-assay-low-enriched-uranium-(haleu)';
    fs.writeFileSync(
      path.join(root, `${slug}.json`),
      JSON.stringify({
        method: 'infact-v2',
        node_id: 'tech:haleu',
        node_label: 'High-assay low-enriched uranium (HALEU)',
        primary: 'application',
        trl_current: '7-8',
        results: {
          application: { probability: 0.0584, interval: [0.0055, 0.3723] },
        },
        evidence: [{}, {}],
      }),
    );
    fs.writeFileSync(path.join(root, `${slug}.html`), '<html>v2 report</html>');

    const loaded = loadSmrInfactV2Analysis(
      'tech:haleu',
      'High-assay low-enriched uranium (HALEU)',
      root,
    );

    assert.equal(loaded?.slug, slug);
    assert.deepEqual(loaded?.analysis, {
      node_label: 'High-assay low-enriched uranium (HALEU)',
      trl_current: '7-8',
      probability: 0.0584,
      interval: [0.0055, 0.3723],
      evidence_count: 2,
      has_report: true,
      primary: 'application',
    });
    assert.equal(readSmrInfactV2Report(loaded!), '<html>v2 report</html>');
    assert.equal(
      loadSmrInfactV2Analysis(
        'tech:other-id',
        'High-assay low-enriched uranium (HALEU)',
        root,
      ),
      null,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a valid v2 analysis without a rendered report still has a v2 summary', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infact-v2-runtime-'));
  try {
    fs.writeFileSync(
      path.join(root, 'hastelloy-n-alloy.json'),
      JSON.stringify({
        method: 'infact-v2',
        node_id: 'tech:hastelloy-n-alloy',
        node_label: 'Hastelloy N alloy',
        primary: 'technology',
        trl_current: '9',
        results: {
          technology: { probability: 0.4, interval: [0.2, 0.7] },
        },
        evidence: [{}],
      }),
    );

    const loaded = loadSmrInfactV2Analysis(
      'tech:hastelloy-n-alloy',
      'Hastelloy N alloy',
      root,
    );

    assert.equal(loaded?.analysis.has_report, false);
    assert.equal(loaded?.analysis.probability, 0.4);
    assert.equal(readSmrInfactV2Report(loaded!), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
