# CLAUDE.md

Guidance for Claude Code (and any contributor) working in this repository. This is a T3 Stack project scaffolded with `create-t3-app` 7.40.0: **Next.js App Router + TypeScript + tRPC + Prisma + Auth.js + Tailwind CSS**.

Everything below describes what is actually in the repo today. If you find a statement here that no longer matches the code, fix the doc in the same PR.

## Stack overview

| Piece           | What's installed                         | Notes                                                                    |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| Framework       | Next.js 15, App Router only (`src/app/`) | No `pages/` directory — do not create one                                |
| Runtime         | React 19                                 | Server Components by default                                             |
| API             | tRPC 11 + TanStack Query 5               | superjson transformer                                                    |
| Database        | Prisma 6 → PostgreSQL                    | `prisma/schema.prisma`                                                   |
| Auth            | Auth.js v5 (`next-auth@5.0.0-beta.25`)   | **Not** NextAuth v4 — no `getServerSession`, no `NEXTAUTH_SECRET`        |
| Styling         | Tailwind CSS v4                          | CSS-first config — **no `tailwind.config.ts` exists, do not create one** |
| UI primitives   | shadcn/ui on Base UI + `lucide-react`    | Config in `components.json`; generated into `src/components/ui/`         |
| Validation      | Zod 3                                    | Shared between tRPC inputs and client forms                              |
| Env             | `@t3-oss/env-nextjs`                     | Schema in `src/env.js`                                                   |
| Package manager | **pnpm 10.33.0**                         | Pinned via `packageManager`. Never run `npm`/`yarn` here                 |

**Package manager is pnpm.** `pnpm install`, `pnpm add <pkg>`, `pnpm dev`. Using npm or yarn produces a competing lockfile and breaks the pnpm-specific hoisting in `.npmrc`.

### TypeScript rules the compiler will enforce

- **Path alias:** `~/*` → `./src/*`. Import `~/server/db`, never `../../server/db`.
- **`verbatimModuleSyntax` is on** and ESLint enforces `consistent-type-imports` with `fixStyle: "inline-type-imports"`. Write `import { type Metadata } from "next"`, not a separate `import type` line.
- **`noUncheckedIndexedAccess` is on.** `arr[0]` is `T | undefined` — narrow it, don't assert it away.
- `strict` and `checkJs` stay on. Do not weaken `tsconfig.json`.

## Anti-spaghetti rules

These take precedence over any stylistic preference. Each exists because breaking it is how this codebase would rot.

1. **One data path.** Server Components call `api.*` from `~/trpc/server`. Client Components call `api.*` hooks from `~/trpc/react`. Do not add `fetch` calls to our own routes, SWR, axios, or Redux — the type safety comes from there being exactly one path.
2. **No new dependency without asking.** This includes a form library, a state library, and a test runner. Propose it and say why the existing tools can't do it.
3. **Abstraction requires a second caller.** No service layer, wrapper, factory, or barrel file for a single call site. A three-line tRPC resolver stays in the router. Extract when the second caller actually appears — not in anticipation of it.
4. **Extend, don't parallel.** A new procedure goes in the existing router in `src/server/api/routers/`. Create a new router only for a genuinely new entity, and register it in `src/server/api/root.ts`. Never build a second mechanism alongside one that already works.
5. **Match the file you're in.** Follow local style over personal preference. Don't reformat, rename, or "improve" code you weren't asked to touch.
6. **Delete what your change orphaned.** Remove imports and helpers your edit made unused — and only those. Pre-existing dead code gets mentioned, not deleted.

## Project structure

What exists today:

```
prisma/
  schema.prisma          # Post, User, Account, Session, VerificationToken
src/
  app/
    _components/
      post.tsx           # example client component
    api/
      auth/[...nextauth]/route.ts   # re-exports handlers from ~/server/auth
      trpc/[trpc]/route.ts          # tRPC fetch adapter
    layout.tsx           # root layout, fonts, TRPCReactProvider
    page.tsx             # home page
  server/
    api/
      routers/post.ts    # one router per entity
      root.ts            # appRouter + createCaller
      trpc.ts            # context, procedures, middleware
    auth/
      config.ts          # providers, adapter, callbacks, type augmentation
      index.ts           # exports auth, handlers, signIn, signOut
    db.ts                # Prisma client singleton
  components/
    ui/                  # shadcn primitives — GENERATED, see below
      button.tsx
  lib/
    utils.ts             # cn() — shadcn's class merger, the only thing here
  styles/
    globals.css          # Tailwind entrypoint + shadcn theme layers
  trpc/
    query-client.ts      # QueryClient factory
    react.tsx            # client-side api + TRPCReactProvider
    server.ts            # RSC-side api + HydrateClient
  env.js                 # validated env schema
components.json          # shadcn config — style, aliases, baseColor
```

### Where new code goes

Route-specific components live in `src/app/<route>/_components/`, mirroring `src/app/_components/post.tsx`. That is the default — most components should land there.

