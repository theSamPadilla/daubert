import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, OAuthProvider, type Auth } from 'firebase/auth';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

let _app: FirebaseApp | undefined;
let _auth: Auth | undefined;
let _appCheck: AppCheck | null = null;

function getApp(): FirebaseApp {
  if (!_app) {
    _app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  }
  return _app;
}

// Initialize App Check (browser only)
if (typeof window !== 'undefined') {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

  if (process.env.NODE_ENV === 'development') {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  if (siteKey) {
    _appCheck = initializeAppCheck(getApp(), {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
}

export function getFirebaseAuth(): Auth {
  if (!_auth) {
    _auth = getAuth(getApp());
  }
  return _auth;
}

export const appCheck = _appCheck;

// Convenience exports — safe to instantiate at module load (they're plain provider objects).
export const googleProvider = new GoogleAuthProvider();
// Force Google to show the account picker every time, not the last-used account.
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const microsoftProvider = new OAuthProvider('microsoft.com');
// tenant=organizations restricts to work/school Microsoft accounts (any Entra-backed
// tenant) and skips Microsoft's account-type-detection interstitial. The default
// 'common' tenant hangs in popup mode — the extra interstitial hop severs the
// popup's window.opener under COOP, so Firebase can't postMessage the result back.
// Personal MSAs (hotmail/outlook/live) are intentionally not supported.
// See `docs/plans/2026-06-01-microsoft-login-setup.md`.
microsoftProvider.setCustomParameters({ prompt: 'select_account', tenant: 'organizations' });
