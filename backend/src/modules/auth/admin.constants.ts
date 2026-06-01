/**
 * Default admin email domain. Used ONLY during initial user-shell creation in
 * `AdminUsersService.createWithOptionalMembership` to set the new user's
 * `orgRole` to `'admin'` automatically. Once a user exists, admin status is
 * read off the `users.org_role` column.
 */
export const ADMIN_EMAIL_DOMAIN = 'incite.ventures';
