# BYOA — Bring Your Own Agent

**One-liner:** An OAuth-secured MCP server that lets a user's own AI agent (Claude Desktop / Claude Code) act inside Daubert — read case graphs, pull blockchain data, and write investigations/productions — bounded to one organization and to the user's existing per-case roles.

## Problem & why now

Daubert already has a capable in-app agent (server-side Claude with an isolated-vm script sandbox, blockchain skills, and production tools), but it's a walled garden. Investigators increasingly work inside their *own* agent environments — Claude Code / Desktop — alongside local case files, notes, other documents, and other MCP tools. Today they have to leave that environment to use Daubert.

BYOA inverts the relationship: instead of Daubert hosting an agent, Daubert becomes **a capability the investigator's existing agent wields**. The forensic graph, blockchain access, and production-writing show up as tools in the agent they already use.

**Why now:** MCP is the emerging standard for this, and a working, same-stack reference implementation (belong-mc — NestJS + TypeORM + Postgres + Firebase) exists to port from, which sharply lowers the build cost and de-risks the security-sensitive parts.

## Fit with strategy

- Daubert is multi-user, multi-org, and role-gated (`docs/ROLES.md`). BYOA must respect **every** existing boundary — it adds *reach*, never new privileges. An agent can do exactly what its owner can do, and no more.
- It maps cleanly onto the existing `AccessPrincipal` model: an MCP agent is a **new principal type carrying the user's identity**, exactly analogous to the existing script-token principal. No parallel permission system.
- **The bet:** technical investigators want Daubert's data and actions inside their own agent more than they want a more powerful in-app agent. The in-app agent stays best-in-class for heavy server-side traversal; BYOA wins on bring-your-own-context, interactive work.

## The idea (refined)

- A **stateless Streamable-HTTP MCP server** (`POST /mcp`) authenticated by a **full OAuth 2.0 Authorization Server** (Dynamic Client Registration + PKCE S256 + consent), ported from belong-mc.
- The token represents **`(user, org)`**. Per call, the user's role for the specific case is enforced via the existing `CaseAccessService`. The session itself carries no role.
- The tool surface = **in-app agent parity MINUS the script sandbox**: navigate, read, blockchain (server-side keys), and structured writes.
- Blockchain egress is exposed as **tools that run server-side with Daubert's keys**; arbitrary code execution stays in the user's own agent runtime. The agent fetches → transforms locally → imports. Exposing the sandbox over MCP is deferrable and purely additive.

### Tool surface (V1)

| Group | Tools | Min case role |
|---|---|---|
| **Navigate** (new — no implicit "current case") | `list_cases`, `get_case`, `list_investigations` | viewer |
| **Read** | `get_case_data` (graph), `read_production`, `query_labeled_entities`, `get_skill` | viewer |
| **Blockchain** (server-side Daubert keys) | `blockchain_fetch_history`, `blockchain_get_transaction`, `blockchain_get_address_info` | viewer |
| **Write** | `create_investigation`, `import_transactions`, `create_production`, `update_production` | editor |

`get_skill` exposes the existing `blockchain-apis` and `graph-mutations` skills so an external agent self-onboards on Daubert's import format and API patterns, the same way the in-app agent does.

## Product decisions (locked)

1. **Capability ceiling:** parity-minus-sandbox. No `execute_script` over MCP in V1. Additive later *only if* deep multi-hop traversals prove painful as tool round-trips.
2. **Blockchain access:** server-side MCP tools using Daubert's own API keys; agent does any custom transformation in its own runtime. A **per-session rate limit is required** (BYOA drives Daubert's egress unattended at machine speed — the one cost that does *not* shift to the user's agent subscription).
3. **Auth:** full OAuth 2.0 AS (one-click "Connect" in the client), ported from belong-mc. **No MFA layer** (Daubert has none). Consent page lives in the Next.js frontend.
4. **Scope:** token bound to **`(user, one org)`**. Per-case role resolved at call time via `CaseAccessService`. No role stored on the session. Every tool call additionally checks `case.organizationId === session.organizationId`.
5. **Eligibility:** org **admins and members** only. **Guests are excluded**; case-only collaborators (no `organization_members` row) are excluded by definition. Eligibility is **re-validated on every MCP call**, not just at consent — if a user is downgraded to guest or removed from the bound org after connecting, their token stops working immediately (mirrors belong-mc re-checking on every refresh).
6. **Org selection at consent:** the consent screen lets the user pick which eligible org the agent acts in (auto-selected when they belong to only one). A multi-org user connects once per org; **no token ever spans orgs.**
7. **No platform-admin tools over MCP:** even a superadmin's agent gets only the investigation toolset, scoped to their case memberships in the bound org.
8. **Audit:** every agent-driven mutation is logged with `(session, user, org)` attribution. Provenance is first-class — this is an evidence tool, and "which mutations came from an external agent vs. the UI vs. the in-app agent" must be answerable.

