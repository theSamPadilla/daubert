'use client';

import { useRef, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa6';
import { AuthGuard } from '@/components/AuthGuard';
import { CaseProvider, useCaseContext } from '@/contexts/CaseContext';
import { InvestigationsSidebar } from '@/components/InvestigationsSidebar';
import { AIChat } from '@/components/AIChat';
import { NewPrimaryModal } from '@/components/NewPrimaryModal';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 400;
const CHAT_MIN = 320;
const CHAT_MAX = 900;

function CaseShell({ children }: { children: React.ReactNode }) {
  const {
    caseId,
    sidebarOpen,
    setSidebarOpen,
    sidebarWidth,
    setSidebarWidth,
    chatOpen,
    setChatOpen,
    chatWidth,
    setChatWidth,
    activeInvestigationId,
    onGraphUpdated,
    newPrimaryOpen,
  } = useCaseContext();

  // Unified drag ref — tracks which panel is being resized
  const dragRef = useRef<{ panel: 'sidebar' | 'chat'; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { panel, startX, startW } = dragRef.current;
      if (panel === 'sidebar') {
        const delta = e.clientX - startX;
        setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + delta)));
      } else {
        const delta = startX - e.clientX;
        setChatWidth(Math.min(CHAT_MAX, Math.max(CHAT_MIN, startW + delta)));
      }
    };
    const onMouseUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [setSidebarWidth, setChatWidth]);

  const startDrag = (panel: 'sidebar' | 'chat', e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      panel,
      startX: e.clientX,
      startW: panel === 'sidebar' ? sidebarWidth : chatWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div className="h-screen flex bg-gray-900 text-white">
      {/* Sidebar */}
      <div
        className={`relative flex-shrink-0 overflow-hidden h-full ${sidebarOpen ? '' : 'w-0'}`}
        style={sidebarOpen ? { width: sidebarWidth } : undefined}
      >
        <InvestigationsSidebar caseId={caseId} />
        {/* Right-edge drag handle */}
        {sidebarOpen && (
          <div
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors"
            onMouseDown={(e) => startDrag('sidebar', e)}
          />
        )}
      </div>

      {/* Center content */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen((v: boolean) => !v)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-30 w-4 h-10 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-r flex items-center justify-center transition-colors"
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarOpen ? <FaChevronLeft size={8} /> : <FaChevronRight size={8} />}
        </button>
        {/* Chat toggle */}
        <button
          onClick={() => setChatOpen((v: boolean) => !v)}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-30 w-4 h-10 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-l flex items-center justify-center transition-colors"
          title={chatOpen ? 'Collapse chat' : 'Expand chat'}
        >
          {chatOpen ? <FaChevronRight size={8} /> : <FaChevronLeft size={8} />}
        </button>

        {children}
      </div>

      {/* Chat panel */}
      <div
        className={`relative flex-shrink-0 overflow-hidden h-full ${chatOpen ? '' : 'w-0'}`}
        style={chatOpen ? { width: chatWidth } : undefined}
      >
        {chatOpen && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors"
            onMouseDown={(e) => startDrag('chat', e)}
          />
        )}
        <AIChat
          activeCaseId={caseId}
          activeInvestigationId={activeInvestigationId}
          onGraphUpdated={onGraphUpdated}
        />
      </div>

      {/* New Primary modal */}
      {newPrimaryOpen && <NewPrimaryModal />}
    </div>
  );
}

export default function CaseLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const caseId = params.caseId as string;

  return (
    <AuthGuard>
      <CaseProvider caseId={caseId}>
        <CaseShell>{children}</CaseShell>
      </CaseProvider>
    </AuthGuard>
  );
}
