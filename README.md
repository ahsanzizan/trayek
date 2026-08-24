# Create T3 App

This is a [T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app`.

## What's next? How do I make an app with this?

We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional things later when they become necessary.

If you are not familiar with the different technologies used in this project, please refer to the respective docs. If you still are in the wind, please join our [Discord](https://t3.gg/discord) and ask for help.

- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Prisma](https://prisma.io)
- [Drizzle](https://orm.drizzle.team)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

## Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

## How do I deploy this?

Follow our deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify) and [Docker](https://create.t3.gg/en/deployment/docker) for more information.

## Background jobs

Extraction, fraud checks, and reconciliation run asynchronously on [pg-boss](https://github.com/timgit/pg-boss), which uses the same Postgres as the app. That keeps job payloads inside the residency boundary and avoids a second vendor DPA.

**The worker is a separate process from the web app.** Run both in development:

```bash
pnpm dev      # web
pnpm worker   # queue worker
```

In production they are separate deployments. The web process only enqueues (`jobQueue.send`); nothing in `src/app` or a tRPC resolver runs a job inline.

### Adding a job type

1. Register the type and its handler in `src/server/jobs/registry.ts`. Registration requires a retry policy and a `fallback` — a job type that could fail without telling a person is rejected at boot (INV-6).
2. Restart the worker. It creates the pg-boss queue and starts consuming; no other wiring is needed.

### When a job fails

Attempts are retried with exponential backoff up to the type's `maxAttempts`. After the last attempt:

- the payload and error land in `DeadLetterJob`, and
- exactly one `HumanFallbackEvent` is written, carrying the organization, the entity, and a plain-Indonesian description of what someone now has to do by hand.

Both writes are idempotent, so a redelivered terminal attempt cannot produce a second notification. Jobs are also idempotent by key: replaying a key recorded in `JobExecution` is a no-op and never re-runs the handler.

`jobQueue.metrics()` reports queue depth, active count, and failure count per type. TRK-007 wires these into the dashboard.

Two things to know about it. The counts are materialized on pg-boss's own queue table and advanced by the worker's monitor sweep, so they are eventually consistent — a queue reads zero until a worker has swept it once, and metrics mean nothing while no worker is running. And the web process runs an enqueue-only pg-boss (`supervise: false`, `schedule: false`) that opens its connection lazily on first `send`, so maintenance runs in exactly one place: the worker.
