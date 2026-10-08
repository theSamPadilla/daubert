# Agent Runs

Each AI chat turn runs as a durable server-side "run". The browser's HTTP request only starts the run and follows its events. Closing the tab, losing the connection or deploying the backend does not kill a response.

## Why

On 2026-10-07 chat turns of 5 to 16 minutes were failing with a 502, because Cloud Run cuts a request at 300 s. The agent loop kept running headless on throttled CPU, and the user's retry started a second loop on the same conversation, which interleaved history writes and billed tokens twice. Runs decouple the turn from the request so neither can happen.

## Lifecycle

```
queued -> running -> succeeded | failed | cancelled | timed_out | interrupted
```

| Transition | Done by | Notes |
|------------|---------|-------|
| (new) -> `queued` | Launcher (`createQueued`) | Inserts the run row. Fails with 409 if the conversation already has an active run. |
| `queued` -> `running` | `claim` | A conditional UPDATE. Only the first delivery wins, so Cloud Tasks retries are safe. |
| `queued` -> `failed` | Launcher (`failQueued`) | Dispatch failed. The user message is deleted and the request returns 503. |
| `queued` -> `cancelled` | `requestCancel` | Stop before the run started. Its task becomes a no-op. |
| `running` -> `succeeded`, `failed`, `cancelled`, `timed_out` | Executor (`finish`) | `cancelled` after a Stop seen on a heartbeat. `timed_out` at the 25 minute cap. |
| `queued` or `running` -> `interrupted` | `sweepStale` | The executor died or the task was never delivered. |

Every transition is a conditional UPDATE on the current status, so the executor, a retry, the sweeper and a cancel cannot both win.

## Flow

1. `POST /conversations/:id/runs` reaches the launcher. It inserts a `queued` run, persists the user message, then dispatches.
2. The dispatcher is Cloud Tasks in prod and in-process in dev. Cloud Tasks calls the worker URL with an OIDC token.
3. `POST /internal/agent-runs/:id/execute` checks the OIDC token (guard), then hands off to the executor. The turn runs inside this request, which Cloud Run lets finish through deploys and scale-in.
4. The executor calls `claim`, heartbeats, runs the agent loop and writes events to `agent_run_events` through the event writer (text deltas are coalesced into 250 ms windows). It ends with `finish`.
5. `GET /conversations/:id/runs/:runId/events?after=<seq>` streams the events as SSE. It polls Postgres every 300 ms and ends the subscription after 240 s. The client reconnects from its last `seq`.
6. `POST /conversations/:id/runs/:runId/cancel` sets the cancel flag. The executor sees it on its next heartbeat, aborts the model stream and persists the partial text plus "(Stopped by user.)".
7. `GET /conversations/:id/runs/latest` lets a reopened conversation reattach to the active run or show a notice for a failed or interrupted one.

Postgres is the event bus: there is no Redis. `agent_runs` holds status, the heartbeat lease and the cancel flag. `agent_run_events` is an append-only log with a per-run `seq`.

## Guarantees and limits

| Rule | Value |
|------|-------|
| Active runs per conversation | 1, enforced by a partial unique index. A second send gets "A response is already in progress in this conversation." (409). |
| Claim | Once. A redelivered task finds the run no longer `queued` and does nothing. |
| Time cap for one response | 25 minutes, then `timed_out` with "Send another message to continue." |
| Cloud Tasks dispatch deadline | 1800 s (30 minutes), above the cap. |
| Heartbeat | Every 3 s. |
| Stale running run | No heartbeat for 60 s. |
| Stale queued run | Not claimed within 300 s. |
| Event poll / subscription rotation | 300 ms / 240 s |
| Cloud Tasks retries | 5 attempts, 2 to 30 s backoff. |
| Event retention | Events of earlier runs in a conversation are deleted when the next run starts. Messages stay as the durable record. |

**Lazy sweep.** There is no cron. `sweepStale` runs when a conversation is opened, when a new run starts and while a subscriber is waiting. It marks dead runs `interrupted`, appends `error` and `done` events, and repairs a dangling `user(tool_result)` tail, which would otherwise block every later message.

**Abort.** Abort interrupts the model stream immediately. A tool batch that has already started finishes first, so tool side effects are never half-done.

## Config

