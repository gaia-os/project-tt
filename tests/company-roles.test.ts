import assert from 'node:assert/strict';
import test from 'node:test';
import { companyRole } from '@/lib/companyRoles';
import { CompanyTechnologyMapping } from '@/lib/types';

const mapping = (
  overrides: Partial<CompanyTechnologyMapping>,
): CompanyTechnologyMapping => ({
  id: 'm',
  company_id: 'c',
  tech_tree_node_id: 't',
  is_primary: false,
  confidence: null,
  method: 'supplies',
  reasoning: null,
  ...overrides,
});

test('maps supply roles onto role groups', () => {
  assert.equal(companyRole([mapping({ roles: ['supplier'] })]), 'supplier');
  assert.equal(companyRole([mapping({ roles: ['manufacturer'] })]), 'manufacturer');
  assert.equal(companyRole([mapping({ roles: ['research_org'] })]), 'researcher');
  assert.equal(companyRole([mapping({ roles: ['operator'] })]), 'programme');
  assert.equal(companyRole([mapping({ roles: ['investor'] })]), 'other');
  assert.equal(companyRole([mapping({})]), 'supplier');
});

test('the highest role wins for mixed companies', () => {
  assert.equal(
    companyRole([
      mapping({ roles: ['supplier'] }),
      mapping({ is_primary: true, method: 'develops' }),
    ]),
    'developer',
  );
  assert.equal(
    companyRole([
      mapping({ roles: ['manufacturer'] }),
      mapping({ roles: ['research_org'] }),
    ]),
    'researcher',
  );
});
