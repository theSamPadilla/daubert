import { buildStaffingRoster, candidateLabel, implicitAdminLabel, type StaffingCandidate } from './roster';
import type { components } from '../generated/api-types';

type OrganizationRoster = components['schemas']['OrganizationRoster'];
type OrganizationMember = components['schemas']['OrganizationMember'];
type OrgRosterPendingInvite = components['schemas']['OrgRosterPendingInvite'];
type OrgRole = 'admin' | 'member' | 'guest';

const TS = '2026-01-01T00:00:00.000Z';

function makeMember(
  id: string,
  email: string,
  opts: { role?: OrgRole; name?: string; userId?: string } = {},
): OrganizationMember {
  const userId = opts.userId ?? `user-${id}`;
  return {
    id: `member-${id}`,
    userId,
    organizationId: 'org-1',
    role: opts.role ?? 'member',
    user: {
      id: userId,
      email,
      name: opts.name ?? '',
      linked: true,
      createdAt: TS,
      updatedAt: TS,
    },
    createdAt: TS,
    updatedAt: TS,
  };
}

function makeMemberNoUser(id: string): OrganizationMember {
  return {
    id: `member-${id}`,
    userId: `user-${id}`,
    organizationId: 'org-1',
    role: 'member',
    createdAt: TS,
    updatedAt: TS,
  };
}

function makeInvite(
  id: string,
  email: string,
  opts: { role?: OrgRole; name?: string | null; userId?: string } = {},
): OrgRosterPendingInvite {
  return {
    id: `invite-${id}`,
    email,
    name: opts.name ?? null,
    role: opts.role ?? 'member',
    userId: opts.userId ?? `user-${id}`,
    createdAt: TS,
    expiresAt: TS,
  };
}

function roster(members: OrganizationMember[], pendingInvites: OrgRosterPendingInvite[]): OrganizationRoster {
  return { members, pendingInvites };
}

describe('buildStaffingRoster', () => {
  it('places accepted and pending admins into implicitAdmins', () => {
    const r = roster(
      [makeMember('1', 'alice@example.com', { role: 'admin', name: 'Alice' })],
      [makeInvite('1', 'bob@example.com', { role: 'admin', name: 'Bob' })],
    );

    const result = buildStaffingRoster(r, {});

    expect(result.candidates).toHaveLength(0);
    expect(result.implicitAdmins.map((c) => c.email).sort()).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
    expect(result.implicitAdmins.find((c) => c.email === 'alice@example.com')?.pending).toBe(false);
    expect(result.implicitAdmins.find((c) => c.email === 'bob@example.com')?.pending).toBe(true);
  });

  it('exposes a pending non-admin invite as a selectable candidate', () => {
    const r = roster([], [makeInvite('1', 'carol@example.com', { role: 'member', name: 'Carol' })]);

    const result = buildStaffingRoster(r, {});

    expect(result.implicitAdmins).toHaveLength(0);
    expect(result.candidates).toEqual([
      { key: 'user-1', userId: 'user-1', email: 'carol@example.com', name: 'Carol', pending: true },
    ]);
  });

  // getRoster drops invites with no backing user row, so userId is always set in
  // practice. The email key is defensive cover for a contract regression.
  it('falls back to an email key when an entry somehow has no userId', () => {
    const invite = { ...makeInvite('1', 'carol@example.com', { name: 'Carol' }), userId: null };
    const r = roster([], [invite as unknown as OrgRosterPendingInvite]);

    const result = buildStaffingRoster(r, {});

    expect(result.candidates).toEqual([
      { key: 'email:carol@example.com', userId: null, email: 'carol@example.com', name: 'Carol', pending: true },
    ]);
  });

  it('excludes existing case members by userId and by email, case-insensitively', () => {
    const r = roster(
      [
        makeMember('1', 'dave@example.com', { name: 'Dave', userId: 'user-dave' }),
        makeMember('2', 'erin@example.com', { name: 'Erin', userId: 'user-erin' }),
        makeMember('3', 'frank@example.com', { name: 'Frank', userId: 'user-frank' }),
      ],
      [],
    );

    const result = buildStaffingRoster(r, {
      excludeUserIds: ['user-dave'],
      excludeEmails: ['ERIN@example.com'],
    });

    expect(result.candidates.map((c) => c.email)).toEqual(['frank@example.com']);
  });

  it('excludes org admins by userId and by email, case-insensitively', () => {
    const r = roster(
      [
        makeMember('1', 'grace@example.com', { role: 'admin', name: 'Grace', userId: 'user-grace' }),
        makeMember('2', 'henry@example.com', { role: 'admin', name: 'Henry', userId: 'user-henry' }),
        makeMember('3', 'iris@example.com', { role: 'admin', name: 'Iris', userId: 'user-iris' }),
      ],
      [],
    );

    const result = buildStaffingRoster(r, {
      excludeUserIds: ['user-grace'],
      excludeEmails: ['HENRY@example.com'],
    });

    expect(result.implicitAdmins.map((c) => c.email)).toEqual(['iris@example.com']);
    expect(result.candidates).toEqual([]);
  });

  it('prefers an accepted member over a duplicate pending invite for the same email', () => {
    const r = roster(
      [makeMember('1', 'frank@example.com', { name: 'Frank', userId: 'user-frank' })],
      [makeInvite('1', 'Frank@Example.com', { name: 'Frank Pending' })],
    );

    const result = buildStaffingRoster(r, {});

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      email: 'frank@example.com',
      pending: false,
      userId: 'user-frank',
    });
  });

  it('orders accepted before pending and alphabetically within each group', () => {
    const r = roster(
      [
        makeMember('1', 'zed@example.com', { name: 'Zed' }),
        makeMember('2', 'amy@example.com', { name: 'Amy' }),
      ],
      [
        makeInvite('1', 'yara@example.com', { name: 'Yara' }),
        makeInvite('2', 'bob2@example.com', { name: 'Bob' }),
      ],
    );

    const result = buildStaffingRoster(r, {});

    expect(result.candidates.map((c) => c.name)).toEqual(['Amy', 'Zed', 'Bob', 'Yara']);
  });

  it('skips a member row with no user object instead of throwing', () => {
    const r = roster([makeMemberNoUser('1')], []);

    expect(() => buildStaffingRoster(r, {})).not.toThrow();
    const result = buildStaffingRoster(r, {});
    expect(result.candidates).toEqual([]);
    expect(result.implicitAdmins).toEqual([]);
  });
});

