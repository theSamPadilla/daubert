import { redirect } from 'next/navigation';

// Bare /cases/[caseId] has no UI of its own — the workspace is split into
// /investigations, /data-room, and /productions tabs. Send users to the
// investigations tab by default. Server-side 307 — no client flash, no 404.
export default async function CaseIndexPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  redirect(`/cases/${caseId}/investigations`);
}
