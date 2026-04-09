'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiClient, type Conversation, type ChatMessage } from '@/lib/api-client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

const MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
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
    <div className="flex items-center gap-2 text-[11px] text-gray-500 py-1 px-1">
      <span
        className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block shrink-0"
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
        className="text-blue-400 hover:text-blue-300 underline decoration-blue-400/30 hover:decoration-blue-300/60 transition-colors"
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
          className="w-2 h-2 rounded-full bg-gray-500 inline-block"
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
          className="w-14 h-14 rounded-lg object-cover border border-gray-600"
        />
      ) : (
        <div className="w-14 h-14 rounded-lg border border-gray-600 bg-gray-800 flex flex-col items-center justify-center gap-1 px-1">
          <PdfIcon />
          <span className="text-[9px] text-gray-400 truncate w-full text-center leading-tight">
            {attachment.name}
          </span>
        </div>
      )}
      <button
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-600 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all text-[10px] leading-none"
        title="Remove"
      >
        ×
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
            className="max-w-[180px] max-h-[160px] rounded-lg object-cover border border-white/10"
          />
        ) : (
          <div
            key={i}
            className="flex items-center gap-1.5 bg-white/10 rounded-lg px-2.5 py-1.5 text-xs font-medium"
          >
            <PdfIcon />
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
}

