import { composeExhibitHtml } from './exhibit-composer';

describe('composeExhibitHtml', () => {
  it('renders one section per item with banner header', () => {
    const html = composeExhibitHtml([
      { title: 'Item A', subtitle: 'sub a', bodyHtml: '<p>body a</p>' },
      { title: 'Item B', bodyHtml: '<p>body b</p>' },
    ]);
    expect(html).toContain('Item A');
    expect(html).toContain('sub a');
    expect(html).toContain('<p>body a</p>');
    expect(html).toContain('Item B');
    expect(html).toContain('<p>body b</p>');
  });

  it('inserts page-break-before on items after the first', () => {
    const html = composeExhibitHtml([
      { title: 'A', bodyHtml: '<p>a</p>' },
      { title: 'B', bodyHtml: '<p>b</p>' },
      { title: 'C', bodyHtml: '<p>c</p>' },
    ]);
    // Count page-break sections — should be 2 (between A→B and B→C)
    const matches = html.match(/class="exhibit-item page-break"/g);
    expect(matches?.length).toBe(2);
  });

  it('escapes user-provided titles', () => {
    const html = composeExhibitHtml([
      { title: '<script>x</script>', bodyHtml: '<p>safe</p>' },
    ]);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('per-type style class names survive composition', () => {
    const html = composeExhibitHtml([
      { title: 'Test', bodyHtml: '<p>body</p>' },
    ]);
    // CHRONOLOGY_STYLES includes .chronology rule
    expect(html).toContain('.chronology');
    // BASE_STYLES includes .citation rule
    expect(html).toContain('.citation');
  });

  it('produces a valid HTML document structure', () => {
    const html = composeExhibitHtml([
      { title: 'Only', bodyHtml: '<p>solo</p>' },
    ]);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<style>');
  });

  it('does not add page-break class to first item', () => {
    const html = composeExhibitHtml([
      { title: 'First', bodyHtml: '<p>first</p>' },
      { title: 'Second', bodyHtml: '<p>second</p>' },
    ]);
    // The first section must not have the page-break class
    const firstSection = html.match(/<section class="exhibit-item[^"]*"/g)?.[0];
    expect(firstSection).toBe('<section class="exhibit-item"');
    expect(firstSection).not.toContain('page-break');
  });

  it('omits subtitle paragraph when subtitle is absent', () => {
    const html = composeExhibitHtml([
      { title: 'No Sub', bodyHtml: '<p>x</p>' },
    ]);
    expect(html).not.toContain('<p class="subtitle">');
  });

  it('includes exhibit-graph-img and exhibit-chart-img CSS', () => {
    const html = composeExhibitHtml([{ title: 'T', bodyHtml: '' }]);
    expect(html).toContain('.exhibit-graph-img');
    expect(html).toContain('.exhibit-chart-img');
  });
});
