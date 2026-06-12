import { forwardRef, SelectHTMLAttributes } from 'react';

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  className?: string;
};

export const Select = forwardRef<HTMLSelectElement, Props>(function Select(
  { className = '', ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={`w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${className}`}
      {...rest}
    />
  );
});
