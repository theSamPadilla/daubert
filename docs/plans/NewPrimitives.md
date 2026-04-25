# New Primitives

Three new primitives are being added to the Daubert data model, plus a UI restructure to accommodate them.

## Overview

| Primitive | Scope | What It Is | Agent Access |
|-----------|-------|------------|--------------|
| **LabeledEntities** | Global | Canonical registry of known blockchain actors (exchanges, mixers, individuals) mapped to wallet addresses. Read-only within cases, admin-write. | Read |
| **Productions** | Per-investigation | Typed outputs — reports, charts, chronologies — derived from investigation data. | Create, Read, Update |
| **Data Room** | Per-case | Integration layer to external file storage (Google Drive, Dropbox). No files stored in Daubert. | Create, Read |

## UI Layout (Case View)

All three areas share a unified layout within a case:

```
┌──────────────┬──────────────────────────────┬──────────────┐
│              │                              │              │
│   Left Nav   │      Center Content          │   AI Chat    │
│              │      (contextual)            │  (persistent)│
│              │                              │              │
│  INVESTIGATIONS                             │              │
│  ├─ Inv A    │  [Graph Canvas]              │              │
│  ├─ Inv B    │  [or Data Room Browser]      │              │
│  └─ + New    │  [or Productions Viewer]     │              │
│              │                              │              │
│  DATA ROOM   │                              │              │
│  └─ Files    │                              │              │
│              │                              │              │
│  PRODUCTIONS │                              │              │
│  ├─ Report 1 │                              │              │
│  ├─ Chart 2  │                              │              │
│  └─ + New    │                              │              │
│              │                              │              │
└──────────────┴──────────────────────────────┴──────────────┘
```

Left nav switches center content. AI chat persists across all views.

**Routes:**
- `/cases/[caseId]/investigations` — graph workspace (existing)
- `/cases/[caseId]/data-room` — file browser
- `/cases/[caseId]/productions` — productions list
- `/cases/[caseId]/productions/[productionId]` — single production view
- `/entities` — global labeled entities browser (top-level, separate from cases)

## Implementation Plans

Each primitive has its own implementation plan:

1. [LabeledEntities](./LabeledEntities.md) — Phase 1
2. [Productions](./Productions.md) — Phase 2
3. [DataRoom](./DataRoom.md) — Phase 3

Phases are independently shippable. Phase order reflects dependencies (LabeledEntities has no deps, Productions requires the nav restructure, Data Room requires OAuth infrastructure).
