# To Do

- [ ] Agent optimizations before prod
- [ ] Blockchain API key hardening — backend proxy and/or per-case key issuance. See [`2026-04-27-blockchain-api-key-hardening.md`](./2026-04-27-blockchain-api-key-hardening.md). Not blocking; revisit when moving to paid keys, multi-user, or observed abuse.
- [ ] Give agent drive tool access. See [`2026-04-27-agent-drive-tools.md`](./2026-04-27-agent-drive-tools.md).
- [ ] Agent tool list optimization — contextual filtering, then CRUD grouping. See [`2026-04-27-agent-tool-optimization.md`](./2026-04-27-agent-tool-optimization.md). Not blocking; revisit when tool count exceeds ~15.
- [ ] Case role enforcement — `owner` vs `guest` is only enforced in the data-room module today; everywhere else any member has full write access (including AI chat → script tokens). See [`2026-04-27-case-role-enforcement.md`](./2026-04-27-case-role-enforcement.md). Blocks real multi-user collaboration.

## DONZO
- [x] Figure out a safe code exec environment on production