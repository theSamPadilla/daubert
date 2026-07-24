/**
 * skill-registry unit tests.
 *
 * The registry is built once at import time by scanning `*.md` files in this
 * directory and parsing their frontmatter (see loadRegistry() in
 * skill-registry.ts). These tests exercise the real filesystem scan rather
 * than mocking it, so a skill with malformed or missing frontmatter fails
 * the suite immediately.
 */

import { SKILL_NAMES, SKILL_REGISTRY, getSkillContent } from './skill-registry';

describe('skill-registry', () => {
  it('includes the redlining skill', () => {
    expect(SKILL_NAMES).toContain('redlining');
  });

  it('registers redlining with a non-empty description', () => {
    const redlining = SKILL_REGISTRY.find((s) => s.name === 'redlining');
    expect(redlining).toBeDefined();
    expect(redlining!.description.length).toBeGreaterThan(0);
  });

  it('returns redlining skill content with frontmatter stripped', () => {
    const content = getSkillContent('redlining');
    expect(content).not.toBeNull();
    expect(content).not.toMatch(/^---/);
    expect(content).toContain('# Redlining');
  });
});
