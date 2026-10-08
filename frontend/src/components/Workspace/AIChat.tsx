'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FaArrowLeft, FaPlus, FaClockRotateLeft, FaXmark, FaChevronUp, FaChevronDown, FaPaperclip, FaTrash, FaArrowUp } from 'react-icons/fa6';
import { apiClient, ApiError, type AgentRun, type Conversation, type ChatMessage, type StartRunBody } from '@/lib/api-client';
import { subscribeRunEvents } from '@/lib/run-events';
import { ChatTurn } from './chatTurn';
import { useCaseContext } from '@/contexts/CaseContext';
import { Kicker } from '@/components/ui';

const RUN_CONNECTION_LOST =
  'Lost the connection to this response. It keeps running on the server, so reopen the conversation to see the result.';
const RUN_INTERRUPTED_NOTICE =
  'The previous response was interrupted before it finished. Send another message to continue.';

const ACCEPTED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv', 'application/csv', 'application/vnd.ms-excel',
  'text/markdown',
];
const ACCEPT_ATTR = [...ACCEPTED_TYPES, '.csv', '.docx', '.xlsx', '.txt', '.md'].join(',');

const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
] as const;

type ModelId = typeof MODELS[number]['id'];

interface ToolStatus {
  name: string;
  input?: Record<string, unknown>;
}

interface Attachment {
  id: string;
  name: string;
  mediaType: string;
  data: string; // base64
  previewUrl: string; // object URL or data URL for display
}

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant' | 'status';
  text: string;
  isStreaming?: boolean;
  attachments?: Pick<Attachment, 'name' | 'mediaType' | 'previewUrl'>[];
}

function extractText(content: ChatMessage['content']): string {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('');
}

function toLocalMessages(msgs: ChatMessage[]): LocalMessage[] {
  return msgs
    .filter((m) => extractText(m.content).length > 0)
    .map((m) => ({ id: m.id, role: m.role, text: extractText(m.content) }));
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatToolStatus(tool: ToolStatus): string {
  switch (tool.name) {
    case 'web_search':
      return 'Searching the web';
    case 'get_case_data':
      return 'Reading investigation data';
    case 'get_skill': {
      const skill = (tool.input as any)?.name;
      return skill ? `Loading ${skill}` : 'Loading skill';
    }
    case 'execute_script': {
      const name = (tool.input as any)?.name;
      return name ? `Running ${name}` : 'Running script';
    }
    case 'list_script_runs':
      return 'Checking past scripts';
    default:
      return tool.name.replace(/_/g, ' ');
  }
}

function StatusMessage({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-accent py-1 px-1">
      <span
        className="w-1.5 h-1.5 rounded-full bg-accent inline-block shrink-0"
        style={{ animation: 'toolPulse 1.5s ease-in-out infinite' }}
      />
      <span>{text}</span>
      <style>{`
        @keyframes toolPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function getExplorerLink(text: string): { url: string; kind: 'address' | 'tx' } | null {
  const s = text.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) {
    return { url: `https://etherscan.io/tx/${s}`, kind: 'tx' };
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) {
    return { url: `https://etherscan.io/address/${s}`, kind: 'address' };
  }
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) {
    return { url: `https://tronscan.org/#/address/${s}`, kind: 'address' };
  }
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    return { url: `https://tronscan.org/#/transaction/${s}`, kind: 'tx' };
  }
  return null;
}

function InlineCode({ children, ...props }: React.HTMLAttributes<HTMLElement>) {
  const text = typeof children === 'string' ? children : String(children ?? '');
  const link = getExplorerLink(text);
  if (link) {
    return (
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand hover:text-brand-strong underline decoration-brand/40 hover:decoration-brand/70 transition-colors"
      >
        {text}
      </a>
    );
  }
  return <code {...props}>{children}</code>;
}

