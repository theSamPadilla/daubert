'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FaUserTie,
  FaPlus,
  FaCircleNotch,
  FaChevronDown,
  FaChevronRight,
  FaTriangleExclamation,
} from 'react-icons/fa6';
import { apiClient, type Production, type DeclarationFormat } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { useCaseContext } from '@/contexts/CaseContext';
import { useAuth } from '@/components/Auth/AuthProvider';
import { shortAddress, useCaseSeed, type SeedAddressError } from '@/hooks/useCaseSeed';
import { PageHeader } from '@/components/Common/PageHeader';
import UserMenu from '@/components/Auth/UserMenu';
import { Button, Badge, Field, Select, Textarea, Input } from '@/components/ui';
import { ChainSelect } from '@/components/Graph/ChainSelect';
import { DeclarantModal, type DeclarantDto } from '@/components/Declarants/DeclarantModal';
import { applyDeclarant } from '@/components/Productions/DeclarantPicker';
import { inspectInput } from '@/utils/addressParser';
import { SUPPORTED_CHAINS } from '@/services/types';
import {
  readOnboardingRecord,
  writeOnboardingRecord,
} from '@/components/Onboarding/checklist';
import {
  buildEngagementSummary,
  type EngagementContext,
} from '@/components/Onboarding/engagementSummary';

type Declarant = components['schemas']['Declarant'];
type DeclarationData = components['schemas']['DeclarationData'];
type DeclarationFormatId = components['schemas']['DeclarationFormatId'];

type WizardStep = 'declarant' | 'trace' | 'declaration';

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'declarant', label: 'Declarant' },
  { id: 'trace', label: 'Seed trace' },
  { id: 'declaration', label: 'Declaration' },
];

// A token that parses to a usable wallet address, with its resolved family.
interface ParsedToken {
  raw: string;
  address: string;
  family: 'evm' | 'tron' | 'bitcoin' | 'solana' | 'unknown';
  isTxHash: boolean;
  valid: boolean;
}

function parseTokens(input: string): ParsedToken[] {
  return input
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((raw) => {
      const info = inspectInput(raw);
      if (info.kind === 'transaction') {
        return { raw, address: info.txHash ?? raw, family: info.family, isTxHash: true, valid: false };
      }
      if (info.kind === 'address' && info.family !== 'unknown') {
        return { raw, address: info.address ?? raw, family: info.family, isTxHash: false, valid: true };
      }
      return { raw, address: raw, family: 'unknown' as const, isTxHash: false, valid: false };
    });
}

