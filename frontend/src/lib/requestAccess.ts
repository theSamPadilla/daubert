export type AccessRequestPayload = {
  email: string;
  name?: string;
  organization?: string;
  source: 'login-email' | 'login-no-account' | 'auth-guard';
  origin: 'app';
};

export type AccessRequestResult =
  | { ok: true }
  | { ok: false; error: string };

async function postSheet(payload: AccessRequestPayload): Promise<AccessRequestResult> {
  const endpoint = process.env.NEXT_PUBLIC_SIGNUP_ENDPOINT;

  if (!endpoint) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('NEXT_PUBLIC_SIGNUP_ENDPOINT not set. Logging payload:', payload);
      return { ok: true };
    }
    return { ok: false, error: 'Access requests are not configured yet. Please email hello@dauberts.ai instead.' };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script doesn't handle.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return { ok: false, error: `Submission failed (${res.status}). Please try again.` };
    }

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (json && json.ok === false) {
        return { ok: false, error: json.error || 'Submission failed.' };
      }
    } catch {
      // Apps Script may return non-JSON; treat 2xx as success.
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error. Please try again.',
    };
  }
}

async function notifyInternal(payload: AccessRequestPayload): Promise<void> {
  try {
    await fetch('/api/notify-access-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('notify-access-request failed:', err);
    }
  }
}

export async function submitAccessRequest(payload: AccessRequestPayload): Promise<AccessRequestResult> {
  const [sheetResult] = await Promise.all([
    postSheet(payload),
    notifyInternal(payload),
  ]);
  return sheetResult;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
