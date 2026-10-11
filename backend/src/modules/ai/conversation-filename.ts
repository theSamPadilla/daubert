/**
 * Filename stem for a conversation export. Only [a-z0-9-] can come out, so the
 * result is safe to interpolate into a Content-Disposition header.
 */
export function conversationFilenameSlug(title: string | null | undefined, createdAt: Date): string {
  const slug = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || `conversation-${createdAt.toISOString().slice(0, 10)}`;
}
