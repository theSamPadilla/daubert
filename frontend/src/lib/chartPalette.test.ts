import { getBrandChartOptions } from './chartPalette';

describe('getBrandChartOptions', () => {
  it('dark and light produce different chrome colors', () => {
    const d = getBrandChartOptions('dark');
    const l = getBrandChartOptions('light');
    expect(d.scales.x.grid.color).not.toBe(l.scales.x.grid.color);
    expect(d.scales.x.ticks.color).not.toBe(l.scales.x.ticks.color);
    expect(d.plugins.legend.labels.color).not.toBe(l.plugins.legend.labels.color);
  });

  it('light grid color is bright (contrasts against white bg)', () => {
    const l = getBrandChartOptions('light');
    expect(l.scales.x.grid.color).toBe('#e5e7eb');
  });
});
