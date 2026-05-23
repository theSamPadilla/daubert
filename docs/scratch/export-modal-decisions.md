# Export Modal Consolidation — Open Decisions

## Q1. DOCX for reports

User asked: "docs? For reports?" — needs confirmation. DOCX requires a new backend dependency (`html-to-docx` is the obvious choice — converts the report's stored HTML directly to a `.docx` Buffer).

Options:
- **A. PDF + DOCX for reports.** Add `html-to-docx` to backend. New format branch in `/exports/productions/:id`.
- **B. PDF only for reports.** Drop DOCX. Reports become single-format.

## Q2. What does "Image" mean for a chronology (table)?

User said "PDF or Images for essentially everything". A chronology is an HTML table — there's no canvas to `toDataURL`.

Options:
- **A. PDF only for chronologies.** Drop image option for tables.
- **B. Server-side screenshot.** Puppeteer renders the chronology HTML → PNG. Already have Puppeteer; just adds `page.screenshot()` call.
- **C. Client-side html2canvas.** New frontend dep; rasterizes the visible table DOM.

## Q3. (Engineering — deciding myself) Image format

PNG only. JPG adds nothing for screenshots/charts (lossy compression on text-heavy content is worse). Mentioned here so user can override.

## Q4. (Engineering — deciding myself) Modal flow

Modal owns filename + format state. Submit button fires `onExport(format, filename)` (Promise). Modal shows inline spinner while awaiting and closes on success; error stays in modal. Caller does no spinner/error state.
