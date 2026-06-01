import { roleAtLeast } from './require-role.decorator';

describe('roleAtLeast', () => {
  it.each([
    ['owner', 'viewer', true],
    ['owner', 'editor', true],
    ['owner', 'owner', true],
    ['editor', 'viewer', true],
    ['editor', 'editor', true],
    ['editor', 'owner', false],
    ['viewer', 'viewer', true],
    ['viewer', 'editor', false],
    ['viewer', 'owner', false],
  ] as const)('roleAtLeast(%s, %s) === %s', (actual, required, expected) => {
    expect(roleAtLeast(actual, required)).toBe(expected);
  });
});
