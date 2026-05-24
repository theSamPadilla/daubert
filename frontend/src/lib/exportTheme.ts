// frontend/src/lib/exportTheme.ts

export type ExportTheme = 'dark' | 'light';

export interface ExportThemePalette {
  // PNG canvas background (cy.png bg parameter)
  pngBackground: string;

  // Edge label
  edgeLabelColor: string;
  edgeLabelBgColor: string;

  // Compound (trace group) parent
  parentBackgroundOpacity: number;
  parentBorderOpacity: number;
}

export const EXPORT_THEMES: Record<ExportTheme, ExportThemePalette> = {
  dark: {
    pngBackground: '#0B1220',
    edgeLabelColor: '#d1d5db',
    edgeLabelBgColor: '#111827',
    parentBackgroundOpacity: 0.07,
    parentBorderOpacity: 0.45,
  },
  light: {
    pngBackground: '#ffffff',
    edgeLabelColor: '#374151',
    edgeLabelBgColor: '#f3f4f6',
    parentBackgroundOpacity: 0.15,
    parentBorderOpacity: 0.7,
  },
};
