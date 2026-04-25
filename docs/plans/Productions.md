# Productions

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/database/entities/production.entity.ts` | Create | Entity: typed outputs (report, chart, chronology) per investigation |
| 2 | `backend/src/modules/productions/productions.module.ts` | Create | NestJS module registration |
| 3 | `backend/src/modules/productions/productions.controller.ts` | Create | REST endpoints: CRUD for productions |
| 4 | `backend/src/modules/productions/productions.service.ts` | Create | Business logic, validation by type |
| 5 | `backend/src/modules/productions/dto/` | Create | Create/Update DTOs with type-specific validation |
| 6 | `frontend/src/app/cases/[caseId]/` layout | Modify | Restructure left nav into three sections: Investigations, Data Room, Productions |
| 7 | `frontend/src/app/cases/[caseId]/productions/page.tsx` | Create | Productions list view — filterable by type and investigation |
| 8 | `frontend/src/app/cases/[caseId]/productions/[productionId]/page.tsx` | Create | Single production viewer/editor, renders by type |
| 9 | `backend/src/modules/ai/tools/tool-definitions.ts` | Modify | Add `create_production`, `read_production`, `update_production` tools |
| 10 | `backend/src/prompts/investigator/` | Modify | Update system prompt with production creation instructions |

---

## Data Model

```
Production (per-investigation)
├── id                UUID, PK, auto-generated
├── createdAt         timestamp
├── updatedAt         timestamp
├── name              string              — "Flow of Funds Summary"
├── type              varchar             — "report" | "chart" | "chronology"
├── data              JSONB               — structure varies by type (see below)
└── investigationId   FK → Investigation  — cascade delete
```

Relation: `Investigation.productions` (one-to-many).

### Data Structures by Type

**Report** `{ sections: [{ title, body, citations[] }], metadata }`
- `sections[]` — ordered list of report sections
- `citations[]` — references to traces, edges, or external sources
- `metadata` — author, date, case reference, etc.

**Chart** `{ chartType, datasets[], labels[], options }`
- `chartType` — "bar" | "pie" | "line" | "sankey" | "flow"
- `datasets[]` — Chart.js-compatible data series
- `options` — chart configuration (axes, legend, colors)

**Chronology** `{ events: [{ date, title, description, sourceTraceId?, sourceEdgeId? }] }`
- `events[]` — date-ordered entries
- Each event can reference a source trace or edge for traceability

## Backend

**Endpoints:**
- `POST /investigations/:investigationId/productions` — create
- `GET /investigations/:investigationId/productions` — list for investigation, optional `?type=` filter
- `GET /productions/:id` — get by ID
- `PATCH /productions/:id` — update name, data, or type
- `DELETE /productions/:id` — delete

## Frontend

**Left nav restructure:**
- Three collapsible sections in the case left nav: Investigations, Data Room, Productions
- Productions section lists all productions across investigations in the case
- Clicking a production switches center content to the production viewer

**Productions list (`/cases/[caseId]/productions`):**
- All productions for the case, grouped or filterable by type and investigation
- Create button with type selector

**Production viewer (`/cases/[caseId]/productions/[productionId]`):**
- Renders based on `type`:
  - `report` — sectioned text viewer/editor
  - `chart` — Chart.js renderer
  - `chronology` — timeline/table view
- "Upload to Data Room" button for manual export to connected storage

## Agent Tools

**`create_production`**
- Input: `{ investigationId, name, type, data }`
- Agent generates productions from trace data (e.g., "create a chronology from Trace A")

**`read_production`**
- Input: `{ productionId }` or `{ investigationId }` to list all
- Output: production data

**`update_production`**
- Input: `{ productionId, name?, type?, data? }`
- Agent can iteratively refine a production
