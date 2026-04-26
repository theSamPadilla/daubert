/**
 * Thin wrapper around Google's Picker SDK. The SDK is loaded lazily on first
 * use and cached for subsequent opens — the script tag adds globals to
 * `window` (`gapi`, `google.picker`) and re-injecting it would no-op anyway.
 *
 * The Picker is the only sanctioned way to pick a Drive folder from the
 * browser without exposing the user's full Drive listing API to our code.
 * It runs in a Google-hosted iframe; we just hand it an OAuth access token
 * and a developer (API) key and listen for the selection callback.
 */

declare global {
  interface Window {
    gapi?: {
      load: (lib: string, cb: () => void) => void;
    };
    google?: {
      picker: GooglePickerNamespace;
    };
  }
}

interface GooglePickerNamespace {
  DocsView: new () => DocsView;
  PickerBuilder: new () => PickerBuilder;
  Action: { PICKED: string; CANCEL: string };
  ViewId?: { FOLDERS: string };
}

interface DocsView {
  setIncludeFolders(b: boolean): DocsView;
  setSelectFolderEnabled(b: boolean): DocsView;
  setMimeTypes(types: string): DocsView;
  setOwnedByMe?(b: boolean): DocsView;
}

interface PickerBuilder {
  setOAuthToken(t: string): PickerBuilder;
  setDeveloperKey(k: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  addView(v: DocsView): PickerBuilder;
  setCallback(cb: (result: PickerCallbackData) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}

interface PickerCallbackData {
  action: string;
  docs?: Array<{ id: string; name: string; mimeType?: string }>;
}

const GAPI_SRC = 'https://apis.google.com/js/api.js';

/**
 * Cached load promise. First call kicks off `<script>` injection + `gapi.load
 * ('picker')`; subsequent calls await the same promise. We don't try to
 * recover from a failed load — if Google's CDN is down, every call should
 * surface that error rather than silently retrying.
 */
let loadPromise: Promise<void> | null = null;

function loadGapiAndPicker(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<void>((resolve, reject) => {
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
  return loadPromise;
}

export interface PickedFolder {
  id: string;
  name: string;
}

export interface OpenPickerOptions {
  accessToken: string;
  apiKey: string;
  /**
   * Google Cloud project number. Optional — the Picker works without it but
   * surfaces a console warning. Provide if available.
   */
  appId?: string;
}

/**
 * Open the Google Drive Picker constrained to folders. Resolves with the
 * picked folder, or `null` if the user cancelled. Rejects on SDK load
 * failure or unexpected runtime errors.
 */
export async function openDriveFolderPicker(
  opts: OpenPickerOptions,
): Promise<PickedFolder | null> {
  await loadGapiAndPicker();
  const picker = window.google?.picker;
  if (!picker) {
    throw new Error('Google Picker SDK unavailable after load');
  }

  return new Promise<PickedFolder | null>((resolve, reject) => {
    try {
      const view = new picker.DocsView()
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes('application/vnd.google-apps.folder');

      const builder = new picker.PickerBuilder()
        .setOAuthToken(opts.accessToken)
        .setDeveloperKey(opts.apiKey)
        .addView(view)
        .setCallback((result) => {
          if (result.action === picker.Action.PICKED) {
            const doc = result.docs?.[0];
            if (doc) {
              resolve({ id: doc.id, name: doc.name });
            } else {
              resolve(null);
            }
          } else if (result.action === picker.Action.CANCEL) {
            resolve(null);
          }
          // Other actions (e.g. 'loaded') are no-ops — keep the promise open.
        });

      if (opts.appId) builder.setAppId(opts.appId);

      builder.build().setVisible(true);
    } catch (err) {
      reject(err);
    }
  });
}