function makeCandidate(overrides: Partial<StaffingCandidate> = {}): StaffingCandidate {
  return {
    key: 'user-1',
    userId: 'user-1',
    email: 'jane@example.com',
    name: 'Jane Doe',
    pending: false,
    ...overrides,
  };
}

describe('candidateLabel', () => {
  it('renders a named, accepted candidate as "Name (email)"', () => {
    const c = makeCandidate({ name: 'Jane Doe', email: 'jane@example.com', pending: false });
    expect(candidateLabel(c)).toBe('Jane Doe (jane@example.com)');
  });

  it('falls back to bare email when the candidate has no name', () => {
    const c = makeCandidate({ name: null, email: 'jane@example.com', pending: false });
    expect(candidateLabel(c)).toBe('jane@example.com');
  });

  it('falls back to bare email when the candidate has an empty-string name', () => {
    const c = makeCandidate({ name: '', email: 'jane@example.com', pending: false });
    expect(candidateLabel(c)).toBe('jane@example.com');
  });

  it('suffixes a pending candidate with "- org invite pending"', () => {
    const c = makeCandidate({ name: 'Jane Doe', email: 'jane@example.com', pending: true });
    expect(candidateLabel(c)).toBe('Jane Doe (jane@example.com) - org invite pending');
  });
});

describe('implicitAdminLabel', () => {
  it('renders an accepted admin as "Name - org admin, already has access"', () => {
    const c = makeCandidate({ name: 'Jane Doe', pending: false });
    expect(implicitAdminLabel(c)).toBe('Jane Doe - org admin, already has access');
  });

  it('renders a pending admin as "Name - org admin invite pending, will have access"', () => {
    const c = makeCandidate({ name: 'Jane Doe', pending: true });
    expect(implicitAdminLabel(c)).toBe('Jane Doe - org admin invite pending, will have access');
  });

  it('falls back to bare email when the admin has no name', () => {
    const c = makeCandidate({ name: null, email: 'jane@example.com', pending: false });
    expect(implicitAdminLabel(c)).toBe('jane@example.com - org admin, already has access');
  });
});
