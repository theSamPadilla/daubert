'use client';

import { FaDownload } from 'react-icons/fa6';
import { Investigation } from '../types/investigation';

interface HeaderProps {
  investigation: Investigation | null;
  onExportClick: () => void;
  rightContent?: React.ReactNode;
}

export function Header({
  investigation,
  onExportClick,
  rightContent,
}: HeaderProps) {
  return (
    <header className="bg-[#F7F8FB] border-b border-[#E5E7EB] h-12 px-4 flex items-center justify-between gap-4">
      <div className="flex items-baseline gap-3 shrink-0 min-w-0">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#5B6473]">
          Investigation
        </span>
        <h1 className="text-[15px] font-semibold tracking-tight text-[#0B1220] truncate">
          {investigation?.name || 'Daubert'}
        </h1>
      </div>

      <div className="flex gap-2 items-center shrink-0">
        <button
          onClick={onExportClick}
          className="px-3 h-8 bg-white hover:bg-[#F1F4FA] border border-[#E5E7EB] hover:border-[#CFD4DD] text-[#5B6473] hover:text-[#0B1220] rounded-md text-xs font-medium transition-colors flex items-center gap-1.5"
        >
          <FaDownload size={11} /> Export
        </button>
        {rightContent}
      </div>
    </header>
  );
}
