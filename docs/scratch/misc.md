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

## Backfilling the TypeORM `migrations` table on dev

When dev has the schema (from `synchronize: true`) but the `migrations` table is empty, `./migrations.sh --dev --run` tries to apply ALL migrations from history and fails on the first one (`relation "traces" already exists`). Fix: tell TypeORM the historical migrations are already applied, then run only the new one.

```bash
docker exec -i daubert-db psql -U daubert -d daubert <<'SQL'
INSERT INTO migrations (timestamp, name) VALUES
  (1777332721367, 'InitialMigration1777332721367'),
  (1777342782714, 'AddUserIdToConversations1777342782714'),
  (1779829284023, 'MigrateChronologyToSchemaDriven1779829284023'),
  (1780157752247, 'RolesRename1780157752247'),
  (1780160966596, 'CreateCaseInvites1780160966596'),
  (1780329034494, 'AddUserOrgRole1780329034494'),
  (1780332497049, 'DropCaseLinks1780332497049'),
  (1780335059803, 'DropStartDateAddSummary1780335059803')
ON CONFLICT DO NOTHING;
SQL
```

Then `./migrations.sh --dev --run` will see only the latest migration as pending and apply just that one.

## Microsoft Entra app manifest — "Daubert AI (dev)" working version

Reference copy of the corrected Entra app manifest after applying the two fixes needed for personal Microsoft accounts:

1. `signInAudience`: `AzureADMultipleOrgs` → `AzureADandPersonalMicrosoftAccount`
2. `api.requestedAccessTokenVersion`: `null` → `2`

Both must be changed in a single manifest save — the Authentication blade refuses to flip account types while `requestedAccessTokenVersion` is still v1. Editing the manifest directly commits both changes atomically.

```json
{
    "id": "492b2e8a-40eb-446f-9a3f-5250650becf1",
    "deletedDateTime": null,
    "appId": "59cdc5ca-17e5-42f3-a88d-61a11b0cb3a2",
    "applicationTemplateId": null,
    "disabledByMicrosoftStatus": null,
    "createdByAppId": "18ed3507-a475-4ccb-b669-d66bc9f2a36e",
    "createdDateTime": "2026-06-02T02:05:22Z",
    "displayName": "Daubert AI (dev)",
    "description": null,
    "groupMembershipClaims": null,
    "identifierUris": [],
    "isDeviceOnlyAuthSupported": null,
    "isDisabled": null,
    "isFallbackPublicClient": null,
    "nativeAuthenticationApisEnabled": null,
    "notes": null,
    "publisherDomain": "samincite.onmicrosoft.com",
    "serviceManagementReference": null,
    "signInAudience": "AzureADandPersonalMicrosoftAccount",
    "tags": [],
    "tokenEncryptionKeyId": null,
    "samlMetadataUrl": null,
    "defaultRedirectUri": null,
    "certification": null,
    "optionalClaims": null,
    "requestSignatureVerification": null,
    "addIns": [],
    "api": {
        "acceptMappedClaims": null,
        "knownClientApplications": [],
        "requestedAccessTokenVersion": 2,
        "oauth2PermissionScopes": [],
        "preAuthorizedApplications": []
    },
    "appRoles": [],
    "info": {
        "logoUrl": "https://aadcdn.msftauthimages.net/dbd5a2dd-cxpcey2ev2wg86l3dlz5a6yfk7g0hcuerz7aavcuem8/appbranding/9uuhxyp4k6zrrtt-kpgjrd2ga2uweq8t7iqrdpwwjm4/1033/bannerlogo?ts=639159628569222501",
        "marketingUrl": null,
        "privacyStatementUrl": null,
        "supportUrl": null,
        "termsOfServiceUrl": null
    },
    "keyCredentials": [],
    "parentalControlSettings": {
        "countriesBlockedForMinors": [],
        "legalAgeGroupRule": "Allow"
    },
    "passwordCredentials": [
        {
            "customKeyIdentifier": null,
            "displayName": "Firebase Dev",
            "endDateTime": "2026-11-29T03:05:59.521Z",
            "hint": "opw",
            "keyId": "9fb7984b-8059-4690-9936-c6e0aa5bc55f",
            "secretText": null,
            "startDateTime": "2026-06-02T02:05:59.521Z"
        }
    ],
    "publicClient": {
        "redirectUris": []
    },
    "requiredResourceAccess": [
        {
            "resourceAppId": "00000003-0000-0000-c000-000000000000",
            "resourceAccess": [
                {
                    "id": "e1fe6dd8-ba31-4d61-89e7-88639da4683d",
                    "type": "Scope"
                }
            ]
        }
    ],
    "verifiedPublisher": {
        "displayName": null,
        "verifiedPublisherId": null,
        "addedDateTime": null
    },
    "web": {
        "homePageUrl": "https://app.dauberts.ai/",
        "logoutUrl": null,
        "redirectUris": [
            "https://daubert-dev.firebaseapp.com/__/auth/handler"
        ],
        "implicitGrantSettings": {
            "enableAccessTokenIssuance": false,
            "enableIdTokenIssuance": false
        },
        "redirectUriSettings": [
            {
                "uri": "https://daubert-dev.firebaseapp.com/__/auth/handler",
                "index": null
            }
        ]
    },
    "servicePrincipalLockConfiguration": {
        "isEnabled": true,
        "allProperties": true,
        "credentialsWithUsageVerify": true,
        "credentialsWithUsageSign": true,
        "identifierUris": false,
        "tokenEncryptionKeyId": true
    },
    "spa": {
        "redirectUris": []
    }
}
```

### Notes for the prod app registration

When creating the matching `Daubert AI` (prod) app, apply the same two values from the start:
- `signInAudience: "AzureADandPersonalMicrosoftAccount"` (pick "Multitenant + personal accounts" in the registration form)
- `requestedAccessTokenVersion: 2` (auto-set when you pick that account-types option from scratch — no manifest edit needed if you select it at registration time)

The only differences for prod vs dev:
- `displayName`: `"Daubert AI"`
- `web.redirectUris`: `https://<prod-firebase-project-id>.firebaseapp.com/__/auth/handler`
- New client secret in `passwordCredentials` (paste into the prod Firebase project, not dev)
- Consider a 24-month expiry on the prod secret to reduce rotation toil
