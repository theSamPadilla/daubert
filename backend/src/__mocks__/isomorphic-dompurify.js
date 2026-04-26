/**
 * Manual Jest mock for isomorphic-dompurify.
 *
 * Uses cheerio to implement a simplified tag/attribute allow-list sanitizer
 * so that unit tests can verify the sanitization config in util.ts without
 * pulling in jsdom's ESM dependency tree.
 */
const cheerio = require('cheerio');

function sanitize(dirty, config) {
  if (!config) return dirty;

  const allowedTags = new Set((config.ALLOWED_TAGS || []).map((t) => t.toLowerCase()));
  const allowedAttrs = new Set((config.ALLOWED_ATTR || []).map((a) => a.toLowerCase()));

  const $ = cheerio.load(dirty, null, false);

  // Remove disallowed tags (unwrap or remove entirely)
  $('*').each(function () {
    const tagName = this.tagName?.toLowerCase();
    if (!tagName) return;

    // Strip script / iframe / other disallowed tags entirely (don't unwrap)
    const dangerousTags = new Set(['script', 'iframe', 'object', 'embed', 'form', 'input', 'img']);
    if (!allowedTags.has(tagName)) {
      if (dangerousTags.has(tagName)) {
        $(this).remove();
      } else {
        $(this).replaceWith($(this).html() || '');
      }
      return;
    }

    // Strip disallowed attributes
    const attrs = this.attribs || {};
    for (const attr of Object.keys(attrs)) {
      if (!allowedAttrs.has(attr.toLowerCase())) {
        $(this).removeAttr(attr);
      }
    }
  });

  return $.html();
}

module.exports = { sanitize, default: { sanitize } };
