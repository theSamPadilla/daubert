import { ReactNode } from 'react';

const TONES = {
  brand: 'bg-brand-soft text-brand',
  neutral: 'bg-surface-raised text-ink-muted',
  accent: 'bg-accent/10 text-accent',
  danger: 'bg-redline/10 text-redline',
} as const;

type Props = {
  tone?: keyof typeof TONES;
  className?: string;
  children: ReactNode;
};

export function Badge({ tone = 'neutral', className = '', children }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
