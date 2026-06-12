/**
 * Navigation seam for the authorize bridge page — lives in its own module
 * because Next.js App Router forbids extra exports from `page.tsx`. Tests spy
 * on it via `jest.spyOn` (jsdom won't let us override `window.location`
 * directly). Mirrors `_consentNav` on the consent screen.
 */
export const _authorizeNav = {
  redirect(url: string) {
    window.location.href = url;
  },
};
