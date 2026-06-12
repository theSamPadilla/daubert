/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: 'var(--ink)',
          soft: 'var(--ink-soft)',
          muted: 'var(--ink-muted)',
          faint: 'var(--ink-faint)',
        },
        surface: {
          DEFAULT: 'var(--surface)',
          panel: 'var(--surface-panel)',
          raised: 'var(--surface-raised)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        brand: {
          DEFAULT: 'var(--brand)',
          strong: 'var(--brand-strong)',
          soft: 'var(--brand-soft)',
          ink: 'var(--brand-ink)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
        },
        redline: {
          DEFAULT: 'var(--redline)',
        },
        canvas: {
          DEFAULT: 'var(--canvas)',
          line: 'var(--canvas-line)',
          fill: 'var(--canvas-fill)',
          ink: 'var(--canvas-ink)',
          muted: 'var(--canvas-muted)',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
