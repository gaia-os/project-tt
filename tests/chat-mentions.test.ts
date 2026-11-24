import assert from 'node:assert/strict';
import test from 'node:test';
import { matchMentionsToCompanies } from '@/lib/chatMentions';
import { ChatMention, CompanySummary } from '@/lib/types';

const company = (id: string, canonical_name: string) => ({
  company: { id, canonical_name } as CompanySummary,
  technologyCount: 1,
});

const entries = [
  company('nuscale', 'NuScale Power Corporation'),
  company('oklo', 'Oklo Inc.'),
  company('rolls', 'Rolls-Royce SMR'),
];

test('matches company cards by name, alias and legal-form suffix', () => {
  const mentions: ChatMention[] = [
    { text: 'Oklo', name: 'Oklo', kind: 'Organisation' },
    { text: 'NuScale Power', kind: 'Organisation' },
    { text: 'rolls royce smr' },
    { text: 'Rolls-Royce' },
  ];
  const { companies, matched } = matchMentionsToCompanies(mentions, entries);
  assert.deepEqual(
    companies.map((entry) => entry.company.id),
    ['oklo', 'nuscale', 'rolls'],
  );
  assert.equal(matched.size, 3);
  assert.ok(!matched.has(mentions[3]));
});

test('ignores mentions without a card and dedupes repeated companies', () => {
  const mentions: ChatMention[] = [
    { text: 'NuScale Power Corp', name: 'NuScale Power Corporation' },
    { text: 'NuScale', name: 'NuScale Power Corporation' },
    { text: 'TerraPower', name: 'TerraPower' },
    { text: 'BWRX-300/Oklo' },
  ];
  const { companies, matched } = matchMentionsToCompanies(mentions, entries);
  assert.deepEqual(
    companies.map((entry) => entry.company.id),
    ['nuscale', 'oklo'],
  );
  assert.ok(!matched.has(mentions[2]));
  assert.equal(matched.size, 3);
});
