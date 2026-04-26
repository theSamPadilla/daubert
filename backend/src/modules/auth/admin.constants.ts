/**
 * Email domain that grants admin access. The IsAdminGuard rejects any user
 * whose email domain (the part after `@`) doesn't match exactly.
 *
 * MUST be kept in sync with `frontend/src/lib/admin.ts`. If the domain ever
 * changes, update both files in the same commit.
 */
export const ADMIN_EMAIL_DOMAIN = 'incite.ventures';
