import { HTMLAttributes, ReactNode } from 'react';

type Props = HTMLAttributes<HTMLDivElement> & {
  padded?: boolean;
  children: ReactNode;
};

export function Panel({ padded = false, className = '', children, ...rest }: Props) {
  return (
    <div className={`bg-surface rounded-xl border border-line ${padded ? 'p-5' : ''} ${className}`} {...rest}>
      {children}
    </div>
  );
}
