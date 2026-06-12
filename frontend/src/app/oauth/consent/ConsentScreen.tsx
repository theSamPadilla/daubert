'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { FaFolderOpen, FaLink, FaPenToSquare, FaShield, FaTriangleExclamation } from 'react-icons/fa6';
import { apiClient, ApiError } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';

type Preview = components['schemas']['OAuthConsentPreview'];
type EligibleOrg = components['schemas']['EligibleOrgSummary'];

interface ConsentScreenProps {
  bag: string;
  preview: Preview;
}

/**
 * Top-level navigation seam — kept module-local so tests can spy on it via
 * `jest.spyOn`. We can't safely override `window.location` in jsdom (it's
 * non-configurable), so the component goes through this helper instead.
 */
export const _consentNav = {
  redirect(url: string) {
    window.location.href = url;
  },
};

const CAPABILITIES: Array<{ icon: React.ComponentType<{ size?: number; className?: string }>; label: string }> = [
  { icon: FaFolderOpen, label: 'Read your cases' },
  { icon: FaLink, label: 'Pull blockchain data' },
  { icon: FaPenToSquare, label: 'Write investigations and productions' },
];

/**
 * Format the option label for an eligible org: "Acme (member)".
 */
function orgOptionLabel(org: EligibleOrg): string {
  return `${org.name} (${org.role})`;
}

export function ConsentScreen({ bag, preview }: ConsentScreenProps) {
  // Preselect the only eligible org if exactly one is returned.
  const initialOrgId = useMemo(() => {
    return preview.eligibleOrgs.length === 1 ? preview.eligibleOrgs[0].id : '';
  }, [preview.eligibleOrgs]);

  const [selectedOrgId, setSelectedOrgId] = useState<string>(initialOrgId);
  const [submitting, setSubmitting] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const noEligibleOrgs = preview.eligibleOrgs.length === 0;
  const canAllow = !noEligibleOrgs && selectedOrgId !== '' && submitting === null;

  async function handleAllow() {
    if (!canAllow) return;
    setSubmitting('allow');
    setError(null);
    try {
      const result = await apiClient.completeConsent(bag, selectedOrgId);
      _consentNav.redirect(result.redirectUrl);
    } catch (err: unknown) {
      setSubmitting(null);
      if (err instanceof ApiError && err.status === 403) {
        setError(
          'You are no longer eligible to consent on behalf of the selected organization. Reload this page or pick a different organization.',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    }
  }

  async function handleDeny() {
    if (submitting !== null) return;
    setSubmitting('deny');
    setError(null);
    try {
      const result = await apiClient.denyConsent(bag);
      _consentNav.redirect(result.redirectUrl);
    } catch (err: unknown) {
      setSubmitting(null);
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <div className="relative min-h-screen bg-surface-panel overflow-hidden">
      <div className="pointer-events-none absolute -right-32 -top-16 -z-10 opacity-[0.05] select-none">
        <Image src="/logo-light.png" alt="" width={640} height={640} priority />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-xl flex-col items-stretch px-6 py-10">
        {/* App brand */}
        <div className="mb-10 flex items-center justify-center gap-2.5">
          <Image src="/logo-light.png" alt="Daubert" width={26} height={26} priority />
          <span className="text-base font-semibold tracking-tight text-ink">Daubert</span>
        </div>

        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mb-3 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
            <FaShield size={11} />
            <span>Authorize agent</span>
          </div>
          <h1 className="text-2xl font-semibold leading-snug tracking-tight text-ink">
            <strong className="font-bold text-ink">{preview.clientDisplayName}</strong>{' '}
            <span className="text-ink-muted">wants to act as you in Daubert.</span>
          </h1>
        </div>

        {/* Main card */}
        <div className="rounded-xl bg-surface border border-line shadow-[0_24px_60px_-30px_rgba(11,18,32,0.18)] overflow-hidden">
          <div className="space-y-6 p-6">
            {noEligibleOrgs ? (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-lg border border-amber-400/50 bg-amber-50 px-4 py-3 text-sm text-amber-700"
              >
                <FaTriangleExclamation size={14} className="mt-0.5 shrink-0" />
                <p>
                  You need to be an admin or member of an organization to connect an agent. Ask
                  your organization admin to invite you, or contact support.
                </p>
              </div>
            ) : (
              <div>
                <label
                  htmlFor="consent-org-select"
                  className="mb-1 block text-sm font-medium text-ink"
                >
                  Organization
                </label>
                <p className="mb-2 text-xs text-ink-muted">
                  The agent will be bound to this organization. It can only see cases that belong
                  to it.
                </p>
                <Select
                  id="consent-org-select"
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  disabled={submitting !== null}
                >
                  {preview.eligibleOrgs.length !== 1 && (
                    <option value="" disabled>
                      Select an organization…
                    </option>
                  )}
                  {preview.eligibleOrgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {orgOptionLabel(org)}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {/* Capability list */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                This will allow {preview.clientDisplayName} to
              </p>
              <ul className="space-y-2">
                {CAPABILITIES.map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-start gap-3 text-sm text-ink">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-brand/15 text-brand-ink">
                      <Icon size={11} />
                    </span>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-faint">
                Bounded to the chosen organization and your per-case roles. The agent can never
                see cases outside this organization, even if you can.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-redline/30 bg-redline/10 px-3 py-2 text-sm text-redline"
              >
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={handleDeny}
                disabled={submitting !== null}
              >
                {submitting === 'deny' ? 'Cancelling…' : 'Deny'}
              </Button>
              {!noEligibleOrgs && (
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleAllow}
                  disabled={!canAllow}
                >
                  {submitting === 'allow' ? 'Connecting…' : 'Allow'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Redirect URI footer */}
        <p className="mt-6 text-center text-xs text-ink-faint">
          You will be redirected to{' '}
          <span className="break-all font-mono text-ink-muted">{preview.redirectUri}</span> after
          your decision.
        </p>
      </main>
    </div>
  );
}
