# Misc Notes

## Data Room: Native OAuth vs Service Account Share

### Summary

Pursuing native OAuth means submitting the app to Google's verification process for the restricted `drive` scope (or rewriting to the narrower `drive.file` scope to avoid it), which in the restricted-scope case requires a third-party CASA security assessment costing roughly **$10–25k and 6–12 weeks of calendar time** before any non-allowlisted user can connect — whereas the service account share option is ~1–2 days of backend/frontend work, $0 in external fees, and ships immediately, at the cost of a worse audit trail and a slightly awkward "share folder with a bot email" onboarding step.

### What native OAuth requires (concrete checklist)

- Submit OAuth consent screen for verification in GCP Console.
- Justify use of the `drive` restricted scope (or refactor to `drive.file` and skip CASA).
- Pass a third-party **CASA (Cloud Application Security Assessment)** — Tier 2 or Tier 3 depending on data sensitivity.
  - Engage an authorized lab (e.g., Bishop Fox, Leviathan, NCC Group, Schellman).
  - Provide architecture diagrams, data flow docs, pen-test results, secret-management evidence.
  - Remediate findings; re-test until pass.
- Maintain ongoing compliance: annual reassessment, privacy policy hosted at a verified domain, branded consent screen, demo video of the OAuth flow.
- Real cost: **$10–25k per assessment, 6–12 weeks calendar time**, plus engineering time to remediate findings.

### Advantages of going through CASA

- **Unblocks unlimited real users.** No more 100-user testing allowlist — anyone with a Google account can connect their own Drive without an admin sharing a folder with a bot.
- **Per-user audit trail in Drive.** Every read/write shows the actual user's identity in their Drive audit log — meaningful for legal/investigation workflows where chain of custody matters.
- **Files owned by the user, not a bot.** No "what happens if we rotate the service account" ownership-migration problem. Users keep their data even if Daubert disappears.
- **Picker integration keeps working.** The Google Picker UI requires a user OAuth token; under service-account mode it has to be replaced with a custom folder browser.
- **Trust signal for enterprise buyers.** A verified OAuth app + passed CASA assessment is something procurement and security review teams recognize. It shortens enterprise sales cycles where a "share a folder with a random `iam.gserviceaccount.com` email" flow would raise red flags.
- **Defensible posture for sensitive data.** If Daubert ever handles regulated data (PII, financial records tied to identifiable persons), CASA-level controls are closer to what compliance frameworks (SOC 2, ISO 27001) will want to see anyway — the work isn't wasted.
- **Future-proof.** Google has been steadily tightening restricted-scope enforcement. Apps that go through verification are insulated from policy changes that could break service-account workarounds.

### When each option makes sense

- **Service account share** — right call if the priority is shipping now, the user base is small/known, and the audit-trail limitation is acceptable for the current customer profile.
- **Native OAuth + CASA** — right call once there's revenue or enterprise pipeline justifying the spend, or if the audit trail / per-user identity becomes a hard customer requirement.
- **Hybrid (short term)** — ship service account now to unblock onboarding; start the CASA process in parallel; cut over to OAuth when verified. Higher engineering cost (two code paths) but lowest business risk.
