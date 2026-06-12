import { ReactNode } from 'react';

type Props = {
  index?: number;
  className?: string;
  children: ReactNode;
};

export function Kicker({ index, className = '', children }: Props) {
  const prefix = index !== undefined ? `${String(index).padStart(2, '0')} · ` : '';
  return (
    <span
      className={`font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint ${className}`}
    >
      {prefix}{children}
    </span>
  );
}
