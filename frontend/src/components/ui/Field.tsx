import { ReactNode } from 'react';

type Props = {
  label: string;
  error?: string;
  children: ReactNode;
  className?: string;
};

export function Field({ label, error, children, className = '' }: Props) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label className="text-[13px] font-medium text-ink-soft">{label}</label>
      {children}
      {error && <p className="text-[13px] text-redline">{error}</p>}
    </div>
  );
}
