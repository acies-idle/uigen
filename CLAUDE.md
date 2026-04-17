# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# First-time setup (install deps, generate Prisma client, run migrations)
npm run setup

# Development server (Turbopack)
npm run dev

# Build for production
npm run build

# Lint
npm lint

# Run all tests
npm test

# Run a single test file
npx vitest run src/components/chat/__tests__/ChatInterface.test.tsx

# Reset the database
npm run db:reset

# Run dev server in background (logs to logs.txt)
npm run dev:daemon
```

## Code Style

- Use comments sparingly. Only comment complex or non-obvious code.

## Architecture Overview

UIGen is an AI-powered React component generator. Users describe components in a chat interface; the AI generates files into a virtual filesystem; the preview renders them live in an iframe.

### AI / Chat Pipeline

- **`src/app/api/chat/route.ts`** — The single API endpoint. It receives the current chat messages plus the serialized virtual filesystem, streams a response using Vercel AI SDK (`streamText`), and on finish saves to the database if the user is authenticated.
- **Model**: `claude-haiku-4-5` via `@ai-sdk/anthropic`. When `ANTHROPIC_API_KEY` is absent, `MockLanguageModel` in `src/lib/provider.ts` is used instead — it generates static counter/card/form components without any API call.
- **Tools available to the AI**:
  - `str_replace_editor` (`src/lib/tools/str-replace.ts`) — create, str_replace, insert, view operations on the VFS
  - `file_manager` (`src/lib/tools/file-manager.ts`) — rename and delete on the VFS
- **System prompt**: `src/lib/prompts/generation.tsx` — instructs the AI to always start with `/App.jsx`, use `@/` import aliases for local files, and style with Tailwind.

### Virtual File System (VFS)

- **`src/lib/file-system.ts`** — `VirtualFileSystem` class. All generated files live in memory; nothing is written to disk. The VFS is serialized to JSON and passed with every chat request, then deserialized on the server to reconstruct state.
- Tool calls from the AI mutate the VFS client-side via `handleToolCall` in `FileSystemContext`.

### Preview Rendering

- **`src/lib/transform/jsx-transformer.ts`** — Client-side JSX transformation pipeline:
  1. `transformJSX`: Babel-transforms each `.jsx/.tsx` file using `@babel/standalone`
  2. `createImportMap`: Builds an ES module import map with blob URLs for local files; third-party packages are resolved to `https://esm.sh/<package>`; missing local imports get placeholder stub modules; `@/` aliases are mapped to root `/`
  3. `createPreviewHTML`: Generates a full HTML document with Tailwind CDN, the import map, and a `ReactDOM.createRoot` bootstrap script
- **`src/components/preview/PreviewFrame.tsx`** — Renders the generated HTML in a sandboxed `<iframe>` (srcdoc). Entry point is `/App.jsx` by default.

### React Contexts

- **`FileSystemContext`** (`src/lib/contexts/file-system-context.tsx`) — Wraps `VirtualFileSystem`, tracks `selectedFile`, triggers re-renders via `refreshTrigger`, and exposes `handleToolCall` which applies AI tool calls to the VFS.
- **`ChatContext`** (`src/lib/contexts/chat-context.tsx`) — Wraps Vercel AI SDK's `useChat`, wires `onToolCall` to `FileSystemContext.handleToolCall`, and serializes the VFS into each chat request body.

### Authentication

Custom JWT auth (no NextAuth). `src/lib/auth.ts` uses `jose` to sign/verify tokens stored in an `auth-token` HttpOnly cookie. Session lifetime is 7 days. Passwords are hashed with `bcrypt`. Anonymous users can work without accounts; `src/lib/anon-work-tracker.ts` persists their in-progress work to localStorage so it can be claimed after sign-up.

### Database

Prisma with SQLite (`prisma/dev.db`). Two models:
- `User` — email + hashed password
- `Project` — belongs to an optional `User`; stores `messages` (JSON string of chat history) and `data` (JSON string of the serialized VFS)

Always reference `prisma/schema.prisma` when working with database-related code to understand the current data structure.

### Routing

- `/` — anonymous users see the main chat UI; authenticated users are redirected to their most recent project (or a newly created one)
- `/[projectId]` — loads an existing project's messages and VFS data from the database
