import { ReactNode } from 'react';

type Props = {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, body, action, className = '' }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-center ${className}`}>
      {icon && <div className="text-ink-faint">{icon}</div>}
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {body && <p className="text-sm text-ink-muted">{body}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