function ThinkingDots() {
  return (
    <div className="flex gap-1.5 items-center py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-2 h-2 rounded-full bg-ink-faint inline-block"
          style={{
            animation: 'thinkingBounce 1.4s infinite ease-in-out both',
            animationDelay: i === 0 ? '-0.32s' : i === 1 ? '-0.16s' : '0s',
          }}
        />
      ))}
      <style>{`
        @keyframes thinkingBounce {
          0%, 80%, 100% { transform: scale(0.8); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function PdfIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0">
      <rect width="20" height="20" rx="4" fill="#ef4444" fillOpacity="0.15"/>
      <path d="M5 3h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="#ef4444" strokeWidth="1.2" fill="none"/>
      <path d="M12 3v4h4" stroke="#ef4444" strokeWidth="1.2" strokeLinejoin="round"/>
      <text x="4" y="15" fontSize="5" fill="#ef4444" fontWeight="700" fontFamily="monospace">PDF</text>
    </svg>
  );
}

function XlsxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0">
      <rect width="20" height="20" rx="4" fill="#22c55e" fillOpacity="0.15"/>
      <path d="M5 3h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="#22c55e" strokeWidth="1.2" fill="none"/>
      <path d="M12 3v4h4" stroke="#22c55e" strokeWidth="1.2" strokeLinejoin="round"/>
      <text x="3" y="15" fontSize="4.5" fill="#22c55e" fontWeight="700" fontFamily="monospace">XLSX</text>
    </svg>
  );
}

function CsvIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0">
      <rect width="20" height="20" rx="4" fill="#14b8a6" fillOpacity="0.15"/>
      <path d="M5 3h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="#14b8a6" strokeWidth="1.2" fill="none"/>
      <path d="M12 3v4h4" stroke="#14b8a6" strokeWidth="1.2" strokeLinejoin="round"/>
      <text x="4" y="15" fontSize="5" fill="#14b8a6" fontWeight="700" fontFamily="monospace">CSV</text>
    </svg>
  );
}

function DocxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0">
      <rect width="20" height="20" rx="4" fill="#3b82f6" fillOpacity="0.15"/>
      <path d="M5 3h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="#3b82f6" strokeWidth="1.2" fill="none"/>
      <path d="M12 3v4h4" stroke="#3b82f6" strokeWidth="1.2" strokeLinejoin="round"/>
      <text x="3" y="15" fontSize="4" fill="#3b82f6" fontWeight="700" fontFamily="monospace">DOCX</text>
    </svg>
  );
}

function TxtIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0">
      <rect width="20" height="20" rx="4" fill="#a1a1aa" fillOpacity="0.15"/>
      <path d="M5 3h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="#a1a1aa" strokeWidth="1.2" fill="none"/>
      <path d="M12 3v4h4" stroke="#a1a1aa" strokeWidth="1.2" strokeLinejoin="round"/>
      <text x="4" y="15" fontSize="5" fill="#a1a1aa" fontWeight="700" fontFamily="monospace">TXT</text>
    </svg>
  );
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function iconForMediaType(mt: string, name: string) {
  if (mt.startsWith('image/')) return null;
  if (mt === XLSX_MIME) return <XlsxIcon />;
  if (mt === DOCX_MIME) return <DocxIcon />;
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return <CsvIcon />;
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return <TxtIcon />;
  return <PdfIcon />;
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mediaType.startsWith('image/');
  return (
    <div className="relative group shrink-0">
      {isImage ? (
        <img
          src={attachment.previewUrl}
          alt={attachment.name}
          className="w-14 h-14 rounded-lg object-cover border border-line-strong"
        />
      ) : (
        <div className="w-14 h-14 rounded-lg border border-line-strong bg-surface-panel flex flex-col items-center justify-center gap-1 px-1">
          {iconForMediaType(attachment.mediaType, attachment.name)}
          <span className="text-[9px] text-ink-muted truncate w-full text-center leading-tight">
            {attachment.name}
          </span>
        </div>
      )}
      <button
        onClick={onRemove}
        aria-label="Remove attachment"
        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-surface-raised border border-line-strong text-ink-muted hover:bg-redline hover:text-white hover:border-redline flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all leading-none"
        title="Remove"
      >
        <FaXmark className="w-2.5 h-2.5" />
      </button>
    </div>
  );
}

function MessageAttachments({
  attachments,
}: {
  attachments: Pick<Attachment, 'name' | 'mediaType' | 'previewUrl'>[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-1.5">
      {attachments.map((att, i) =>
        att.mediaType.startsWith('image/') ? (
          <img
            key={i}
            src={att.previewUrl}
            alt={att.name}
            className="max-w-[180px] max-h-[160px] rounded-lg object-cover border border-line"
          />
        ) : (
          <div
            key={i}
            className="flex items-center gap-1.5 bg-surface border border-line rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-soft"
          >
            {iconForMediaType(att.mediaType, att.name)}
            <span className="truncate max-w-[120px]">{att.name}</span>
          </div>
        )
      )}
    </div>
  );
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix ("data:...;base64,")
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface AIChatProps {
  activeCaseId: string | null;
  activeInvestigationId: string | null;
  onGraphUpdated?: () => void;
  onProductionUpdated?: () => void;
}

export function AIChat({ activeCaseId, activeInvestigationId, onGraphUpdated, onProductionUpdated }: AIChatProps) {
  const { viewerRole, pendingChatPrompt, consumeChatPrompt } = useCaseContext();
  const canMutate = viewerRole === 'owner' || viewerRole === 'editor';

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>('claude-opus-5');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Local subscription to the active run. Aborting it stops following, not the run.
  const subAbortRef = useRef<AbortController | null>(null);
  const runRef = useRef<{ convId: string; runId: string } | null>(null);
  // Conversation a send is starting a run in, while POST /runs is in flight.
  // Cleared if the user switches away, so the reply isn't drawn into the wrong chat.
  const pendingSendConvRef = useRef<string | null>(null);
  // Conversation whose pending send was stopped before POST /runs returned a run id.
  const stopRequestedRef = useRef<string | null>(null);
  const dragCounterRef = useRef(0);
  const createInFlightRef = useRef(false);
  const skipNextLoadRef = useRef<string | null>(null);

  useEffect(() => {
    setConversations([]);
    setActiveConvId(null);
    setMessages([]);
    if (!activeCaseId) return;

    let cancelled = false;
    apiClient.listConversations(activeCaseId).then((convs) => {
      if (cancelled) return;
      setConversations(convs);
      if (convs.length > 0) setActiveConvId(convs[0].id);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [activeCaseId]);

  useEffect(() => {
    // Leaving a conversation stops following its run (the run itself continues),
    // and abandons a send that is still starting there.
    if (runRef.current && runRef.current.convId !== activeConvId) subAbortRef.current?.abort('switch');
    if (pendingSendConvRef.current && pendingSendConvRef.current !== activeConvId) {
      pendingSendConvRef.current = null;
      // Don't keep the new conversation's composer locked waiting on the old send.
      if (!subAbortRef.current) setStreaming(false);
    }

    // Skip the server load when we just created this conv locally. Without
    // this, the empty result would wipe the optimistic user+assistant rows
    // and the run being followed for them.
    if (activeConvId && skipNextLoadRef.current === activeConvId) {
      skipNextLoadRef.current = null;
      return;
    }
    if (!activeConvId) { setMessages([]); return; }

    let cancelled = false;
    const convId = activeConvId;
    // Run first: if it is terminal, messages read after it include all its rows.
    apiClient.getLatestRun(convId)
      .catch(() => ({ run: null as AgentRun | null }))
      .then(async ({ run }) => ({ run, msgs: await apiClient.getConversationMessages(convId) }))
      .then(({ msgs, run }) => {
      if (cancelled) return;
      const active = !!run && (run.status === 'queued' || run.status === 'running');
      if (active && run) {
        // Rows after the run's user message are its partial output; the event
        // replay rebuilds them, so cut them to avoid showing them twice.
        const cut = run.userMessageId ? msgs.findIndex((m) => m.id === run.userMessageId) : -1;
        void consumeRun(convId, run.id, toLocalMessages(cut >= 0 ? msgs.slice(0, cut + 1) : msgs));
        return;
      }
      const history = toLocalMessages(msgs);
      if (run && (run.status === 'failed' || run.status === 'interrupted')
          && run.userMessageId && msgs.some((m) => m.id === run.userMessageId)) {
        const text = run.error
          ? (run.status === 'failed' ? `${run.error.message} (ref: ${run.error.errorId})` : run.error.message)
          : RUN_INTERRUPTED_NOTICE;
        setMessages([...history, { id: `notice-${run.id}`, role: 'assistant', text }]);
        return;
      }
      setMessages(history);
    }).catch(() => {});

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId]);

  // Stop following (not the run) when the chat unmounts.
  useEffect(() => () => { pendingSendConvRef.current = null; subAbortRef.current?.abort('switch'); }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  // Chat prompt injection — e.g. the onboarding wizard queues a prompt via
  // requestChatPrompt(). Populate the composer without auto-sending so the
  // user can review and edit before sending. If the user already has a draft
  // in progress, append on a new line rather than clobbering it.
  useEffect(() => {
    if (pendingChatPrompt === null) return;
    setInput((prev) => (prev.trim().length > 0 ? `${prev}\n${pendingChatPrompt}` : pendingChatPrompt));
    consumeChatPrompt();
    textareaRef.current?.focus();
  }, [pendingChatPrompt, consumeChatPrompt]);

  // Revoke object URLs when attachments change to avoid memory leaks
  useEffect(() => {
    return () => {
      attachments.forEach((a) => {
        if (a.previewUrl.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl);
      });
    };
  }, [attachments]);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    setFileError(null);
    const arr = Array.from(files);
    const isAccepted = (f: File) => {
      const name = f.name.toLowerCase();
      // application/vnd.ms-excel is in ACCEPTED_TYPES as a CSV alias (Excel-on-Windows
      // mislabels CSVs with this mime). Reject it for non-CSV filenames so legacy .xls
      // doesn't sneak past the picker and get silently dropped server-side.
      if (f.type === 'application/vnd.ms-excel' && !name.endsWith('.csv')) return false;
      if (ACCEPTED_TYPES.includes(f.type)) return true;
      // text/plain is mime-ambiguous (covers .csv, .txt, .md, .log, .json, …). Gate on
      // extension so unsupported text-y files are rejected here rather than being
      // silently dropped server-side.
      const ambiguousText = ['text/plain', 'application/octet-stream', ''];
      if (
        ambiguousText.includes(f.type) &&
        (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.md'))
      ) return true;
      return false;
    };
    const valid = arr.filter(isAccepted);
    const invalid = arr.filter((f) => !isAccepted(f));

    if (invalid.length > 0) {
      setFileError(`Unsupported type: ${invalid.map(f => f.name).join(', ')}. Accepted: images, PDF, CSV, TXT, MD, XLSX, DOCX.`);
    }

    const okFiles = valid;
    const newAttachments: Attachment[] = await Promise.all(
      okFiles.map(async (file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        mediaType: file.type,
        data: await readFileAsBase64(file),
        previewUrl: file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : '',
      }))
    );
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) processFiles(e.target.files);
    e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(att.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const handleNewConversation = async () => {
    if (!activeCaseId || createInFlightRef.current) return;
    createInFlightRef.current = true;
    try {
      const conv = await apiClient.createConversation(activeCaseId);
      skipNextLoadRef.current = conv.id;
      setConversations((prev) => [conv, ...prev]);
      setActiveConvId(conv.id);
      setMessages([]);
      setShowHistory(false);
    } catch {
      // ignore
    } finally {
      createInFlightRef.current = false;
    }
  };

  const handleLoadConversation = (convId: string) => {
    setActiveConvId(convId);
    setShowHistory(false);
  };

  const handleDeleteConversation = async (convId: string) => {
    try {
      await apiClient.deleteConversation(convId);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConvId === convId) {
        setActiveConvId(null);
        setMessages([]);
      }
    } catch {
      // ignore
    }
  };

  // Follow a run's events into the transcript. `base` is everything before
  // this turn's assistant output (history plus the user's message).
  const consumeRun = async (convId: string, runId: string, base: LocalMessage[]) => {
    subAbortRef.current?.abort('switch');
    const sub = new AbortController();
    subAbortRef.current = sub;
    runRef.current = { convId, runId };
    setStreaming(true);

    const turn = new ChatTurn({ newId: () => crypto.randomUUID(), formatToolStatus }, { placeholder: true });
    setMessages([...base, ...turn.bubbles()]);

    let failure: string | null = null;
    try {
      const result = await subscribeRunEvents({
        conversationId: convId,
        runId,
        signal: sub.signal,
        onEvent: (type, data) => {
          const effect = turn.apply(type, data);
          if (effect === 'graph') onGraphUpdated?.();
          if (effect === 'production') onProductionUpdated?.();
          setMessages([...base, ...turn.bubbles()]);
        },
      });
      if (result === 'lost') failure = RUN_CONNECTION_LOST;
    } finally {
      if (subAbortRef.current === sub) {
        // 'switch' means another conversation took over the transcript; leave it alone.
        if (sub.signal.reason !== 'switch') setMessages([...base, ...turn.settle(failure)]);
        subAbortRef.current = null;
        runRef.current = null;
        setStreaming(false);
      }
    }
  };

  const handleSend = async () => {
    const hasText = input.trim().length > 0;
    const hasAttachments = attachments.length > 0;
    if ((!hasText && !hasAttachments) || streaming) return;

    // Auto-create conversation if none exists. Guarded against re-entry so
    // rapid sends or React double-invocation can't create multiple shells.
    let convId = activeConvId;
    if (!convId) {
      if (!activeCaseId || createInFlightRef.current) return;
      createInFlightRef.current = true;
      try {
        const conv = await apiClient.createConversation(activeCaseId);
        skipNextLoadRef.current = conv.id;
        setConversations((prev) => [conv, ...prev]);
        setActiveConvId(conv.id);
        convId = conv.id;
      } catch {
        createInFlightRef.current = false;
        return;
      }
      createInFlightRef.current = false;
    }

    const userText = input.trim();
    const sentAttachments = attachments.map(({ name, mediaType, previewUrl }) => ({
      name,
      mediaType,
      previewUrl,
    }));

    setInput('');
    setAttachments([]);
    setFileError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg: LocalMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: userText,
      attachments: sentAttachments.length > 0 ? sentAttachments : undefined,
    };
    const base = [...messages, userMsg];
    setStreaming(true);
    setMessages([...base, { id: crypto.randomUUID(), role: 'assistant', text: '', isStreaming: true }]);

    const body: StartRunBody = { model: selectedModel };
    if (userText) body.message = userText;
    if (activeCaseId) body.caseId = activeCaseId;
    if (activeInvestigationId) body.investigationId = activeInvestigationId;
    if (attachments.length > 0) {
      body.attachments = attachments.map(({ name, mediaType, data }) => ({ name, mediaType, data }));
    }

    if (stopRequestedRef.current === convId) stopRequestedRef.current = null;
    pendingSendConvRef.current = convId;
    let runId: string;
    try {
      ({ runId } = await apiClient.startRun(convId, body));
    } catch (err) {
      if (pendingSendConvRef.current === convId) {
        pendingSendConvRef.current = null;
        // Nothing was sent: drop the optimistic bubble, give the draft back, show why.
        const text = err instanceof ApiError ? err.message : 'The request failed. Please try again.';
        setMessages([...messages, { id: crypto.randomUUID(), role: 'assistant', text }]);
        setInput(userText);
        // Clearing attachments at send revoked their blob: previews (see the
        // revoke effect), so restore them with data: URLs built from the base64.
        setAttachments(attachments.map((a) => ({
          ...a,
          previewUrl: a.previewUrl.startsWith('blob:') ? `data:${a.mediaType};base64,${a.data}` : a.previewUrl,
        })));
      }
      if (stopRequestedRef.current === convId) stopRequestedRef.current = null;
      // Another conversation may be following or starting its own run; leave its state alone.
      if (!subAbortRef.current && !pendingSendConvRef.current) setStreaming(false);
      return;
    }

    if (stopRequestedRef.current === convId) {
      stopRequestedRef.current = null;
      void apiClient.cancelRun(convId, runId).catch(() => {});
    }
    if (pendingSendConvRef.current !== convId) {
      // The user switched conversations mid-start. The run continues on the
      // server, and reopening that conversation reattaches to it.
      if (!subAbortRef.current && !pendingSendConvRef.current) setStreaming(false);
      return;
    }
    pendingSendConvRef.current = null;
    await consumeRun(convId, runId, base);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !streaming;

  const handleStop = async () => {
    const run = runRef.current;
    if (!run) {
      // POST /runs hasn't returned yet; handleSend cancels as soon as it has the id.
      stopRequestedRef.current = pendingSendConvRef.current;
      return;
    }
    try {
      // The run persists what it has and sends `done`; the subscription then settles the turn.
      await apiClient.cancelRun(run.convId, run.runId);
    } catch {
      // Server unreachable: stop following locally. The run may still finish.
      subAbortRef.current?.abort('stop');
    }
  };

  return (
    <div
      className="w-full h-full bg-surface border-l border-line flex flex-col relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 pointer-events-none border-2 border-brand rounded-none bg-brand/10 flex items-center justify-center">
          <div className="bg-surface border border-brand rounded-xl px-6 py-4 text-brand font-semibold text-sm shadow-[0_24px_60px_-30px_rgba(11,18,32,0.18)]">
            Drop images or PDFs here
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 h-12 border-b border-line shrink-0">
        {showHistory ? (
          <>
            <button
              onClick={() => setShowHistory(false)}
              className="h-8 w-8 inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-raised rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              aria-label="Back to chat"
            >
              <FaArrowLeft className="w-3.5 h-3.5" />
            </button>
            <Kicker index={3}>Conversations</Kicker>
            <button
              onClick={handleNewConversation}
              disabled={!activeCaseId}
              title={activeCaseId ? 'New conversation' : 'Select a case to start a conversation'}
              className="h-8 w-8 inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-raised rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink-muted"
              aria-label="New conversation"
            >
              <FaPlus className="w-3 h-3" />
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Kicker index={3}>Agent</Kicker>
              <span className="text-sm font-semibold tracking-tight text-ink truncate block">
                {conversations.find((c) => c.id === activeConvId)?.title || 'Daubert'}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as ModelId)}
                disabled={streaming}
                className="text-xs font-semibold bg-surface border border-line text-ink-muted hover:text-ink rounded-lg px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 hover:border-line-strong transition-colors disabled:opacity-50 cursor-pointer"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <button
                onClick={() => setShowHistory(true)}
                aria-label="Conversation history"
                className="h-8 w-8 inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-raised rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                title="Conversation history"
              >
                <FaClockRotateLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleNewConversation}
                disabled={!activeCaseId}
                title={activeCaseId ? 'New conversation' : 'Select a case to start a conversation'}
                aria-label="New conversation"
                className="h-8 w-8 inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-raised rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink-muted"
              >
                <FaPlus className="w-3 h-3" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* History view */}
      {showHistory && (
        <div className="flex-1 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {conversations.length === 0 ? (
            <p className="text-ink-faint text-xs text-center py-6 font-medium">No conversations yet</p>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-1 px-3 py-2.5 rounded-lg mx-1 transition-colors ${
                  activeConvId === conv.id
                    ? 'bg-surface border border-line-strong'
                    : 'hover:bg-surface-raised'
                }`}
              >
                <button
                  onClick={() => handleLoadConversation(conv.id)}
                  className="flex-1 text-left flex flex-col gap-0.5 min-w-0"
                >
                  <span className={`text-sm font-semibold truncate ${activeConvId === conv.id ? 'text-ink' : 'text-ink-soft'}`}>
                    {conv.title || 'New conversation'}
                  </span>
                  <span className="text-xs text-ink-faint font-medium">
                    {formatRelativeDate(conv.updatedAt)}
                  </span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                  aria-label="Delete conversation"
                  className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center text-ink-faint hover:text-redline rounded transition-all shrink-0"
                  title="Delete conversation"
                >
                  <FaTrash className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Messages */}
      {!showHistory && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 bg-surface/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {messages.length === 0 && (
              <p className="text-ink-faint text-sm text-center mt-8 leading-relaxed font-medium">
                Ask me about addresses, transactions,<br />or patterns in this case.
              </p>
            )}
            {messages.map((m) => {
              if (m.role === 'status') {
                return (
                  <div key={m.id} className="flex justify-start">
                    <StatusMessage text={m.text} />
                  </div>
                );
              }
              const isUser = m.role === 'user';
              return (
                <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] px-3 py-2 text-sm leading-relaxed font-medium break-words overflow-hidden text-ink-soft ${
                      isUser
                        ? 'bg-surface-raised rounded-xl'
                        : 'bg-surface border border-line rounded-xl'
                    }`}
                  >
                    {m.attachments && m.attachments.length > 0 && (
                      <MessageAttachments attachments={m.attachments} />
                    )}
                    {m.text ? (
                      isUser ? (
                        <span className="whitespace-pre-wrap">{m.text}</span>
                      ) : (
                        <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-table:my-2 prose-pre:my-2 prose-pre:bg-surface-raised prose-pre:text-ink-soft prose-pre:rounded-lg prose-code:bg-surface-raised prose-code:text-ink-soft prose-code:rounded prose-code:px-1 prose-code:before:content-none prose-code:after:content-none prose-a:text-brand prose-headings:text-ink prose-strong:text-ink prose-p:text-ink-soft prose-li:text-ink-soft prose-td:p-1.5 prose-th:p-1.5 prose-th:text-ink prose-td:text-ink-soft">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: InlineCode }}>{m.text}</ReactMarkdown>
                        </div>
                      )
                    ) : m.isStreaming ? (
                      <ThinkingDots />
                    ) : null}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <div className="px-4 pt-2 pb-3 border-t border-line shrink-0">
            {/* Attachment previews */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {attachments.map((att) => (
                  <AttachmentChip
                    key={att.id}
                    attachment={att}
                    onRemove={() => removeAttachment(att.id)}
                  />
                ))}
              </div>
            )}

            {/* Error */}
            {fileError && (
              <p className="text-xs text-redline mb-1.5 font-medium">{fileError}</p>
            )}

            {/* Read-only mode note for viewers */}
            {!canMutate && (
              <p className="text-[11px] text-ink-faint mb-1.5">
                Read-only mode. Daubert can answer but not modify the case.
              </p>
            )}

            {/* Composer */}
            <div className="flex items-end gap-1.5 border border-line-strong rounded-xl bg-surface px-1.5 py-1.5 focus-within:ring-2 focus-within:ring-brand/40 transition-shadow">
              {/* Attach button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={streaming}
                aria-label="Attach image or PDF"
                className="w-8 h-8 flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-raised disabled:opacity-40 rounded-lg transition-colors shrink-0"
                title="Attach image or PDF"
              >
                <FaPaperclip className="w-3.5 h-3.5" />
              </button>

              <div className="relative flex-1">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me anything…"
                  rows={1}
                  disabled={streaming}
                  className="w-full bg-transparent outline-none px-1.5 py-1.5 pr-7 text-sm text-ink placeholder:text-ink-faint resize-none disabled:opacity-50 font-medium leading-relaxed"
                  style={{ maxHeight: expanded ? '320px' : '140px', minHeight: '32px', overflowY: 'auto' }}
                />
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  aria-label={expanded ? 'Collapse composer' : 'Expand composer'}
                  className="absolute bottom-1.5 right-1 w-5 h-5 flex items-center justify-center text-ink-faint hover:text-ink-muted transition-colors"
                  title={expanded ? 'Collapse' : 'Expand'}
                >
                  {expanded ? <FaChevronUp className="w-2.5 h-2.5" /> : <FaChevronDown className="w-2.5 h-2.5" />}
                </button>
              </div>
              {streaming ? (
                <button
                  onClick={handleStop}
                  aria-label="Stop generating"
                  className="w-8 h-8 flex items-center justify-center bg-redline hover:bg-redline/90 rounded-lg text-white transition-all shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  title="Stop"
                >
                  <FaXmark className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  aria-label="Send message"
                  className="w-8 h-8 flex items-center justify-center text-brand hover:bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent rounded-lg transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  title="Send"
                >
                  <FaArrowUp className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
