'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiClient, type Conversation, type ChatMessage } from '@/lib/api-client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';

interface ToolStatus {
  name: string;
  input?: Record<string, unknown>;
}

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
  activeTool?: ToolStatus;
  completedTools?: string[];
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

function ToolIndicator({ tool }: { tool: ToolStatus }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-1.5">
      <span
        className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block shrink-0"
        style={{ animation: 'toolPulse 1.5s ease-in-out infinite' }}
      />
      <span>{formatToolStatus(tool)}</span>
      <style>{`
        @keyframes toolPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function CompletedTools({ tools }: { tools: string[] }) {
  if (tools.length === 0) return null;
  const uniqueTools = [...new Set(tools)];
  const labels: Record<string, string> = {
    web_search: 'searched web',
    get_case_data: 'read case data',
    get_skill: 'loaded skill',
    execute_script: 'ran script',
    list_script_runs: 'checked scripts',
  };
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {uniqueTools.map((name, i) => (
        <span
          key={i}
          className="text-[10px] text-gray-600"
        >
          {labels[name] || name.replace(/_/g, ' ')}{i < uniqueTools.length - 1 ? ' · ' : ''}
        </span>
      ))}
    </div>
  );
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const handleSend = async () => {
    if (!input.trim() || streaming) return;
    // Auto-create conversation if none exists
    if (!activeConvId) {
      try {
        const conv = await apiClient.createConversation();
        setConversations((prev) => [conv, ...prev]);
        setActiveConvId(conv.id);
      } catch { return; }
    }

    const userText = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setStreaming(true);

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text: userText },
      { id: assistantId, role: 'assistant', text: '', isStreaming: true },
    ]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const body: Record<string, string> = { message: userText };
      if (activeCaseId) body.caseId = activeCaseId;
      if (activeInvestigationId) body.investigationId = activeInvestigationId;

      const res = await fetch(`${API_BASE}/conversations/${activeConvId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let eventType = '';

      const updateAssistant = (updater: (m: LocalMessage) => LocalMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? updater(m) : m)));

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
              updateAssistant((m) => ({ ...m, text: m.text + (data.content ?? '') }));
            } else if (eventType === 'tool_start') {
              updateAssistant((m) => ({
                ...m,
                activeTool: { name: data.name, input: data.input },
              }));
            } else if (eventType === 'tool_done') {
              updateAssistant((m) => ({
                ...m,
                activeTool: undefined,
                completedTools: [...(m.completedTools || []), data.name],
              }));
            } else if (eventType === 'graph_updated') {
              onGraphUpdated?.();
            } else if (eventType === 'done') {
              updateAssistant((m) => ({ ...m, isStreaming: false, activeTool: undefined }));
            } else if (eventType === 'error') {
              updateAssistant((m) => ({
                ...m,
                text: m.text || `Error: ${data.message}`,
                isStreaming: false,
                activeTool: undefined,
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

  return (
    <div className="w-[480px] min-w-[480px] bg-gray-800 border-l border-gray-700 flex flex-col">
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
                {conversations.find((c) => c.id === activeConvId)?.title || 'Forensics AI'}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
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
              <button
                key={conv.id}
                onClick={() => handleLoadConversation(conv.id)}
                className={`w-full text-left flex flex-col gap-0.5 px-3 py-2.5 rounded-lg mx-1 transition-colors ${
                  activeConvId === conv.id ? 'bg-gray-700' : 'hover:bg-gray-700/60'
                }`}
              >
                <span className="text-sm font-semibold text-white truncate">
                  {conv.title || 'New conversation'}
                </span>
                <span className="text-xs text-gray-500 font-medium">
                  {formatRelativeDate(conv.updatedAt)}
                </span>
              </button>
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
                    {m.text ? (
                      isUser ? (
                        <span className="whitespace-pre-wrap">{m.text}</span>
                      ) : (
                        <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-table:my-2 prose-pre:my-2 prose-pre:bg-gray-800 prose-pre:text-gray-200 prose-code:text-blue-300 prose-code:before:content-none prose-code:after:content-none prose-a:text-blue-400 prose-strong:text-white prose-td:p-1.5 prose-th:p-1.5">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                        </div>
                      )
                    ) : m.isStreaming && m.activeTool ? null : m.isStreaming ? (
                      <ThinkingDots />
                    ) : null}
                    {m.activeTool && <ToolIndicator tool={m.activeTool} />}
                    {!m.isStreaming && m.completedTools && m.completedTools.length > 0 && (
                      <CompletedTools tools={m.completedTools} />
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="flex items-end gap-2.5 px-4 py-3 border-t border-gray-700 shrink-0">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything…"
              rows={1}
              disabled={streaming}
              className="flex-1 bg-gray-900 border-2 border-gray-700 focus:border-blue-500 focus:outline-none rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 resize-none disabled:opacity-50 transition-colors font-medium leading-relaxed"
              style={{ maxHeight: '140px', minHeight: '44px', overflowY: 'hidden' }}
            />
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
                disabled={!input.trim()}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-px disabled:transform-none shrink-0"
              >
                Send
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