export function AIChat({ activeCaseId, activeInvestigationId, onGraphUpdated }: AIChatProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>('claude-opus-4-6');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragCounterRef = useRef(0);

  const loadConversations = useCallback(async () => {
    try {
      const convs = await apiClient.listConversations();
      setConversations(convs);
      return convs;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    loadConversations().then((convs) => {
      if (convs.length > 0 && !activeConvId) setActiveConvId(convs[0].id);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    apiClient.getConversationMessages(activeConvId).then((msgs) => {
      setMessages(
        msgs
          .filter((m) => extractText(m.content).length > 0)
          .map((m) => ({ id: m.id, role: m.role, text: extractText(m.content) }))
      );
    }).catch(() => {});
  }, [activeConvId]);

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
    const valid = arr.filter((f) => ACCEPTED_TYPES.includes(f.type));
    const invalid = arr.filter((f) => !ACCEPTED_TYPES.includes(f.type));

    if (invalid.length > 0) {
      setFileError(`Unsupported type: ${invalid.map((f) => f.name).join(', ')}. Use images or PDF.`);
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
    try {
      const conv = await apiClient.createConversation();
      setConversations((prev) => [conv, ...prev]);
      setActiveConvId(conv.id);
      setMessages([]);
      setShowHistory(false);
    } catch {
      // ignore
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

  const handleSend = async () => {
    const hasText = input.trim().length > 0;
    const hasAttachments = attachments.length > 0;
    if ((!hasText && !hasAttachments) || streaming) return;

    // Auto-create conversation if none exists
    let convId = activeConvId;
    if (!convId) {
      try {
        const conv = await apiClient.createConversation();
        setConversations((prev) => [conv, ...prev]);
        setActiveConvId(conv.id);
        convId = conv.id;
      } catch { return; }
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
    setStreaming(true);

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev,
      {
        id: userId,
        role: 'user',
        text: userText,
        attachments: sentAttachments.length > 0 ? sentAttachments : undefined,
      },
      { id: assistantId, role: 'assistant', text: '', isStreaming: true },
    ]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const body: Record<string, unknown> = { model: selectedModel };
      if (userText) body.message = userText;
      if (activeCaseId) body.caseId = activeCaseId;
      if (activeInvestigationId) body.investigationId = activeInvestigationId;
      if (attachments.length > 0) {
        body.attachments = attachments.map(({ name, mediaType, data }) => ({ name, mediaType, data }));
      }

      const res = await fetch(`${API_BASE}/conversations/${convId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let eventType = '';

      let curMsgId = assistantId;
      let statusId: string | null = null;

      const updateMsg = (id: string, updater: (m: LocalMessage) => LocalMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));

      const removeStatus = () => {
        if (statusId) {
          const rid = statusId;
          statusId = null;
          setMessages((prev) => prev.filter((m) => m.id !== rid));
        }
      };

      const showStatus = (text: string) => {
        removeStatus();
        const id = crypto.randomUUID();
        statusId = id;
        setMessages((prev) => [...prev, { id, role: 'status', text, isStreaming: true }]);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (eventType === 'text_delta') {
              const content = data.content ?? '';
              removeStatus();
              if (curMsgId !== assistantId) {
                setMessages((prev) => {
                  const cur = prev.find((m) => m.id === curMsgId);
                  if (cur && !cur.isStreaming) {
                    const newId = crypto.randomUUID();
                    curMsgId = newId;
                    return [...prev, { id: newId, role: 'assistant', text: content, isStreaming: true }];
                  }
                  return prev.map((m) => m.id === curMsgId ? { ...m, text: m.text + content } : m);
                });
              } else {
                updateMsg(curMsgId, (m) => ({ ...m, text: m.text + content }));
              }
            } else if (eventType === 'tool_start') {
              updateMsg(curMsgId, (m) => m.text ? { ...m, isStreaming: false } : m);
              const tool: ToolStatus = { name: data.name, input: data.input };
              showStatus(formatToolStatus(tool));
            } else if (eventType === 'tool_done') {
              removeStatus();
              const newId = crypto.randomUUID();
              curMsgId = newId;
              setMessages((prev) => [
                ...prev,
                { id: newId, role: 'assistant', text: '', isStreaming: true },
              ]);
            } else if (eventType === 'graph_updated') {
              onGraphUpdated?.();
            } else if (eventType === 'done') {
              removeStatus();
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.id === curMsgId && !last.text) {
                  return prev.filter((m) => m.id !== curMsgId);
                }
                return prev.map((m) => m.id === curMsgId ? { ...m, isStreaming: false } : m);
              });
            } else if (eventType === 'error') {
              removeStatus();
              updateMsg(curMsgId, (m) => ({
                ...m,
                text: m.text || `Error: ${data.message}`,
                isStreaming: false,
              }));
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: 'Connection error.', isStreaming: false } : m
          )
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      loadConversations();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !streaming;

  return (
    <div
      className="w-[480px] min-w-[480px] bg-gray-800 border-l border-gray-700 flex flex-col relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 pointer-events-none border-2 border-blue-500 rounded-none bg-blue-500/10 flex items-center justify-center">
          <div className="bg-gray-800 border border-blue-500 rounded-xl px-6 py-4 text-blue-400 font-semibold text-sm shadow-xl">
            Drop images or PDFs here
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
        {showHistory ? (
          <>
            <button
              onClick={() => setShowHistory(false)}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="Back to chat"
            >
              ←
            </button>
            <span className="text-sm font-bold text-white">Conversations</span>
            <button
              onClick={handleNewConversation}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="New conversation"
            >
              +
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-bold text-white truncate">
                {conversations.find((c) => c.id === activeConvId)?.title || 'Daubert'}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as ModelId)}
                disabled={streaming}
                className="text-xs font-semibold bg-gray-700 border border-gray-600 text-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:border-blue-500 hover:border-gray-500 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <button
                onClick={() => setShowHistory(true)}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                title="Conversation history"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M8 5v3.5L10.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
              <button
                onClick={handleNewConversation}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors text-lg leading-none"
                title="New conversation"
              >
                +
              </button>
            </div>
          </>
        )}
      </div>

      {/* History view */}
      {showHistory && (
        <div className="flex-1 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {conversations.length === 0 ? (
            <p className="text-gray-500 text-xs text-center py-6 font-medium">No conversations yet</p>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-1 px-3 py-2.5 rounded-lg mx-1 transition-colors ${
                  activeConvId === conv.id ? 'bg-gray-700' : 'hover:bg-gray-700/60'
                }`}
              >
                <button
                  onClick={() => handleLoadConversation(conv.id)}
                  className="flex-1 text-left flex flex-col gap-0.5 min-w-0"
                >
                  <span className="text-sm font-semibold text-white truncate">
                    {conv.title || 'New conversation'}
                  </span>
                  <span className="text-xs text-gray-500 font-medium">
                    {formatRelativeDate(conv.updatedAt)}
                  </span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                  className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center text-gray-500 hover:text-red-400 rounded transition-all shrink-0"
                  title="Delete conversation"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M5 2V1h6v1h4v1.5H1V2h4zM3 5h10l-.8 9.4a1 1 0 01-1 .9H4.8a1 1 0 01-1-.9L3 5z" fill="currentColor"/>
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Messages */}
      {!showHistory && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 bg-gray-850 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ backgroundColor: 'rgb(17 24 39 / 0.5)' }}>
            {messages.length === 0 && (
              <p className="text-gray-500 text-sm text-center mt-8 leading-relaxed font-medium">
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
                    className={`max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed font-medium break-words overflow-hidden ${
                      isUser
                        ? 'bg-blue-600 text-white rounded-2xl rounded-br-md'
                        : 'bg-gray-700 text-gray-100 rounded-2xl rounded-bl-md border border-gray-600'
                    }`}
                  >
                    {m.attachments && m.attachments.length > 0 && (
                      <MessageAttachments attachments={m.attachments} />
                    )}
                    {m.text ? (
                      isUser ? (
                        <span className="whitespace-pre-wrap">{m.text}</span>
                      ) : (
                        <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-table:my-2 prose-pre:my-2 prose-pre:bg-gray-800 prose-pre:text-gray-200 prose-code:text-gray-300 prose-code:before:content-none prose-code:after:content-none prose-a:text-blue-400 prose-strong:text-white prose-td:p-1.5 prose-th:p-1.5">
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
          <div className="px-4 pt-2 pb-3 border-t border-gray-700 shrink-0">
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
              <p className="text-xs text-red-400 mb-1.5 font-medium">{fileError}</p>
            )}

            {/* Input row */}
            <div className="flex items-end gap-2">
              {/* Attach button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={streaming}
                className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-40 rounded-xl transition-colors shrink-0 border border-gray-700"
                title="Attach image or PDF"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M13.5 7.5L7.5 13.5C6.12 14.88 3.88 14.88 2.5 13.5C1.12 12.12 1.12 9.88 2.5 8.5L8.5 2.5C9.33 1.67 10.67 1.67 11.5 2.5C12.33 3.33 12.33 4.67 11.5 5.5L5.5 11.5C5.08 11.92 4.42 11.92 4 11.5C3.58 11.08 3.58 10.42 4 10L9.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
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
                  className="w-full bg-gray-900 border-2 border-gray-700 focus:border-blue-500 focus:outline-none rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 resize-none disabled:opacity-50 transition-colors font-medium leading-relaxed"
                  style={{ maxHeight: expanded ? '320px' : '140px', minHeight: '44px', overflowY: 'auto' }}
                />
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="absolute bottom-2 right-2 w-5 h-5 flex items-center justify-center text-gray-600 hover:text-gray-300 transition-colors"
                  title={expanded ? 'Collapse' : 'Expand'}
                >
                  {expanded ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              </div>
              {streaming ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="px-4 py-2.5 bg-red-600 hover:bg-red-500 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-px shrink-0"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-px disabled:transform-none shrink-0"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
