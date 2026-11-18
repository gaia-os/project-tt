import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyExplorerPatch,
  parseExplorerParams,
} from '@/lib/explorerUrlState';
import { readOnboardingState, writeOnboardingState } from '@/lib/onboardingStorage';

const parse = (query: string) => parseExplorerParams(new URLSearchParams(query));

test('parses valid params and falls back to defaults for invalid ones', () => {
  assert.deepEqual(parse('topic=smr&view=world&focus=a&pathway=b&step=2'), {
    topic: 'smr',
    view: 'world',
    focus: 'a',
    pathway: 'b',
    step: 2,
    panel: null,
    tech: null,
    tree: null,
  });
  assert.deepEqual(parse('topic=a%2Fb&view=map&step=-1'), {
    topic: null,
    view: 'technology',
    focus: null,
    pathway: null,
    step: 0,
    panel: null,
    tech: null,
    tree: null,
  });
});

test('step is ignored without a pathway', () => {
  assert.equal(parse('step=3').step, 0);
  assert.equal(parse('pathway=x&step=abc').step, 0);
});

test('patch sets, removes and omits default values', () => {
  const start = new URLSearchParams('topic=nuclear&focus=a&view=company');
  const next = applyExplorerPatch(start, {
    view: 'technology',
    focus: null,
    pathway: 'concept_x',
    step: 2,
  });
  assert.equal(next.toString(), 'topic=nuclear&pathway=concept_x&step=2');

  const cleared = applyExplorerPatch(next, { pathway: null });
  assert.equal(cleared.toString(), 'topic=nuclear');
  assert.equal(start.toString(), 'topic=nuclear&focus=a&view=company');
});

test('a custom tree id round-trips and can be cleared', () => {
  assert.equal(parse('topic=nuclear&tree=ct_abc').tree, 'ct_abc');
  assert.equal(parse('tree=').tree, null);
  const opened = applyExplorerPatch(new URLSearchParams('topic=nuclear&pathway=p'), {
    tree: 'ct_abc',
    pathway: null,
  });
  assert.equal(opened.toString(), 'topic=nuclear&tree=ct_abc');
  assert.equal(applyExplorerPatch(opened, { tree: null }).toString(), 'topic=nuclear');
});

test('step 0 is omitted from the URL', () => {
  const next = applyExplorerPatch(new URLSearchParams('pathway=a&step=3'), { step: 0 });
  assert.equal(next.toString(), 'pathway=a');
});

test('onboarding storage degrades to an empty state without localStorage', () => {
  assert.deepEqual(readOnboardingState(), {
    completedAt: null,
    lastTopic: null,
    lastTechnologyId: null,
  });
  assert.equal(writeOnboardingState({ lastTopic: 'smr' }).lastTopic, 'smr');
});
