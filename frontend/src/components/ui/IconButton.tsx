import { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  'aria-label': string;
};

export function IconButton({ className = '', ...rest }: Props) {
  return (
    <button
      className={`h-8 w-8 inline-flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface-raised transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60 disabled:pointer-events-none ${className}`}
      {...rest}
    />
  );
}
