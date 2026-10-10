# Chat retention

AI chat content is kept for 30 days (`CHAT_RETENTION_DAYS` in `backend/src/modules/ai/retention/chat-retention.service.ts`). A daily job deletes anything older. This is a promise to customers, so change the number only together with the privacy terms that state it.

## What the purge deletes

| Data | Rule |
|------|------|
| `messages` | Whole turns whose prompt is older than 30 days. A turn is a user prompt plus every row after it up to the next prompt (assistant replies, tool calls, tool results). Cutting at prompts keeps the remaining history valid for the API: it still starts with a prompt and has no orphaned tool results. A turn that straddles the cutoff goes with its prompt. |
| `conversations` | Older than 30 days with no messages left, unless a run is queued or running in it (its first run creates the run row before the user message). Cascades to `agent_runs`. |
| `agent_run_events` | Older than 30 days. These are streamed copies of message text; each new run already clears the older events of its conversation, so this catches the last run of idle chats. |

The purge is idempotent: rerunning it deletes nothing new.

## What it keeps

- `conversations.title`: a few words the AI wrote from the first prompt. It survives as long as the conversation has any turn inside the window.
- `agent_runs`: status, timing and error metadata, no message content.
- `token_usage`: counts and cost only. Its `message_id` and `conversation_id` links go to NULL.
- Compaction summaries: when a long chat was compacted, the summary block inside a kept assistant message describes earlier turns, including ones the purge deleted.
- `case_activity_log`: one entry per action an AI agent took on a case (tool, inputs, outcome, short summary), for the life of the case. The purge never touches it, so the methodology stays reviewable after the chat is gone.
- Not covered by this policy: `script_runs` (AI-written scripts and their output) and `agent_audit_log.detail` (MCP tool-call arguments).
- Database backups: deleted rows remain in Neon's restore history until it rolls past them.

## How it runs

Cloud Scheduler calls `POST /internal/chat-retention/purge` once a day with an OIDC token signed as the `agent-runs-invoker` service account. The route uses the same guard as the Cloud Tasks run worker, so it accepts only that account and does not exist where `AGENT_RUNS_WORKER_URL` / `AGENT_RUNS_INVOKER_SA` are unset (dev). Each call logs one line:

```
chat_retention_purge days=30 messages=<n> conversations=<n> runEvents=<n>
```

## Setup (operator, once)

Deploy the backend first so the route exists, then create the job. Values match `docs/agent-runs.md`; re-check them if the service has moved.

```bash
PROJECT=daubertai-prod
REGION=us-central1
WORKER_URL=https://daubert-api-1054935977337.us-central1.run.app
INVOKER_SA=agent-runs-invoker@$PROJECT.iam.gserviceaccount.com

gcloud services enable cloudscheduler.googleapis.com --project=$PROJECT

gcloud scheduler jobs create http chat-retention-purge \
  --project=$PROJECT --location=$REGION \
  --schedule="0 7 * * *" --time-zone="Etc/UTC" \
  --http-method=POST --uri=$WORKER_URL/internal/chat-retention/purge \
  --oidc-service-account-email=$INVOKER_SA --oidc-token-audience=$WORKER_URL \
  --attempt-deadline=600s --max-retry-attempts=3
```

Creating the job needs `iam.serviceAccounts.actAs` on the invoker account (project owners have it).

Verify by triggering it once and finding the log line:

```bash
gcloud scheduler jobs run chat-retention-purge --location=$REGION --project=$PROJECT
gcloud logging read 'textPayload:"chat_retention_purge"' --project=$PROJECT --limit=5 --freshness=10m
```

The first run deletes the whole backlog older than 30 days.
