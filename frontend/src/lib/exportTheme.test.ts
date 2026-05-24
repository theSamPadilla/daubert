// frontend/src/lib/exportTheme.test.ts
import { EXPORT_THEMES } from './exportTheme';

describe('EXPORT_THEMES', () => {
  it('has both dark and light palettes', () => {
    expect(EXPORT_THEMES.dark).toBeDefined();
    expect(EXPORT_THEMES.light).toBeDefined();
  });

  it('dark and light differ on every styled token', () => {
    const d = EXPORT_THEMES.dark;
    const l = EXPORT_THEMES.light;
    expect(d.pngBackground).not.toBe(l.pngBackground);
    expect(d.edgeLabelColor).not.toBe(l.edgeLabelColor);
    expect(d.edgeLabelBgColor).not.toBe(l.edgeLabelBgColor);
    expect(d.parentBackgroundOpacity).not.toBe(l.parentBackgroundOpacity);
    expect(d.parentBorderOpacity).not.toBe(l.parentBorderOpacity);
  });

  it('dark palette matches current export defaults', () => {
    // If these values change, exports of saved investigations will shift.
    // Bumping these requires a visual review.
    expect(EXPORT_THEMES.dark.pngBackground).toBe('#0B1220');
    expect(EXPORT_THEMES.dark.edgeLabelColor).toBe('#d1d5db');
    expect(EXPORT_THEMES.dark.edgeLabelBgColor).toBe('#111827');
  });
});
