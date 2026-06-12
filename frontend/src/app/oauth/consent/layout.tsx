import type { ReactNode } from 'react';

/**
 * Standalone layout for the OAuth consent screen.
 *
 * Intentionally chrome-less: no AppShell, no nav, no sidebar. The consent
 * page is a security surface that hands control off to a third-party agent
 * via redirect, so it should look standalone rather than embedded in the app.
 *
 * The root layout (`app/layout.tsx`) still wraps this with `AuthProvider`
 * (and the org/confirm providers), which is all the consent page needs to
 * read the Firebase auth state. The app's chrome lives in nested route
 * layouts (e.g. `app/cases/[caseId]/(workspace)/layout.tsx`), so this route
 * simply by not declaring an AppShell wrapper avoids it entirely.
 */
export default function OAuthConsentLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