| Need                               | Home                 | Rule                                                   |
| ---------------------------------- | -------------------- | ------------------------------------------------------ |
| shadcn primitive                    | `src/components/ui/` | add via the CLI on first use — no second-caller test    |
| Your own component used by 2+ routes | `src/components/`  | move it here when the second route imports it          |
| Pure helper, no React/Next imports | `src/lib/`           | a second caller appears                                |
| Type shared by 2+ modules          | `src/types/`         | a second module imports it — **does not exist yet**    |

`src/lib/utils.ts` holds `cn()` and nothing else — it is shadcn's file, not a general dumping ground. A helper that isn't class-name merging gets its own module in `src/lib/`. Do not invent `utils/`, `helpers/`, `common/`, `shared/`, or `services/` — those names attract unrelated code and are how a tree turns to mush. If something fits none of the homes above, ask.

## Code conventions

### General

- Named exports, except Next.js special files (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`) which must default-export. Route handlers (`route.ts`) export named HTTP methods — `export { handler as GET, handler as POST }`.
- File names are `kebab-case.ts`/`.tsx`; identifiers inside are `PascalCase` for components, `camelCase` otherwise.
- No `any`. Use `unknown` and narrow. No `@ts-ignore` — fix the type, or use `@ts-expect-error` with a comment saying why.
- Type props explicitly, inline or via a `Props` type next to the component.
- TypeScript only. No new `.js`/`.jsx` files (`src/env.js` and the root config files are the existing exceptions).

### React / components

- Server Components by default. Add `"use client"` only for interactivity, browser APIs, or hooks that require it.
- Push `"use client"` to the interactive leaf — `src/app/_components/post.tsx` is the model. Never mark a whole page as client just to use one `useState`.
- Two data patterns, both shown in `src/app/page.tsx`:
  - Data the server needs to render: `const hello = await api.post.hello({ text: "..." })`.
  - Data a client child will read: `void api.post.getLatest.prefetch()` inside `<HydrateClient>`, then `useSuspenseQuery` in the child.
- Co-locate hooks and small helpers in the component file until something else needs them.
- No prop drilling past 2 levels — use composition (`children`) or a small context.

### tRPC

- One router per entity, registered in `src/server/api/root.ts`.
- Every procedure validates its input with Zod. No `z.any()`.
- Use `protectedProcedure` for anything requiring a session. It already throws `UNAUTHORIZED` and narrows `ctx.session.user` to non-null — do not re-check the session inside the resolver, and do not hand-roll auth on a `publicProcedure`.
- Access the database as `ctx.db`. Don't import `db` directly inside a procedure.
- Keep `select`/`include` narrow and explicit. Don't return a Prisma model with relations you didn't intend to expose.
- superjson handles `Date`, `Map`, `Set`, `BigInt`, and `undefined` across the wire — no manual serialization needed. Types it doesn't know (e.g. Prisma `Decimal`) need `SuperJSON.registerCustom`, so prefer converting them in the resolver.
- The random dev-only delay in `timingMiddleware` (`src/server/api/trpc.ts`) is **intentional** — it surfaces request waterfalls that would otherwise only show in production. Do not "fix" it.

### Prisma

- Import the shared client from `~/server/db`. Never construct a second `PrismaClient` — it breaks pooling under hot reload.
- Schema changes go through `pnpm db:generate` (which runs `prisma migrate dev`). No migrations are committed yet, so the first schema change will create the initial one.
- `pnpm db:migrate` (`prisma migrate deploy`) is for deploying. `pnpm db:push` is for local prototyping only — never against shared, staging, or production databases. `pnpm db:studio` opens the browser client.
- Name migrations descriptively: `add_post_published_at`, not `update`.
- `start-database.sh` spins up a local Postgres container if you need one.

### Auth

- Import `auth`, `handlers`, `signIn`, `signOut` from `~/server/auth`. `auth()` is already wrapped in React `cache()` — don't wrap it again or memoize it yourself.
- Adding a field to the session means two coordinated edits in `src/server/auth/config.ts`: the `declare module "next-auth"` augmentation and the `session` callback. Never cast the session to reach a field.
- Adding a provider goes in the `providers` array there, with its env vars added to the schema (see below). Some providers need extra columns on `Account` in `schema.prisma`.
- No hand-rolled JWT decoding or cookie reading anywhere.
- Never expose `AUTH_SECRET`, provider secrets, or `DATABASE_URL` to the client or to a `NEXT_PUBLIC_*` var.

### Styling

- Tailwind v4 utility classes in JSX. There is no `tailwind.config.ts` and creating one will not take effect — `components.json` sets `"config": ""` for exactly this reason.
- Style semantically: `bg-background`, `text-muted-foreground`, `border-border`. Don't hardcode a palette colour next to a themed one, or dark mode breaks.
- `src/styles/globals.css` has three zones. Edit the right one:
  - `:root` and `.dark` — the actual oklch colour values. **Change a colour here.**
  - `@theme inline` — maps those vars to Tailwind names (`--color-primary` → `bg-primary`). Only touch this when adding a genuinely new token.
  - `@theme` — non-shadcn tokens, currently just `--font-sans`.
- Merge classes with `cn()` from `~/lib/utils` whenever a component takes a `className` prop — it resolves Tailwind conflicts, plain template strings don't.
- Variants come from `cva`, following `src/components/ui/button.tsx`. Don't hand-roll a variant prop with ternaries.
- `prettier-plugin-tailwindcss` sorts class names on format — don't hand-order them or fight the output.
- No CSS Modules, styled-components, or inline `style=` except for genuinely dynamic values.

### shadcn/ui

- Add primitives with the CLI, never by hand: `pnpm dlx shadcn@latest add dialog`. It resolves dependencies and matches the configured style.
- **`src/components/ui/` is generated.** Re-running the CLI overwrites a file there. To change behaviour, wrap the primitive in your own component in `src/components/` — edit `ui/` only for a deliberate, permanent divergence.
- `components.json` is already configured: style `base-luma`, baseColor `neutral`, `rsc: true`, lucide icons, aliases on `~/`. Don't re-init or change aliases.
- Primitives are Base UI (`@base-ui/react`) under the hood, not Radix. Icons come from `lucide-react` — don't add a second icon set.
- Most primitives are client components. Import them into a Server Component freely, but keep `"use client"` at the leaf that needs state.
- The `shadcn` skill covers CLI flags, registries, and per-component docs. Consult it rather than duplicating it here.

### Environment variables

Adding a variable means editing **three** places, or the app fails at startup:

1. `src/env.js` — the `server` or `client` schema.
2. `src/env.js` — the `runtimeEnv` object (Next.js can't destructure `process.env` at the edge).
3. `.env.example` — committed, no real values.

Then import `env` from `~/env`; never read `process.env.X` in app code. The one sanctioned exception is `getBaseUrl()` in `src/trpc/react.tsx`, which reads `VERCEL_URL`/`PORT` because it runs client-side — leave it as is.

Client-exposed vars must be prefixed `NEXT_PUBLIC_` and declared in the `client` schema. Everything else stays server-only. Never commit `.env`.

## Quality gates

Run before considering a change done:

```bash
pnpm check          # next lint && tsc --noEmit — the primary gate
pnpm build          # catches RSC / client-boundary errors lint can't see
pnpm format:write   # prettier + tailwind class sorting
```

`pnpm lint`, `pnpm lint:fix`, and `pnpm typecheck` run the pieces individually if you need to iterate faster.

**There is no test runner in this project** — no Vitest, Jest, or Playwright. Do not add one or write test files as part of an unrelated change. If a change is risky enough to need tests, say so and propose adding a runner as its own piece of work.

Never weaken `tsconfig.json` strictness or disable an ESLint rule to make an error go away. Fix the underlying issue.

### If the gates fail with "Invalid environment variables"

`next.config.js` imports `src/env.js`, so **`check` and `build` validate the env schema before doing any work.** With an incomplete `.env` they fail before linting a single file. `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET` are currently blank locally, and `emptyStringAsUndefined` makes a blank value the same as a missing one — so this will happen.

The supported fix is the escape hatch already built into `src/env.js`:

```bash
SKIP_ENV_VALIDATION=1 pnpm check
SKIP_ENV_VALIDATION=1 pnpm build
```

`pnpm typecheck` alone doesn't load `next.config.js` and always runs.

Do **not** work around this by making schema fields `.optional()`, deleting `import "./src/env.js"` from `next.config.js`, or putting placeholder secrets in `.env`. Each one disables validation permanently for everyone to fix a local-setup problem.

Separately, `next lint` prints a deprecation warning (it's removed in Next.js 16). It still works — leave the scripts alone unless migrating the linter is the actual task.

## Commit / PR conventions

- Short imperative summary (`feat: add comment deletion procedure`), body explaining _why_ when it isn't obvious.
- Keep a schema change, its migration, and the code depending on it in one commit.
- Don't mix unrelated refactors into feature work.

## What not to do

- Don't run `npm` or `yarn` — this is a pnpm project.
- Don't create `tailwind.config.ts`; Tailwind v4 configures through `src/styles/globals.css`.
- Don't add a dependency without asking first (packages the shadcn CLI pulls in for a component you asked for are fine).
- Don't hand-write a component that `pnpm dlx shadcn@latest add` would generate, and don't edit `src/components/ui/` when wrapping it would do.
- Don't add a second data-fetching pattern alongside tRPC + React Query.
- Don't add a second styling system alongside Tailwind.
- Don't skip Zod validation on a tRPC input "just this once."
- Don't create a Pages Router file (`pages/`, `pages/api/*`) for anything that could be a tRPC procedure.
- Don't create `src/server/services/`, `src/utils/`, or similar catch-all layers.
- Don't reach for NextAuth v4 APIs (`getServerSession`, `NEXTAUTH_SECRET`) — this is Auth.js v5.
- Don't commit `.env` or any file containing real secrets.
