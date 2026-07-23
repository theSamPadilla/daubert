'use client';

import { useState } from 'react';
import { FaCheck, FaRegCircle, FaXmark } from 'react-icons/fa6';
import { Kicker, Button } from '@/components/ui';
import { useCaseContext } from '@/contexts/CaseContext';
import { writeOnboardingRecord, type ChecklistState } from '@/components/Onboarding/checklist';

const DRAFT_PROMPT =
  'Draft the body of this case\'s declaration from the actual work done in the case. ' +
  'Load the declarations skill first. Base the methodology section on what was actually done ' +
  '(fetches, imports, labels, script runs), anchor factual claims to transaction hashes where available, ' +
  'and disclose gaps honestly (unattributable flows, incomplete history). ' +
  'Do not invent qualifications or facts. This is a draft for the expert to review and own.';

interface GettingStartedRailProps {
  caseId: string;
  checklist: ChecklistState;
  onDraftRequested: () => void;
  onDismiss: () => void;
}

function ChecklistRow({
  done,
  label,
  subtext,
  action,
}: {
  done: boolean;
  label: string;
  subtext?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      {done ? (
        <FaCheck className="mt-0.5 h-3 w-3 shrink-0 text-brand" />
      ) : (
        <FaRegCircle className="mt-0.5 h-3 w-3 shrink-0 text-ink-faint" />
      )}
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] ${done ? 'text-ink-soft line-through decoration-ink-faint/50' : 'text-ink'}`}>
          {label}
        </div>
        {!done && subtext && <p className="mt-0.5 text-[12px] text-ink-muted">{subtext}</p>}
        {!done && action && <div className="mt-1.5">{action}</div>}
      </div>
    </div>
  );
}

export function GettingStartedRail({ caseId, checklist, onDraftRequested, onDismiss }: GettingStartedRailProps) {
  const { requestChatPrompt } = useCaseContext();
  const [requesting, setRequesting] = useState(false);

  const handleDismiss = () => {
    writeOnboardingRecord(caseId, { railDismissed: true });
    onDismiss();
  };

  const handleDraft = () => {
    setRequesting(true);
    writeOnboardingRecord(caseId, { draftRequested: true });
    onDraftRequested();
    requestChatPrompt(DRAFT_PROMPT);
  };

  return (
    <div className="absolute bottom-4 right-4 z-20 w-72 rounded-lg border border-line-strong bg-surface-panel shadow-2xl">
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <Kicker>Getting started</Kicker>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss getting started"
          className="text-ink-faint hover:text-ink transition-colors"
        >
          <FaXmark size={12} />
        </button>
      </div>
      <div className="space-y-3 px-4 pb-4 pt-3">
        <ChecklistRow done={checklist.seeded} label="Seed your trace" />
        <ChecklistRow
          done={checklist.labeled}
          label="Label key wallets"
          subtext="Rename wallets you can identify. Labels carry into the declaration."
        />
        <ChecklistRow
          done={checklist.expanded}
          label="Expand the flows"
          subtext="Fetch activity for counterparties that matter."
        />
        <ChecklistRow
          done={checklist.draftRequested}
          label="Draft your declaration"
          action={
            <Button size="sm" onClick={handleDraft} disabled={requesting || checklist.draftRequested}>
              Draft with AI
            </Button>
          }
        />
      </div>
    </div>
  );
}
