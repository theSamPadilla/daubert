# Agent Tool List Optimization

**Problem:** The agent's tool list is growing (14 tools + web_search after Drive tools land). Each tool definition is ~200-400 tokens in every API request. More tools also means more noise for the model to parse when deciding which tool to call.

**Prompt caching note:** The tools array is cached alongside the system prompt. Changes to the tools array between requests invalidate the cache. So optimizations should keep the tool set stable within a conversation.

---

## Phase 1: Contextual filtering (quick win)

Build the `AGENT_TOOLS` array dynamically per `streamChat` call based on case state.

| Condition | Tools to omit |
|-----------|--------------|
| No data room connection for this case | `list_drive_files`, `read_drive_file`, `write_drive_file`, `update_drive_file` |
| No active investigation | `list_script_runs` |

This requires one or two DB lookups before the agent loop — cheap since the case overview already fetches this data. Drops 4-5 tools from most requests.

The tool set is stable within a conversation (Drive doesn't get connected mid-chat, investigation doesn't change), so prompt caching stays warm across iterations.

### Implementation

In `AiService.streamChat()`, before the agent loop, check case state and build the tools array:

```typescript
const tools = [...AGENT_TOOLS]; // base set

// Omit drive tools if no connection
const drConn = await this.dataRoomRepo.findOneBy({ caseId });
if (!drConn || drConn.status === 'broken') {
  const driveToolNames = new Set([
    LIST_DRIVE_FILES_TOOL.name,
    READ_DRIVE_FILE_TOOL.name,
    WRITE_DRIVE_FILE_TOOL.name,
    UPDATE_DRIVE_FILE_TOOL.name,
  ]);
  tools = tools.filter(t => !driveToolNames.has((t as any).name));
}
```

Pass `tools` instead of `AGENT_TOOLS` to `llm.streamChat()`.

### Files touched

- `backend/src/modules/ai/ai.service.ts` — dynamic tool array before agent loop

---

## Phase 2: Group CRUD tools by domain

Collapse related tools into single tools with an `action` discriminator.

### Before (7 tools)

```
create_production, read_production, update_production
list_drive_files, read_drive_file, write_drive_file, update_drive_file
```

### After (2 tools)

```typescript
// production({ action: "create" | "read" | "update", ... })
// drive({ action: "list" | "read" | "write" | "update", ... })
```

Each tool's description spells out the available actions. The input schema uses a `action` enum property, with other properties conditionally relevant per action.

### Tradeoff

Union-type schemas are slightly less explicit than dedicated tools. Claude handles discriminated unions well, but the model occasionally picks the wrong action variant. The tool description needs to be clear about when to use each action.

### Estimated savings

| State | Before | After Phase 1 | After Phase 2 |
|-------|--------|---------------|---------------|
| Case with Drive | 14 tools | 14 tools | 9 tools |
| Case without Drive | 14 tools | 10 tools | 7 tools |

---

## What not to do

- **Dynamic tool discovery mid-conversation** (meta-tools that "activate" other tools). Adds round-trips, confuses the model, breaks prompt caching since the tools array changes between iterations within the same conversation.
- **Lazy loading via skills** — the Anthropic API requires tools declared upfront per request. Skills can teach the agent when to use a tool, but the tool must already be in the array.

---

## Recommendation

Start with Phase 1. It's a ~20-line change with zero behavioral impact — the agent simply doesn't see tools it can't use. Revisit Phase 2 if the tool list keeps growing past ~15.
