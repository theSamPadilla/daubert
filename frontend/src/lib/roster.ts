import type { components } from '../generated/api-types';

type OrganizationRoster = components['schemas']['OrganizationRoster'];

/** A person who can potentially be staffed onto a case, drawn from either an
 *  accepted org membership or a pending org invite. */
export interface StaffingCandidate {
  /** userId when known, else `email:${lowercased email}`. Stable identity to
   *  key a picker option on regardless of whether the person has signed up. */
  key: string;
  userId: string | null;
  email: string;
  name: string | null;
  /** True when this reflects an org invite that hasn't been accepted yet. */
  pending: boolean;
}

export interface StaffingRoster {
  /** Selectable in a case-staffing picker. */
  candidates: StaffingCandidate[];
  /** Shown disabled, with a reason — see the comment in buildStaffingRoster. */
  implicitAdmins: StaffingCandidate[];
}

/** Empty roster to render pickers against while the real one is loading or
 *  failed to fetch. */
export const EMPTY_ROSTER: OrganizationRoster = { members: [], pendingInvites: [] };

/** `Name (email)`, falling back to bare email when there is no name; suffixed
 *  when the candidate is still a pending org invite. */
export function candidateLabel(c: StaffingCandidate): string {
  const base = c.name ? `${c.name} (${c.email})` : c.email;
  return c.pending ? `${base} - org invite pending` : base;
}

/** Label for an org admin shown disabled in the picker (see buildStaffingRoster
 *  for why admins can't be staffed directly). */
export function implicitAdminLabel(c: StaffingCandidate): string {
  const base = c.name || c.email;
  return c.pending
    ? `${base} - org admin invite pending, will have access`
    : `${base} - org admin, already has access`;
}

interface RosterEntry {
  userId: string | null;
  email: string;
  name: string | null;
  isAdmin: boolean;
  pending: boolean;
}

function normalizeName(name: string | null | undefined): string | null {
  if (!name || name.trim().length === 0) return null;
  return name;
}

function normalizeExcludeSet(values: Iterable<string> | undefined, lowercase: boolean): Set<string> {
  const set = new Set<string>();
  if (!values) return set;
  for (const value of values) {
    if (!value) continue;
    set.add(lowercase ? value.toLowerCase() : value);
  }
  return set;
}

/** Accepted entries win over pending ones for the same (lowercased) email. */
function upsert(byEmail: Map<string, RosterEntry>, key: string, entry: RosterEntry): void {
  const existing = byEmail.get(key);
  if (!existing || (existing.pending && !entry.pending)) {
    byEmail.set(key, entry);
  }
}

function toCandidate(entry: RosterEntry): StaffingCandidate {
  return {
    key: entry.userId ?? `email:${entry.email.toLowerCase()}`,
    userId: entry.userId,
    email: entry.email,
    name: entry.name,
    pending: entry.pending,
  };
}

/** Accepted before pending; alphabetical (locale-fixed, case-insensitive) by
 *  name within a group, falling back to email when name is null. */
function compareCandidates(a: StaffingCandidate, b: StaffingCandidate): number {
  if (a.pending !== b.pending) return a.pending ? 1 : -1;
  const aKey = (a.name ?? a.email).toLowerCase();
  const bKey = (b.name ?? b.email).toLowerCase();
  return aKey.localeCompare(bKey, 'en');
}

/**
 * Partitions an org roster into who can be staffed onto a case and who can't.
 *
 * Org `admin`s (accepted or still-pending) already hold implicit `owner`
 * access on every case in the org, and an explicit `case_members` row TAKES
 * PRECEDENCE over that implicit role — so staffing an admin here as, say,
 * "viewer" would silently DOWNGRADE them. They're returned separately
 * (`implicitAdmins`) so callers can show them disabled with an explanation
 * instead of letting them be picked.
 */
export function buildStaffingRoster(
  roster: OrganizationRoster,
  opts: { excludeUserIds?: Iterable<string>; excludeEmails?: Iterable<string> } = {},
): StaffingRoster {
  const excludeUserIds = normalizeExcludeSet(opts.excludeUserIds, false);
  const excludeEmails = normalizeExcludeSet(opts.excludeEmails, true);

  const byEmail = new Map<string, RosterEntry>();

  for (const member of roster.members) {
    // No `user` means no email to staff by — skip rather than crash.
    if (!member.user) continue;
    const email = member.user.email;
    upsert(byEmail, email.toLowerCase(), {
      userId: member.userId,
      email,
      name: normalizeName(member.user.name),
      isAdmin: member.role === 'admin',
      pending: false,
    });
  }

  for (const invite of roster.pendingInvites) {
    const email = invite.email;
    upsert(byEmail, email.toLowerCase(), {
      userId: invite.userId ?? null,
      email,
      name: normalizeName(invite.name),
      isAdmin: invite.role === 'admin',
      pending: true,
    });
  }

  const candidates: StaffingCandidate[] = [];
  const implicitAdmins: StaffingCandidate[] = [];

  for (const entry of byEmail.values()) {
    if (entry.userId && excludeUserIds.has(entry.userId)) continue;
    if (excludeEmails.has(entry.email.toLowerCase())) continue;

    if (entry.isAdmin) {
      implicitAdmins.push(toCandidate(entry));
      continue;
    }

    candidates.push(toCandidate(entry));
  }

  candidates.sort(compareCandidates);
  implicitAdmins.sort(compareCandidates);

  return { candidates, implicitAdmins };
}
