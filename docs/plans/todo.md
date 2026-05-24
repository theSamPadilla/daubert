# To Do

------------
In Session
------------

- [ ] Improve optics of the final output
- [ ] Try fixing Drive picker again


------------------------
- [ ] Agent optimizations before prod
- [ ] Blockchain API key hardening — backend proxy and/or per-case key issuance. See [`2026-04-27-blockchain-api-key-hardening.md`](./2026-04-27-blockchain-api-key-hardening.md). Not blocking; revisit when moving to paid keys, multi-user, or observed abuse.
- [ ] Give agent drive tool access. See [`2026-04-27-agent-drive-tools.md`](./2026-04-27-agent-drive-tools.md).
- [ ] Agent tool list optimization — contextual filtering, then CRUD grouping. See [`2026-04-27-agent-tool-optimization.md`](./2026-04-27-agent-tool-optimization.md). Not blocking; revisit when tool count exceeds ~15.
- [ ] Case role enforcement — `owner` vs `guest` is only enforced in the data-room module today; everywhere else any member has full write access (including AI chat → script tokens). See [`2026-04-27-case-role-enforcement.md`](./2026-04-27-case-role-enforcement.md). Blocks real multi-user collaboration.
- [ ] Advanced Search — rate limit on `POST /traces/:id/search-between`. **Flagged as architectural**: the real shared resource is the Etherscan API budget across the whole backend, not per-case. Decide between per-case in-memory token bucket (band-aid) vs. centralized provider-side queue (deep fix) before coding.
- [ ] Advanced Search — component tests (RTL) for `SearchResults` (select-all + indeterminate checkbox state) and `WalletGroupPicker` (25-wallet cap enforcement). Frontend has zero tests for these components today. Tighten the test list before starting.
- [ ] Advanced Search — surface `fetchedSide` in the results header (e.g., "Searched from Side A (8 wallets fetched)"). Minor UX polish; revisit only if an investigator asks.

## DONZO
- [x] Remove the in-edit mode color selection from the wallet as it does not do anything anymore.
- [x] Improve the UI indicator on chart v. chron v. report.
- [x] Add "Create Exhibit" Feature
- [x] Make the header of the data room same style and color as the rest
- [x] Component celanup
- [x] Bringing back chooser
- [x] Figure out a safe code exec environment on production
- [x] Remove the thick transaction responsiveness
