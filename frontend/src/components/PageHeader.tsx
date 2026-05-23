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
    <header className="bg-[#F7F8FB] border-b border-[#E5E7EB] h-12 px-4 flex items-center justify-between gap-4 shrink-0">
      <div className="flex items-baseline gap-3 shrink-0 min-w-0">
        {eyebrow && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#5B6473]">
            {eyebrow}
          </span>
        )}
        <h1 className="text-[15px] font-semibold tracking-tight text-[#0B1220] truncate">
          {title}
        </h1>
        {subtitle && (
          <span className="text-sm text-[#5B6473] truncate">{subtitle}</span>
        )}
      </div>

      <div className="flex gap-2 items-center shrink-0">
        {actions}
        {rightContent}
      </div>
    </header>
  );
}
