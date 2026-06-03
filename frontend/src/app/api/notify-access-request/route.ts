import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export const runtime = 'nodejs';

type AccessRequestPayload = {
  email?: string;
  name?: string;
  organization?: string;
  source?: string;
  origin?: 'app' | 'website' | string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => EMAIL_RE.test(s));
}

export async function POST(req: NextRequest) {
  let body: AccessRequestPayload;
  try {
    body = (await req.json()) as AccessRequestPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const email = (body.email ?? '').trim();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'Invalid email.' }, { status: 400 });
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? '465');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = parseRecipients(process.env.SIGNUP_NOTIFY_TO);
  const from = process.env.SIGNUP_NOTIFY_FROM || user;

  if (!host || !user || !pass || to.length === 0 || !from) {
    console.error('notify-access-request: SMTP env not configured', {
      hasHost: !!host,
      hasUser: !!user,
      hasPass: !!pass,
      hasFrom: !!from,
      recipientCount: to.length,
    });
    return NextResponse.json({ ok: false, error: 'Notify not configured.' }, { status: 503 });
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const origin = body.origin || 'app';
  const lines = [
    `Email: ${email}`,
    body.name ? `Name: ${body.name}` : null,
    body.organization ? `Organization: ${body.organization}` : null,
    body.source ? `Source: ${body.source}` : null,
    `Origin: ${origin}`,
    `Time: ${new Date().toISOString()}`,
  ].filter(Boolean);

  try {
    await transporter.sendMail({
      from,
      to: to.join(', '),
      replyTo: email,
      subject: `Daubert access request · ${email} · ${origin}`,
      text: lines.join('\n'),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('notify-access-request: sendMail failed', err);
    return NextResponse.json({ ok: false, error: 'Send failed.' }, { status: 502 });
  }
}