| Variable | Meaning |
|----------|---------|
| `AGENT_RUNS_QUEUE` | Full queue path: `projects/<project>/locations/<region>/queues/agent-runs` |
| `AGENT_RUNS_WORKER_URL` | The Cloud Run `run.app` URL (not `api.dauberts.ai`, so no proxy sits between Cloud Tasks and the service) |
| `AGENT_RUNS_INVOKER_SA` | The `agent-runs-invoker` service account that signs OIDC tokens. The guard checks the token against it. |

All three are required when `NODE_ENV=production`. If they are unset in other environments, runs execute in-process. The Cloud Run request timeout must be 1800 s.

## Rollout and ops

### Rollout runbook (operator, in order)

Run these before pushing the backend change to `main`: Cloud Build auto-deploys, and production boot fails without the env vars. The project, service, runtime service account and URL below were read from `gcloud run services describe daubert-api` on 2026-10-07. Re-check them if the service has moved.

```bash
PROJECT=daubertai-prod
REGION=us-central1
RUNTIME_SA=1054935977337-compute@developer.gserviceaccount.com
INVOKER_SA=agent-runs-invoker@$PROJECT.iam.gserviceaccount.com

# 1. Cloud Tasks queue
gcloud services enable cloudtasks.googleapis.com --project=$PROJECT
gcloud tasks queues create agent-runs --location=$REGION --project=$PROJECT \
  --max-attempts=5 --min-backoff=2s --max-backoff=30s

# 2. Invoker identity: Cloud Tasks signs OIDC tokens as this account
gcloud iam service-accounts create agent-runs-invoker \
  --display-name="Cloud Tasks invoker for agent runs" --project=$PROJECT

# 3. The API (runtime SA) may enqueue and may mint tokens as the invoker
gcloud tasks queues add-iam-policy-binding agent-runs --location=$REGION --project=$PROJECT \
  --member=serviceAccount:$RUNTIME_SA --role=roles/cloudtasks.enqueuer
gcloud iam service-accounts add-iam-policy-binding $INVOKER_SA --project=$PROJECT \
  --member=serviceAccount:$RUNTIME_SA --role=roles/iam.serviceAccountUser

# 4. Service config: 30-min timeout for worker requests, plus the run env vars
gcloud run services update daubert-api --region=$REGION --project=$PROJECT --timeout=1800 \
  --update-env-vars=AGENT_RUNS_QUEUE=projects/$PROJECT/locations/$REGION/queues/agent-runs,AGENT_RUNS_WORKER_URL=https://daubert-api-1054935977337.us-central1.run.app,AGENT_RUNS_INVOKER_SA=$INVOKER_SA
```

5. Apply the migration: `./migrations.sh --prod --run`.
6. **Push 1: backend only.** Commit the backend, contracts and docs changes, push, and wait for Cloud Build to deploy. Then verify from the current (old) frontend: send a message. It goes through the legacy bridge and should work. Check the logs for `run_start` and `run_end`.
7. **Push 2: frontend.** Commit `frontend/` and push, and Vercel deploys. Verify:
   - A turn longer than 5 minutes completes with no 502.
   - Closing the tab mid-turn and reopening it reattaches.
   - Stop works.
8. If Cloud Run invoker IAM is ever enabled on the service, also grant `roles/run.invoker` to `$INVOKER_SA`.

**Follow-ups:**
- Delete the legacy `/chat` bridge once it has had no traffic for 7 days.
- Move the Cloud Run secrets from plain env vars to Secret Manager.

### Finding a run in the logs

The `run_*` lines carry `runId`; filter Cloud Run logs on it (for example `textPayload:"runId=<id>"`). `turn_model_call` carries `conversationId` instead, because AiService does not know the run id. Correlate it through the `conversationId` that `run_start` logs:

| Log line | Meaning |
|----------|---------|
| `run_start` | The executor claimed the run and began. |
| `turn_model_call` | (keyed by `conversationId`) One model call in the agent loop, with iteration, stop reason and `durationMs`. Use it to see where a slow turn spent its time. |
| `run_end` | The run reached a terminal status, with that status. |
| `run_failed` | The executor hit an error. The message carries an `errorId` that matches the error shown to the user. |
| `run_interrupted` | `sweepStale` found a dead run and marked it `interrupted`. |

A run stuck in `queued` with no `run_start` means Cloud Tasks never delivered it: check the queue and the OIDC guard. A `run_interrupted` with no `run_end` means the executor died mid-turn (instance killed or request cut).

## Legacy endpoint

`POST /conversations/:id/chat` is now a thin bridge onto runs, so tabs opened before the frontend deploy keep working. It is marked deprecated in the contract. Delete it, along with its contract entry, once request logs show no calls for 7 days.
