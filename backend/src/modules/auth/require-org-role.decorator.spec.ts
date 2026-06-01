import { orgRoleAtLeast } from './require-org-role.decorator';

describe('orgRoleAtLeast', () => {
  it.each([
    ['admin', 'guest', true],
    ['admin', 'member', true],
    ['admin', 'admin', true],
    ['member', 'guest', true],
    ['member', 'member', true],
    ['member', 'admin', false],
    ['guest', 'guest', true],
    ['guest', 'member', false],
    ['guest', 'admin', false],
  ] as const)('orgRoleAtLeast(%s, %s) === %s', (actual, required, expected) => {
    expect(orgRoleAtLeast(actual, required)).toBe(expected);
  });
});
