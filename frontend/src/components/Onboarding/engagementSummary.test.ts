import { buildEngagementSummary } from './engagementSummary';

it('returns null when everything is empty', () => {
  expect(buildEngagementSummary({ side: '', scope: '', allegations: '' })).toBeNull();
});
it('renders only the provided fields as markdown', () => {
  const md = buildEngagementSummary({ side: 'plaintiff', scope: 'Trace the escrow funds', allegations: '' });
  expect(md).toContain('**Retained by:** Plaintiff');
  expect(md).toContain('**Scope of engagement:** Trace the escrow funds');
  expect(md).not.toContain('allegations');
});
