# ApplyFlow

An autonomous job-hunt and resume-tailoring copilot. Paste a job description (or capture it with the Chrome extension) and ApplyFlow retrieves your most relevant verified experience, then rewrites it for the role without inventing metrics or skills.

```
apps/
  api/        Node.js, Express, TypeScript, Prisma, BullMQ     (:4000)
  web/        React, Vite, Tailwind                            (:5173)
  extension/  Chrome Manifest V3 (TypeScript, esbuild)
docker-compose.yml   PostgreSQL 16 + pgvector, Redis 7
```

**How it works:** `POST /jobs/analyze` hashes the normalized JD (SHA-256) and returns a cached result if one exists. Otherwise it enqueues a BullMQ job. The worker embeds the JD, fetches the top 6 chunks by cosine similarity from pgvector, calls the LLM with a strict no-hallucination prompt, validates the output with Zod and a numeric-grounding check, saves it, and publishes the result over Redis Pub/Sub to the SSE stream.

## Prerequisites

- Node.js 20+
- Docker (Docker Desktop on Windows/macOS)
- An OpenAI-compatible LLM endpoint: OpenRouter, OpenAI, or local Ollama
- An embedding model that returns **1536 dimensions** (e.g. `text-embedding-3-small`)

## Setup

```bash
# 1. Install all workspaces
npm install

# 2. Start Postgres (pgvector) and Redis
docker compose up -d --wait

# 3. Configure the API
cp apps/api/.env.example apps/api/.env      # then edit LLM_API_KEY etc.

# 4. Create the schema
cd apps/api && npx prisma migrate dev
```

### Port conflicts

Host ports default to 5432 (Postgres) and 6379 (Redis). If another service already uses them (an old local Redis < 5.0 will break BullMQ), create a root `.env`:

```
POSTGRES_PORT=5434
REDIS_PORT=6380
```

and update `DATABASE_URL` / `REDIS_URL` in `apps/api/.env` to match. Check with `docker compose ps` and `curl localhost:4000/health`.

## Run

Use three terminals from the repo root:

```bash
npm run api:dev      # API on http://localhost:4000
npm run api:worker   # BullMQ worker (required, jobs won't process without it)
npm run dev -w apps/web   # Web app on http://localhost:5173
```

Then open http://localhost:5173, create a profile, add experience bullets under **My experience**, and analyze a job.

### LLM configuration (`apps/api/.env`)

| Provider | `LLM_BASE_URL` | `LLM_API_KEY` | `LLM_MODEL` |
|---|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | your key | e.g. `openai/gpt-4o-mini` |
| OpenAI | `https://api.openai.com/v1` | your key | e.g. `gpt-4o-mini` |
| Ollama | `http://localhost:11434/v1` | any non-empty string | e.g. `llama3.1` |

Embeddings use the same endpoint unless you set `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL`. OpenRouter may not serve embeddings on every plan; pointing the embedding vars at OpenAI or Ollama is a common setup. Models that don't return 1536 dimensions are rejected.

## Chrome extension

```bash
npm run build -w apps/extension     # or: npm run watch -w apps/extension
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** and choose `apps/extension/dist`.
3. Click the ApplyFlow icon, open **Settings**, enter the same email and name you used in the web app, and click **Save & connect**.
4. On a job posting, select the description text (optional), open the popup and click **Analyze & tailor**. The toolbar badge shows the match score when the job finishes.

Using the same email as the web app links both to one profile and one set of experience bullets.

## Tests

```bash
npm test -w apps/api            # unit tests (hashing, grounding guard, schemas)
npm run test:e2e -w apps/api    # smoke test; needs API + worker + infra running
```

## API

Full reference in [apps/api/API.md](apps/api/API.md). Summary:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/profile` | Create/update profile, returns the id used as `x-user-id` |
| POST | `/api/v1/profile/chunks` | Embed and store experience bullets |
| POST | `/api/v1/jobs/analyze` | Analyze a JD (200 cached / 202 queued) |
| GET | `/api/v1/jobs` | List your applications |
| GET | `/api/v1/jobs/:id` | Fetch one application |
| GET | `/api/v1/jobs/:id/stream` | SSE status updates |
| GET | `/health` | Postgres and Redis status |

## Production build

```bash
npm run api:build && npm run start -w apps/api && npm run start:worker -w apps/api
npm run build -w apps/web        # static files in apps/web/dist
npx prisma migrate deploy        # in apps/api, instead of migrate dev
```

Serve `apps/web/dist` from the same origin as the API (or set `CORS_ORIGIN`).

## Known limitations

- **Authentication is a placeholder.** The caller is identified by an `x-user-id` header (or `?userId=` for SSE). Replace `requireUser` in `apps/api/src/middleware/common.ts` with real auth before exposing this publicly.
- No endpoint yet to list or delete stored experience bullets.
- `tailoredPdfUrl` is reserved; PDF generation isn't implemented.
- No vector index; the top-6 query is an exact scan, which is fine at per-user scale. Add an HNSW index if chunk counts grow.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `P1010` / `P1001` from Prisma | Wrong port or another Postgres on 5432. See *Port conflicts*. |
| `503 QUEUE_UNAVAILABLE`, "Redis version needs to be >= 5.0.0" | An old Redis owns port 6379. Use `REDIS_PORT`. |
| Job stays `PROCESSING` | The worker isn't running (`npm run api:worker`). |
| `Embedding model returned N dimensions; expected 1536` | Use a 1536-dim embedding model. |
| Extension: "Cannot reach the API" | API not running, or API URL in Settings is wrong. |
