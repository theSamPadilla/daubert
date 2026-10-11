'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FaXmark, FaChevronDown, FaChevronUp, FaArrowRight } from 'react-icons/fa6';
import { apiClient, ApiError, type Conversation } from '@/lib/api-client';
import type { BannerState } from './contextThresholds';

function continueErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) {
    return 'Wait for the current response to finish, then try again.';
  }
  return 'Could not continue this conversation. Please try again.';
}

interface ContinueButtonProps {
  conversationId: string;
  /** True while a run is streaming; continuing is blocked until it ends. */
  disabled: boolean;
  onContinued: (conv: Conversation) => void | Promise<void>;
  /** Conversation being summarized right now, shared by every ContinueButton so only one runs at a time. */
  continuingConvId: string | null;
  onContinueStart: (conversationId: string) => void;
  onContinueFinish: () => void;
}

/** Creates a new conversation seeded with a summary of this one. Summarizing can take minutes. */
export function ContinueButton({
  conversationId,
  disabled,
  onContinued,
  continuingConvId,
  onContinueStart,
  onContinueFinish,
}: ContinueButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const anyBusy = continuingConvId !== null;
  const busy = continuingConvId === conversationId;

  const run = async () => {
    if (anyBusy || disabled) return;
    onContinueStart(conversationId);
    setError(null);
    try {
      const conv = await apiClient.continueConversation(conversationId);
      await onContinued(conv);
    } catch (err) {
      setError(continueErrorMessage(err));
    } finally {
      onContinueFinish();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div>
        <button
          type="button"
          onClick={run}
          disabled={anyBusy || disabled}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-surface border border-line-strong text-xs font-semibold text-ink hover:bg-surface-raised transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {busy ? 'Summarizing this conversation...' : (
            <>
              Continue in a new conversation
              <FaArrowRight className="w-2.5 h-2.5" />
            </>
          )}
        </button>
      </div>
      {error && <p className="text-xs text-redline font-medium">{error}</p>}
    </div>
  );
}

interface ContextBannerProps extends Omit<ContinueButtonProps, 'conversationId'> {
  state: BannerState;
  conversationId: string;
  /** Warn banner only; the strong banner cannot be dismissed. */
  onDismissWarn: () => void;
}

export function ContextBanner({
  state,
  conversationId,
  disabled,
  onContinued,
  continuingConvId,
  onContinueStart,
  onContinueFinish,
  onDismissWarn,
}: ContextBannerProps) {
  if (state === 'none') return null;
  const strong = state === 'strong';
  return (
    <div
      role={strong ? 'alert' : 'status'}
      className={`mb-2 rounded-xl border px-3 py-2 flex flex-col gap-2 ${
        strong ? 'border-redline/40 bg-redline/10' : 'border-line-strong bg-surface-raised'
      }`}
    >
      <div className="flex items-start gap-2">
        <p className={`flex-1 text-xs leading-relaxed font-medium ${strong ? 'text-redline' : 'text-ink-soft'}`}>
          {strong
            ? 'This conversation is very long and may start failing. Continue in a new conversation to keep your context.'
            : "This conversation is getting long. Answers get slower and less reliable as it grows. Continue in a new conversation; we'll carry over a summary so you don't lose your context."}
        </p>
        {!strong && (
          <button
            type="button"
            onClick={onDismissWarn}
            aria-label="Dismiss"
            className="w-5 h-5 flex items-center justify-center text-ink-faint hover:text-ink-muted shrink-0"
          >
            <FaXmark className="w-3 h-3" />
          </button>
        )}
      </div>
      <ContinueButton
        conversationId={conversationId}
        disabled={disabled}
        onContinued={onContinued}
        continuingConvId={continuingConvId}
        onContinueStart={onContinueStart}
        onContinueFinish={onContinueFinish}
      />
    </div>
  );
}

interface SeedSummaryCardProps {
  summary: string;
  fromTitle: string | null;
  fromConversationId: string | null;
  onOpenPrevious: (id: string) => void;
}

/** Top of a continued conversation: the carried-over summary, collapsed by default. */
export function SeedSummaryCard({ summary, fromTitle, fromConversationId, onOpenPrevious }: SeedSummaryCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-ink-soft text-left"
      >
        <span className="truncate">Continued from {fromTitle || 'a previous conversation'}</span>
        {open ? <FaChevronUp className="w-2.5 h-2.5 shrink-0" /> : <FaChevronDown className="w-2.5 h-2.5 shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <div className="prose prose-sm max-w-none text-sm leading-relaxed font-medium prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-a:text-brand prose-headings:text-ink prose-strong:text-ink prose-p:text-ink-soft prose-li:text-ink-soft">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
          </div>
          {fromConversationId && (
            <div>
              <button
                type="button"
                onClick={() => onOpenPrevious(fromConversationId)}
                className="text-xs font-semibold text-brand hover:underline"
              >
                Open the previous conversation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
