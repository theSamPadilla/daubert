'use client';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  rightContent?: React.ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  rightContent,
}: PageHeaderProps) {
  return (
    <header className="bg-surface-panel border-b border-line h-12 px-4 flex items-center justify-between gap-4 shrink-0">
      <div className="flex items-baseline gap-3 shrink-0 min-w-0">
        {eyebrow && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            {eyebrow}
          </span>
        )}
        <h1 className="text-sm font-medium text-ink truncate">
          {title}
        </h1>
        {subtitle && (
          <span className="text-sm text-ink-muted truncate">{subtitle}</span>
        )}
      </div>

      <div className="flex gap-2 items-center shrink-0">
        {actions}
        {rightContent}
      </div>
    </header>
  );
}
