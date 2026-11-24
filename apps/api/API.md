# ApplyFlow API (v1)

Base URL: `http://localhost:4000` · JSON in/out · all `/api/v1/jobs/*` and `/api/v1/profile/chunks` require a caller identity.

## Authentication (Phase 1)

Send the profile id as `x-user-id: <uuid>`. Browsers' `EventSource` cannot set headers, so the SSE endpoint also accepts `?userId=<uuid>`. Missing, malformed or unknown ids return `401`.

## Errors

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request", "details": { } } }
```

| Status | code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` / `INVALID_JSON` | Body or params failed validation |
| 401 | `UNAUTHENTICATED` | Missing/unknown `x-user-id` |
| 404 | `NOT_FOUND` | Unknown route, or application not owned by caller |
| 502 | `EMBEDDING_*` | Embedding provider returned bad data / wrong dimensions |
| 503 | `QUEUE_UNAVAILABLE` | Could not enqueue; application marked `FAILED`, safe to retry |
| 500 | `INTERNAL` / `DATABASE_ERROR` | Unexpected failure |

---

## `GET /health`
`200 {"status":"ok","postgres":true,"redis":true}` or `503` with `status: "degraded"`.

## `POST /api/v1/profile`
Create or update a profile by email. Returns the id to use as `x-user-id`.

Body: `{ "email": string, "fullName": string, "headline"?: string, "baseResume"?: object }`
`200 { "profile": { id, email, fullName, headline, baseResume, createdAt, updatedAt } }`

## `POST /api/v1/profile/chunks`  🔒
Embeds and stores experience bullets (1–100 per request).

Body:
```json
{ "chunks": [{ "category": "work", "title": "SWE at X", "bulletText": "Reduced latency by 40% ...", "tags": ["redis"] }] }
```
`201 { "created": 2, "ids": ["..."], "embeddingTokens": 20 }`

`bulletText` must be 10–2000 chars. The embedding model must return 1536 dimensions.

## `POST /api/v1/jobs/analyze`  🔒
Body: `{ "sourceUrl": string(url), "rawJdText": string(50–50000 chars) }`

The JD is normalized (Unicode NFKC, lowercased, whitespace collapsed) and SHA-256 hashed. Behavior per `(userId, jdHash)`:

| Existing state | Response |
|---|---|
| `COMPLETED` | `200 { cached: true, application }` |
| `PROCESSING` | `202 { cached: false, application }` (no duplicate job) |
| `FAILED` | reset to `PROCESSING`, re-enqueued, `202 { cached: false, application }` |
| none | create `PROCESSING`, enqueue `analyze-job`, `202 { cached: false, application }` |

## `GET /api/v1/jobs/:id`  🔒
`200 { application }` · `404` if not found or not yours.

## `GET /api/v1/jobs/:id/stream`  🔒
Server-Sent Events (`text/event-stream`). On connect it sends the current state, then live updates from Redis Pub/Sub, and closes after a terminal event. Heartbeat comment every 15 s.

```
event: status
data: {"applicationId":"…","status":"PROCESSING","stage":"retrieval"}

event: status
data: {"applicationId":"…","status":"COMPLETED","application":{…}}
```
`stage` is one of `embedding | retrieval | generation | saving`. `FAILED` events include `error`.

```js
const es = new EventSource(`/api/v1/jobs/${id}/stream?userId=${userId}`);
es.addEventListener('status', (e) => { const evt = JSON.parse(e.data); if (evt.status !== 'PROCESSING') es.close(); });
```

## Application object

| Field | Type |
|---|---|
| id, userId, jdHash | string |
| companyName, roleTitle | string \| null |
| sourceUrl, rawJdText | string |
| status | `PROCESSING` \| `COMPLETED` \| `FAILED` |
| matchScore | int 0–100 \| null |
| missingKeywords | string[] |
| tailoredBullets | `[{ sourceChunkId, originalBullet, tailoredBullet, rationale }]` \| null |
| outreachDraft | string \| null |
| tailoredPdfUrl | string \| null (reserved) |
| tokensUsed, processingTimeMs | int \| null |
| errorMessage | string \| null |
| createdAt, updatedAt | ISO datetime |

## Grounding guarantees
The worker retrieves the top 6 chunks by cosine similarity, and the LLM may only rephrase those. Output is Zod-validated; each bullet must cite a retrieved chunk, `originalBullet` is overwritten with the stored text, and any number in a tailored bullet or the outreach draft that isn't in the source bullets causes a rejection and retry (max 3 attempts).

## Testing
```bash
npm test          # unit tests (hashing, grounding guard, schema)
npm run test:e2e  # smoke test against a running API + worker
```

---

## Resumes  🔒

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/resumes` | `{ resumes: [{ id, targetRole, fileName, createdAt, bulletCount }] }` |
| POST | `/api/v1/resumes/parse` | multipart: `targetRole` + `file` (PDF/DOCX/TXT, ≤5 MB) **or** `text` (≥200 chars). Returns `{ draft }` for review; **saves nothing**. Bullets that can't be verified against the resume text (invented numbers/wording) are dropped, with a warning. |
| POST | `/api/v1/resumes` | Save a reviewed draft `{ targetRole, fileName?, rawText, bullets[], answers[] }` → `201 { resume, created, skipped, answersSaved }`. Max 10 resumes (`409`). |
| PATCH | `/api/v1/resumes/:id` | `{ targetRole }` |
| DELETE | `/api/v1/resumes/:id` | Deletes the resume and its bullets; past applications keep their results. `204` |

`POST /api/v1/jobs/analyze` accepts an optional `resumeId`. Omit it to auto-select. A completed job is returned from cache unless a *different* `resumeId` is requested, which re-runs it. Applications include `resumeId` and `resumeAutoSelected`.

## Autofill answers  🔒

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/profile/answers` | `{ answers: [{ id, key, label, value }] }` |
| PUT | `/api/v1/profile/answers` | `{ answers: [{ key, label, value }] }` upsert by key (≤200). Sensitive keys (password, otp, cvv, card, ssn, aadhaar, token…) are refused: `{ saved, refused }` |
| DELETE | `/api/v1/profile/answers/:id` | `204` |

Other limits: request bodies over 1 MB return `413`; NUL characters are stripped from all text input; saving the same bullet twice within one resume is skipped (`skipped` in the response).
