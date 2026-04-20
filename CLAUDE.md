# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MyMemory** — a personal/group memory capture SaaS. Users upload text, images, audio, video, documents, and URLs; the API processes them with AI (OpenAI) to extract summaries, keywords, categories, and structured fields. Content is organized into groups with sharing, subscriptions, and cost tracking.

Stack: React 18 + Vite (frontend) · Fastify 5 + Node.js 20 (backend) · MySQL 8.4 via TypeORM · OpenAI API (GPT-4o-mini, Whisper, Vision) · Tesseract.js OCR · FFmpeg.

## Development Commands

Prerequisites: Node.js 20+, Docker (for MySQL).

```bash
# Start MySQL
docker compose up -d

# Install all workspace dependencies (run from repo root)
npm install

# Run API (port 4000) + Web (port 5173) together
npm run dev

# Run individually
npm run dev --workspace=@mymemory/api
npm run dev --workspace=@mymemory/web

# Build everything
npm run build
```

Migrations apply automatically when the API starts. To manage manually:

```bash
npm run migration:show   --workspace=@mymemory/api   # status
npm run migration:run    --workspace=@mymemory/api   # apply pending
npm run migration:revert --workspace=@mymemory/api   # undo last
npm run migration:create --workspace=@mymemory/api -- apps/api/src/migrations/DescricaoDaMudanca
```

There are no test scripts. Type-check the web app with `npx tsc --noEmit` from `apps/web/`.

## Architecture

### Monorepo layout

```
apps/api/     — Fastify API (TypeScript)
apps/web/     — React SPA (Vite + TypeScript)
packages/shared/ — Shared TypeScript types (no runtime deps)
```

### API (`apps/api/src/`)

- **`server.ts`** — Entry point: Fastify init, runs migrations, registers all plugins and route handlers.
- **`config.ts`** — All env vars in one place (MySQL, S3, OpenAI, JWT, Resend, storage mode).
- **`data-source.ts`** — TypeORM DataSource. **TypeORM is used for migrations only** — all queries in services are raw SQL via `pool.execute()`.
- **`routes/`** — One file per domain: `auth`, `memos`, `memoContext`, `me`, `groups`, `groupInvites`, `admin*`. Each exports a Fastify plugin.
- **`services/`** — Business logic split by media type:
  - `memoService.ts` — orchestrates memo creation/editing for all media types
  - `imageMemoProcessService.ts` — OCR → confidence check → optional LLM vision re-extraction
  - `textMemoProcessService.ts` — keyword/summary/category/structured-field extraction
  - `audioMemoProcessService.ts`, `videoMemoProcessService.ts`, `documentMemoProcessService.ts` — media-specific pipelines
  - `memoSearchService.ts` — full-text search with synonym expansion
- **`lib/`** — Thin wrappers: `invokeLlm.ts` (unified LLM, supports custom "forge" API or OpenAI), `openaiChat.ts`, `openaiVision.ts`, `openaiTranscription.ts`, `imageOcr.ts`, `mail.ts`, `authTokens.ts`, `adminContext.ts`.
- **`migrations/`** — SQL migrations: `InitialSchema`, `SeedDev`, `CategoryCampoPatternsAndDadosEspecificos`.

### Frontend (`apps/web/src/`)

- **`App.tsx`** — React Router with ~25 routes.
- **`api.ts`** — HTTP client; all backend calls go through here.
- **`pages/`** — One `.tsx` + `.module.css` per page.
- **`vite.config.ts`** — Proxies `/api` → `http://localhost:4000`. Also injects `VITE_GIT_COMMIT_SHA`.

### Shared (`packages/shared/src/index.ts`)

Exports key types used by both API and Web: `UserIaUseLevel`, `MemoMediaTypeDb`, `TextMemoProcessResponse`, etc. Must be built (`npm run build --workspace=@mymemory/shared`) before API or Web can compile.

## Key Behaviours

**Auth**: JWT stored in a signed cookie (`mm_access`). In local dev, set `USE_DEV_FALLBACK=1` and pass `x-dev-user-id` header to bypass auth.

**AI processing levels** (per user preference):
- `semIA` — no AI, only stores raw content
- `basico` — keywords + category matching
- `completo` — full structured fields (`dadosEspecificosJson`)

**Image processing flow** (see `docs/processamento-imagens-fluxo.md`): Tesseract OCR → confidence threshold check → optionally re-extract via LLM vision → send to text or vision LLM pipeline.

**Storage**: `STORAGE_MODE=local|s3`. Local uploads go to `uploads/`; S3 uses `@aws-sdk/client-s3` (MinIO-compatible via `STORAGE_ENDPOINT`).

**Cost tracking**: Every LLM call accumulates `apiCost` (USD), stored per memo and aggregated in admin cost reports.

**Schema changes**: Create a migration, fill `up()`/`down()`, run locally, commit — it auto-applies on next API start/deploy.

## Naming & Language Conventions

- Variable/field names are in **Portuguese** (`dadosEspecificosJson`, `iaUseTexto`, `mediaMetadata`).
- File and function names are in **English**.
- Comments in source files are in Portuguese.
