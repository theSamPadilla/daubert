/**
 * Browser helper for picking individual Google Drive files using the
 * `drive.file` scope — no full-drive read access, no CASA review required.
 *
 * Flow:
 *   1. Lazy-load Google Identity Services (GIS) and obtain a short-lived
 *      `drive.file` OAuth access token via a token client. This opens a
 *      Google consent/popup the first time and is otherwise silent.
 *   2. Lazy-load Google's Picker SDK (`gapi` + `gapi.load('picker')`).
 *   3. Open a FILE picker (multi-select) handed that access token + the
 *      browser-side Picker developer key.
 *   4. Resolve with the picked file IDs and the access token so the caller
 *      can POST them to the backend import endpoint (the `drive.file` token
 *      grants the backend per-file access to exactly the picked files).
 *
 * Both external scripts are loaded lazily and their load promises are cached
 * at module scope so HMR / double-mount don't re-inject or race.
 */

declare global {
  // The Google SDKs attach untyped globals to `window`; `any` here is
  // pragmatic and matches the prior implementation of this module.
  interface Window {
    google?: any;
    gapi?: any;
  }
}

const GAPI_SRC = 'https://apis.google.com/js/api.js';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * Cached load promise for the Picker SDK (`gapi` + `gapi.load('picker')`).
 * First call kicks off `<script>` injection; subsequent calls await the same
 * promise. We don't retry on failure — if Google's CDN is down, every call
 * should surface that error rather than silently retrying.
 */
let gapiLoadPromise: Promise<void> | null = null;

function loadGapiAndPicker(): Promise<void> {
  if (gapiLoadPromise) return gapiLoadPromise;
  gapiLoadPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Google Picker requires a browser environment'));
      return;
    }
    // If gapi is already on the window (HMR / second mount), skip the script.
    const afterScriptLoaded = () => {
      if (!window.gapi) {
        reject(new Error('gapi did not initialize after script load'));
        return;
      }
      window.gapi.load('picker', () => resolve());
    };

    if (window.gapi) {
      afterScriptLoaded();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GAPI_SRC}"]`,
    );
    if (existing) {
      // Another mount started loading — wait for it.
      existing.addEventListener('load', afterScriptLoaded, { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google Picker SDK')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = GAPI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = afterScriptLoaded;
    script.onerror = () => reject(new Error('Failed to load Google Picker SDK'));
    document.head.appendChild(script);
  });
  return gapiLoadPromise;
}

/**
 * Cached load promise for Google Identity Services. Same lazy/cached pattern
 * as the gapi loader — the GIS script attaches `google.accounts.oauth2` to
 * the window.
 */
let gisLoadPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Google Identity Services requires a browser environment'));
      return;
    }
    // If GIS is already on the window (HMR / second mount), skip the script.
    const afterScriptLoaded = () => {
      if (!window.google?.accounts?.oauth2) {
        reject(new Error('GIS did not initialize after script load'));
        return;
      }
      resolve();
    };

    if (window.google?.accounts?.oauth2) {
      afterScriptLoaded();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SRC}"]`,
    );
    if (existing) {
      // Another mount started loading — wait for it.
      existing.addEventListener('load', afterScriptLoaded, { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google Identity Services')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = afterScriptLoaded;
    script.onerror = () =>
      reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

/**
 * Request a short-lived `drive.file` access token via the GIS token client.
 * Opens a Google consent/popup. Resolves with the access token or rejects on
 * an OAuth error.
 */
function requestDriveFileToken(): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return Promise.reject(
      new Error('NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID is not set'),
    );
  }

  return new Promise<string>((resolve, reject) => {
    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_FILE_SCOPE,
        callback: (tokenResponse: any) => {
          if (tokenResponse?.error) {
            reject(
              new Error(
                tokenResponse.error_description ||
                  tokenResponse.error ||
                  'Failed to obtain Drive access token',
              ),
            );
            return;
          }
          if (!tokenResponse?.access_token) {
            reject(new Error('No access token returned by Google'));
            return;
          }
          resolve(tokenResponse.access_token);
        },
      });
      tokenClient.requestAccessToken();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Let the user pick one or more Google Drive files (multi-select) using the
 * `drive.file` scope. Resolves with the short-lived access token and the
 * picked file IDs, or `null` if the user cancelled. Rejects on SDK load or
 * OAuth failure.
 */
export async function pickDriveFiles(): Promise<
  { accessToken: string; fileIds: string[] } | null
> {
  // 1. Load GIS and obtain a drive.file access token (consent popup).
  await loadGis();
  const accessToken = await requestDriveFileToken();

  // 2. Load the Picker SDK.
  await loadGapiAndPicker();
  const picker = window.google?.picker;
  if (!picker) {
    throw new Error('Google Picker SDK unavailable after load');
  }

  // 3. Build and open a multi-select FILE picker handed the token.
  return new Promise<{ accessToken: string; fileIds: string[] } | null>(
    (resolve, reject) => {
      try {
        const view = new picker.DocsView();

        const picked = new picker.PickerBuilder()
          .enableFeature(picker.Feature.MULTISELECT_ENABLED)
          .addView(view)
          .setOAuthToken(accessToken)
          .setDeveloperKey(process.env.NEXT_PUBLIC_DRIVE_PICKER_KEY)
          .setCallback((data: any) => {
            if (data.action === picker.Action.PICKED) {
              const fileIds = (data.docs ?? []).map((d: any) => d.id);
              resolve({ accessToken, fileIds });
            } else if (data.action === picker.Action.CANCEL) {
              resolve(null);
            }
            // Other actions (e.g. 'loaded') are no-ops — keep the promise open.
          });

        picked.build().setVisible(true);
      } catch (err) {
        reject(err);
      }
    },
  );
}
