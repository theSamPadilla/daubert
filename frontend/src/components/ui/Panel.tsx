import { ReactNode } from 'react';

type Props = {
  padded?: boolean;
  className?: string;
  children: ReactNode;
};

export function Panel({ padded = false, className = '', children }: Props) {
  return (
    <div className={`bg-surface rounded-xl border border-line ${padded ? 'p-5' : ''} ${className}`}>
      {children}
    </div>
  );
}