export function CaseOnboardingWizard({ onSkip }: { onSkip: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const {
    caseId,
    orgSlug,
    isOrgAdmin,
    caseSummary,
    refreshCase,
    reloadInvestigations,
    onProductionUpdated,
  } = useCaseContext();

  const [step, setStep] = useState<WizardStep>('declarant');

  // ---- Step 1: declarant ------------------------------------------------
  const [declarants, setDeclarants] = useState<Declarant[]>([]);
  const [declarantsLoading, setDeclarantsLoading] = useState(false);
  const [declarantsError, setDeclarantsError] = useState<string | null>(null);
  const [selectedDeclarantId, setSelectedDeclarantId] = useState<string | null>(null);
  const [declarantModalOpen, setDeclarantModalOpen] = useState(false);

  const loadDeclarants = useMemo(
    () => async (autoSelectId?: string) => {
      if (!orgSlug) return;
      setDeclarantsLoading(true);
      setDeclarantsError(null);
      try {
        const result = await apiClient.listDeclarants(orgSlug);
        setDeclarants(result);
        if (autoSelectId) setSelectedDeclarantId(autoSelectId);
      } catch {
        setDeclarants([]);
        setDeclarantsError('Failed to load declarants.');
      } finally {
        setDeclarantsLoading(false);
      }
    },
    [orgSlug],
  );

  useEffect(() => {
    void loadDeclarants();
  }, [loadDeclarants]);

  const selectedDeclarant = declarants.find((d) => d.id === selectedDeclarantId) ?? null;

  // ---- Step 2: seed trace ----------------------------------------------
  const [addressInput, setAddressInput] = useState('');
  const [chain, setChain] = useState<string>('ethereum');
  // Once the user manually changes the chain we stop auto-deriving it.
  const [chainTouched, setChainTouched] = useState(false);
  const [engagementOpen, setEngagementOpen] = useState(true);
  const [side, setSide] = useState<EngagementContext['side']>('');
  const [scope, setScope] = useState('');
  const [allegations, setAllegations] = useState('');
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seedResultSummary, setSeedResultSummary] = useState<string | null>(null);
  const [seedAddressErrors, setSeedAddressErrors] = useState<SeedAddressError[]>([]);
  const { seed, phase } = useCaseSeed(caseId);
  const seedInFlightRef = useRef(false);

  const tokens = useMemo(() => parseTokens(addressInput), [addressInput]);
  const validTokens = useMemo(() => tokens.filter((t) => t.valid), [tokens]);
  const hasTron = validTokens.some((t) => t.family === 'tron');
  const hasEvm = validTokens.some((t) => t.family === 'evm');
  const hasBtc = validTokens.some((t) => t.family === 'bitcoin');
  const hasSol = validTokens.some((t) => t.family === 'solana');
  const mixedFamilies = [hasTron, hasEvm, hasBtc, hasSol].filter(Boolean).length > 1;

  // Auto-derive chain from the parsed families until the user overrides it.
  useEffect(() => {
    if (chainTouched || validTokens.length === 0) return;
    if (hasBtc && !hasTron && !hasEvm && !hasSol) setChain('bitcoin');
    else if (hasTron && !hasEvm && !hasBtc && !hasSol) setChain('tron');
    else if (hasEvm && !hasTron && !hasBtc && !hasSol) setChain('ethereum');
    else if (hasSol && !hasTron && !hasEvm && !hasBtc) setChain('solana');
  }, [chainTouched, validTokens.length, hasTron, hasEvm, hasBtc, hasSol]);

  const seeding = phase === 'fetching' || phase === 'creating' || phase === 'importing';
  const phaseLabel =
    phase === 'fetching'
      ? 'Fetching activity...'
      : phase === 'creating'
        ? 'Creating the trace...'
        : phase === 'importing'
          ? 'Importing transactions...'
          : null;

  // ---- Step 3: declaration ---------------------------------------------
  const defaultDeclName = useMemo(() => {
    const dn = selectedDeclarant?.displayName?.trim();
    return dn ? `Declaration of ${dn}` : 'Declaration';
  }, [selectedDeclarant]);
  const [declName, setDeclName] = useState('');
  const [declNameTouched, setDeclNameTouched] = useState(false);
  const [formats, setFormats] = useState<DeclarationFormat[]>([]);
  const [formatsLoading, setFormatsLoading] = useState(true);
  const [formatId, setFormatId] = useState<DeclarationFormatId>('ca-declaration');
  const [declError, setDeclError] = useState<string | null>(null);
  const [creatingDecl, setCreatingDecl] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listDeclarationFormats()
      .then((f) => {
        if (cancelled) return;
        setFormats(f);
        if (f.length > 0 && !f.some((fmt) => fmt.id === formatId)) {
          setFormatId(f[0].id);
        }
      })
      .catch(() => {
        /* non-fatal: create still works with the default id */
      })
      .finally(() => {
        if (!cancelled) setFormatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the declaration name in sync with the selected declarant until the
  // user edits it themselves.
  const effectiveDeclName = declNameTouched ? declName : defaultDeclName;

  // ---- Skip / dismiss ---------------------------------------------------
  const handleSkipSetup = () => {
    writeOnboardingRecord(caseId, { wizardDismissed: true });
    onSkip();
  };

  // ---- Finish -----------------------------------------------------------
  // Refreshes case + investigation list + productions, then routes based on what was created.
  const finish = (opts: { seededInvestigationId?: string; productionId?: string }) => {
    refreshCase();
    reloadInvestigations();
    onProductionUpdated();
    if (opts.seededInvestigationId) {
      router.push(`/cases/${caseId}/investigations?inv=${opts.seededInvestigationId}`);
    } else if (opts.productionId) {
      router.push(`/cases/${caseId}/productions?id=${opts.productionId}`);
    } else {
      writeOnboardingRecord(caseId, { wizardDismissed: true });
      onSkip();
    }
  };

  // Track what has been produced so far so "finish" knows where to route.
  const [seededInvestigationId, setSeededInvestigationId] = useState<string | undefined>(undefined);

  // ---- Step 2 action ----------------------------------------------------
  const handleSeed = async () => {
    if (seedInFlightRef.current) return;
    seedInFlightRef.current = true;
    try {
      setSeedError(null);
      setSeedAddressErrors([]);
      if (validTokens.length === 0) {
        setSeedError('Enter at least one wallet address.');
        return;
      }
      if (mixedFamilies) {
        setSeedError('One chain per seed. Remove the addresses from the other chains.');
        return;
      }
      const addresses = validTokens.map((t) => t.address);
      const result = await seed(addresses, chain);
      if (!result) {
        setSeedError('We could not find any activity for those addresses. Check them and try again.');
        return;
      }

      writeOnboardingRecord(caseId, {
        seedNodeCount: result.nodeCount,
        seededInvestigationId: result.investigationId,
      });
      setSeededInvestigationId(result.investigationId);
      setSeedAddressErrors(result.errors);

      // Persist engagement context onto the case summary if the user provided any
      // and the case has no summary yet (never clobber an existing one).
      const summary = buildEngagementSummary({ side, scope, allegations });
      if (summary && !(caseSummary ?? '').trim()) {
        try {
          await apiClient.updateCase(caseId, { summary });
        } catch {
          /* non-fatal: the trace is already seeded */
        }
      }

      setSeedResultSummary(
        `Imported ${result.txCount} ${result.txCount === 1 ? 'transaction' : 'transactions'} across ${result.nodeCount} ${result.nodeCount === 1 ? 'wallet' : 'wallets'}.`,
      );
      setStep('declaration');
    } finally {
      seedInFlightRef.current = false;
    }
  };

  // ---- Step 3 action ----------------------------------------------------
  const handleCreateDeclaration = async () => {
    setDeclError(null);
    setCreatingDecl(true);
    const name = effectiveDeclName.trim() || 'Declaration';
    try {
      const prod: Production = await apiClient.createProduction(caseId, {
        name,
        type: 'declaration',
        data: { formatId },
      });
      if (selectedDeclarant) {
        const full = await apiClient.getProduction(prod.id);
        const nextData = applyDeclarant(full.data as DeclarationData, selectedDeclarant);
        await apiClient.updateProduction(prod.id, {
          data: nextData as unknown as Record<string, unknown>,
        });
      }
      finish({ seededInvestigationId, productionId: prod.id });
    } catch (err) {
      setDeclError(err instanceof Error ? err.message : 'Failed to create the declaration.');
      setCreatingDecl(false);
    }
  };

  return (
    <>
      <PageHeader title="Case onboarding" rightContent={<UserMenu />} />
      <div className="flex-1 overflow-y-auto bg-surface">
        <div className="mx-auto w-full max-w-2xl px-6 py-8">
          <div className="mb-8 flex flex-col items-center text-center">
            <img
              src="/logo.png"
              alt=""
              aria-hidden="true"
              draggable={false}
              className="mb-3 h-16 w-16 select-none opacity-90"
            />
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Set up your case</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Three quick steps to your first trace and declaration.
            </p>
          </div>

          {/* Stepper */}
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {STEPS.map((s, i) => {
                const currentIndex = STEPS.findIndex((x) => x.id === step);
                const done = i < currentIndex;
                const current = s.id === step;
                return (
                  <div key={s.id} className="flex items-center gap-2">
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium ${
                        current || done
                          ? 'bg-brand text-white'
                          : 'bg-surface-raised text-ink-muted'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span
                      className={`text-[13px] ${
                        current ? 'text-ink font-medium' : done ? 'text-ink-soft' : 'text-ink-muted'
                      }`}
                    >
                      {s.label}
                    </span>
                    {i < STEPS.length - 1 && (
                      <span className="mx-1 h-px w-6 bg-line" aria-hidden="true" />
                    )}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={handleSkipSetup}
              className="text-[13px] text-ink-muted hover:text-ink transition-colors"
            >
              Skip setup
            </button>
          </div>

          {/* Step 1: Declarant */}
          {step === 'declarant' && (
            <section className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-ink">Who is declaring?</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Pick the expert whose declaration this case will produce, or add them now. You can
                  skip this and do it later.
                </p>
              </div>

              {!orgSlug ? (
                <p className="text-sm text-ink-muted">
                  We could not resolve this case&apos;s organization, so declarants are unavailable
                  here. You can add one later from the Declarations tab.
                </p>
              ) : (
                <>
                  {declarantsLoading && (
                    <p className="text-sm text-ink-muted">Loading declarants...</p>
                  )}
                  {declarantsError && !declarantsLoading && (
                    <p className="text-sm text-redline">{declarantsError}</p>
                  )}
                  {!declarantsLoading && !declarantsError && declarants.length === 0 && (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line py-8 text-center">
                      <FaUserTie className="mb-2 h-6 w-6 text-ink-faint/60" />
                      <p className="text-sm text-ink-muted">No declarants yet.</p>
                    </div>
                  )}
                  {!declarantsLoading && !declarantsError && declarants.length > 0 && (
                    <div className="space-y-1">
                      {declarants.map((declarant) => {
                        const isSelected = declarant.id === selectedDeclarantId;
                        const subtitle = [declarant.title, declarant.firm]
                          .filter(Boolean)
                          .join(' · ');
                        return (
                          <button
                            key={declarant.id}
                            type="button"
                            onClick={() => setSelectedDeclarantId(isSelected ? null : declarant.id)}
                            className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                              isSelected
                                ? 'border-brand bg-brand-soft'
                                : 'border-line-strong bg-surface hover:bg-surface-raised'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="flex-1 truncate text-sm font-medium text-ink">
                                {declarant.displayName}
                              </span>
                              {declarant.userId === user?.id && (
                                <Badge tone="accent" className="shrink-0">
                                  You
                                </Badge>
                              )}
                            </div>
                            {subtitle && (
                              <div className="mt-0.5 truncate text-[12px] text-ink-muted">
                                {subtitle}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDeclarantModalOpen(true)}
                  >
                    <FaPlus size={11} /> New declarant
                  </Button>
                </>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-line pt-5">
                <Button variant="secondary" size="sm" onClick={() => setStep('trace')}>
                  Skip
                </Button>
                <Button size="sm" onClick={() => setStep('trace')}>
                  Next
                </Button>
              </div>
            </section>
          )}

          {/* Step 2: Seed trace */}
          {step === 'trace' && (
            <section className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-ink">Seed your first trace</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Paste one or more wallet addresses. We fetch the most recent activity and draw the
                  graph.
                </p>
              </div>

              <div className="flex items-end gap-3">
                <div className="min-w-0 flex-1">
                  <Field label="Wallet addresses">
                    <Input
                      type="text"
                      value={addressInput}
                      onChange={(e) => setAddressInput(e.target.value)}
                      placeholder="0x1234... , T9yD14..."
                      disabled={seeding}
                    />
                  </Field>
                </div>
                <div className="w-44 shrink-0">
                  <Field label="Chain">
                    <ChainSelect
                      tone="surface"
                      value={chain}
                      options={Object.keys(SUPPORTED_CHAINS)}
                      disabled={seeding}
                      onChange={(next) => {
                        setChain(next);
                        setChainTouched(true);
                      }}
                    />
                  </Field>
                </div>
              </div>

              {tokens.length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-line bg-surface-raised/50 p-3">
                  {tokens.map((t, i) => (
                    <div key={`${t.raw}-${i}`} className="flex items-center gap-2 text-[13px]">
                      {t.valid ? (
                        <>
                          <Badge tone="brand" className="shrink-0 uppercase">
                            {t.family}
                          </Badge>
                          <span className="truncate font-mono text-ink-soft">{t.address}</span>
                        </>
                      ) : t.isTxHash ? (
                        <span className="text-redline">
                          That looks like a transaction hash. Paste the wallet address instead.
                        </span>
                      ) : (
                        <>
                          <Badge tone="danger" className="shrink-0">
                            Invalid
                          </Badge>
                          <span className="truncate font-mono text-ink-muted">{t.raw}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {mixedFamilies && (
                <p className="flex items-start gap-2 text-[13px] text-redline">
                  <FaTriangleExclamation className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  One chain per seed. Remove the addresses from the other chains.
                </p>
              )}

              {/* Engagement context disclosure */}
              <div className="rounded-lg border border-line">
                <button
                  type="button"
                  onClick={() => setEngagementOpen((o) => !o)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-ink-soft"
                >
                  {engagementOpen ? (
                    <FaChevronDown size={11} className="text-ink-faint" />
                  ) : (
                    <FaChevronRight size={11} className="text-ink-faint" />
                  )}
                  Engagement context (optional)
                </button>
                {engagementOpen && (
                  <div className="space-y-3 border-t border-line px-3 py-3">
                    <p className="text-xs text-ink-faint">
                      Stored on the case summary. The AI assistant uses it to scope the declaration
                      draft.
                    </p>
                    <Field label="Side">
                      <Select
                        value={side}
                        onChange={(e) => setSide(e.target.value as EngagementContext['side'])}
                      >
                        <option value="">Unspecified</option>
                        <option value="plaintiff">Plaintiff</option>
                        <option value="defense">Defense</option>
                        <option value="neutral">Neutral</option>
                      </Select>
                    </Field>
                    <Field label="Scope of engagement">
                      <Textarea
                        value={scope}
                        onChange={(e) => setScope(e.target.value)}
                        rows={2}
                        placeholder="What you were retained to analyze"
                      />
                    </Field>
                    <Field label="Key allegations">
                      <Textarea
                        value={allegations}
                        onChange={(e) => setAllegations(e.target.value)}
                        rows={2}
                        placeholder="The core claims at issue"
                      />
                    </Field>
                  </div>
                )}
              </div>

              {phaseLabel && (
                <p className="flex items-center gap-2 text-sm text-ink-muted">
                  <FaCircleNotch className="h-3.5 w-3.5 animate-spin" />
                  {phaseLabel}
                </p>
              )}

              {seedError && !seeding && (
                <p className="flex items-start gap-2 text-[13px] text-redline">
                  <FaTriangleExclamation className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {seedError}
                </p>
              )}

              <div className="flex items-center justify-between border-t border-line pt-5">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setStep('declarant')}
                  disabled={seeding}
                >
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setStep('declaration')}
                    disabled={seeding}
                  >
                    Skip
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSeed}
                    disabled={seeding || validTokens.length === 0 || mixedFamilies}
                  >
                    {seeding ? 'Working...' : 'Fetch and trace'}
                  </Button>
                </div>
              </div>
            </section>
          )}

          {/* Step 3: Declaration */}
          {step === 'declaration' && (
            <section className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-ink">Set up the declaration</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Creates the declaration document with your jurisdiction&apos;s format. The AI
                  assistant can draft the body once your trace has substance.
                </p>
              </div>

              {seedResultSummary && (
                <div className="rounded-lg border border-brand/30 bg-brand-soft/40 px-3 py-2 text-[13px] text-ink-soft">
                  {seedResultSummary}
                </div>
              )}

              {seedAddressErrors.length > 0 && (
                <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-700">
                  {seedAddressErrors.map((e, i) => (
                    <div key={`${e.address}-${i}`} className="flex items-start gap-2">
                      <FaTriangleExclamation className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Could not fetch {shortAddress(e.address)}: {e.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <Field label="Name">
                <Input
                  type="text"
                  value={effectiveDeclName}
                  onChange={(e) => {
                    setDeclName(e.target.value);
                    setDeclNameTouched(true);
                  }}
                  placeholder="Declaration"
                  disabled={creatingDecl}
                />
              </Field>

              <Field label="Format">
                <Select
                  value={formatId}
                  disabled={creatingDecl || formatsLoading || formats.length === 0}
                  onChange={(e) => setFormatId(e.target.value as DeclarationFormatId)}
                >
                  {formatsLoading && <option value="">Loading...</option>}
                  {formats.map((format) => (
                    <option key={format.id} value={format.id}>
                      {format.label} ({format.jurisdiction})
                    </option>
                  ))}
                </Select>
              </Field>

              {selectedDeclarant && (
                <p className="text-[13px] text-ink-muted">
                  Prefills name and qualifications from {selectedDeclarant.displayName}.
                </p>
              )}

              {declError && (
                <p className="flex items-start gap-2 text-[13px] text-redline">
                  <FaTriangleExclamation className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {declError}
                </p>
              )}

              <div className="flex items-center justify-between border-t border-line pt-5">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setStep('trace')}
                  disabled={creatingDecl}
                >
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => finish({ seededInvestigationId })}
                    disabled={creatingDecl}
                  >
                    Skip
                  </Button>
                  <Button size="sm" onClick={handleCreateDeclaration} disabled={creatingDecl}>
                    {creatingDecl ? 'Creating...' : 'Create declaration'}
                  </Button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {declarantModalOpen && orgSlug && user && (
        <DeclarantModal
          declarant={null}
          orgSlug={orgSlug}
          isAdmin={isOrgAdmin}
          currentUserId={user.id}
          onClose={() => setDeclarantModalOpen(false)}
          onSave={async (dto: DeclarantDto) => {
            const created = await apiClient.createDeclarant(orgSlug, dto);
            await loadDeclarants(created.id);
            return created;
          }}
        />
      )}
    </>
  );
}