## Security acceptance criteria (non-negotiable)

The properties most likely to break during the port/build, each with a catastrophic failure mode for a multi-tenant evidence tool. The plan treats these as acceptance criteria, not nice-to-haves:

1. **Cross-org isolation in one chokepoint.** The `case.organizationId === session.organizationId` check + per-case role resolution live in a single MCP-principal guard, applied to every tool — never re-implemented per tool. Tool handlers re-check as defense-in-depth. One unguarded tool = a cross-org case-data leak.
2. **Per-call eligibility + role resolution.** Both org membership (≥ member) and case role are resolved live on every call from the DB, never trusted from the token. Revocation and downgrades take effect immediately.
3. **OAuth port fidelity.** Preserve every security property from belong-mc: PKCE S256-only, tokens/codes stored as SHA-256 hashes (raw never persisted), refresh rotation with reuse-detection chain-revoke, exact-match `redirect_uri` allowlist, single-use codes via atomic conditional UPDATE, state-bag HMAC + replay protection.
4. **Provenance in the audit log.** Agent-driven mutations are tagged with the originating OAuth session — distinguishable from in-app and in-app-agent writes. `import_transactions` and production writes must record source = BYOA.

## Scope

**In (MVP):**
- OAuth 2.0 AS ported from belong-mc: discovery docs (RFC 8414/9728), DCR (`/oauth/register`), authorize + consent flow (Firebase-verified, org-picker), token endpoint (PKCE S256 exchange + refresh rotation), revocation, token hashing, `oauth_client` / `oauth_session` (+ `organization_id`) / `oauth_code` entities and migrations.
- MCP server (`POST /mcp`, stateless Streamable HTTP) + the V1 tool surface above.
- Org-scoped, role-resolved authorization reusing `CaseAccessService`; eligibility gate (member+).
- IP throttler (pre-auth) + per-session rate limit (post-auth).
- Audit logging of agent-driven writes.
- Skill prompts: `blockchain-apis`, `graph-mutations`, and a new `daubert-overview`.
- Frontend: consent page + a "Connected agents" management surface (list/revoke per org).

**Out / later:**
- `execute_script` (sandbox) over MCP.
- User-supplied blockchain API keys (to lift the egress ceiling for heavy users).
- Org-admin kill-switch / per-member gating (org-level enable toggle) — deferred unless a compliance-sensitive customer needs it.
- Fine-grained node/edge mutation tools (beyond `import_transactions`).
- Non-Claude MCP client polish.
- Automation / headless scheduled agents.

## Risks & open questions

- **Weakest assumption:** that the V1 audience is technical investigators who value agent-side investigation. If real demand is non-technical users, onboarding and tool surface need a rethink — though OAuth one-click connect already hedges the UX side.
- **Data egress posture:** case data flows into the user's external AI runtime. Eligibility (members only) and org-scoping bound it, but a compliance-sensitive org may want a kill-switch. Deferred, flagged.
- **Multi-hop efficiency:** deep traversals are chattier over MCP than in the in-app sandbox. Accepted — the token cost is the user's agent's, not Daubert's. The in-app agent remains the tool for heavy server-side digging.
- **Engineering details to port from belong-mc defaults:** tool-result size cap/truncation (belong-mc caps at 8KB), refresh TTLs, throttle numbers, surface-label enrichment. Decide during planning.
