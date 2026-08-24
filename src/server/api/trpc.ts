/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { auth } from "~/server/auth";
import {
  resolveMembership,
  type MembershipRole,
  type MembershipSummary,
} from "~/server/auth/membership";
import { db } from "~/server/db";
import { createTenantScopedDb } from "~/server/api/tenant-extension";
import {
  createObservabilityContext,
  createRequestId,
  getObservabilityContext,
  requestIdFromHeaders,
  runWithObservabilityContext,
} from "~/server/observability/context";
import { logger } from "~/server/observability/logger";

type AuthSession = {
  user: {
    id: string;
    activeOrganizationId: string | null;
  };
  memberships: MembershipSummary[];
  expires: string;
};

type TRPCContextOptions = {
  headers: Headers;
  session?: AuthSession | null;
  db?: typeof db;
};

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async ({
  headers,
  session: providedSession,
  db: providedDb,
}: TRPCContextOptions) => {
  const session =
    providedSession === undefined ? await auth() : providedSession;

  return {
    db: providedDb ?? db,
    session,
    headers,
    requestId: requestIdFromHeaders(headers),
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
async function runTimedProcedure<T>(
  path: string,
  start: number,
  next: () => Promise<T>,
): Promise<T> {
  if (t._config.isDev) {
    // artificial delay in dev
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  logger.info("tRPC procedure completed", {
    path,
    durationMs: Date.now() - start,
  });

  return result;
}

const timingMiddleware = t.middleware(async ({ ctx, next, path }) => {
  const start = Date.now();
  const currentContext = getObservabilityContext();
  const requestId = createRequestId(
    ctx.requestId ?? requestIdFromHeaders(ctx.headers),
  );

  return runWithObservabilityContext(
    createObservabilityContext(requestId, currentContext.organizationId),
    () => runTimedProcedure(path, start, () => next({ ctx: { requestId } })),
  );
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

const protectedAuthMiddleware = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      // infers the session as non-nullable
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

const authenticatedProcedure = t.procedure.use(protectedAuthMiddleware);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = authenticatedProcedure.use(timingMiddleware);

/**
 * Authenticated procedure with a live membership check and fail-closed tenant
 * scoped database client.
 */
export const orgProcedure = authenticatedProcedure.use(
  async ({ ctx, next, path }) => {
    const start = Date.now();
    const organizationId = ctx.session.user.activeOrganizationId;
    if (!organizationId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const membership = await resolveMembership(
      ctx.db,
      ctx.session.user.id,
      organizationId,
    );
    if (!membership) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const requestId = createRequestId(
      ctx.requestId ?? requestIdFromHeaders(ctx.headers),
    );

    return runWithObservabilityContext(
      createObservabilityContext(requestId, organizationId),
      () =>
        runTimedProcedure(path, start, () =>
          next({
            ctx: {
              db: createTenantScopedDb(ctx.db, organizationId),
              membership,
              organizationId,
            },
          }),
        ),
    );
  },
);

export function roleProcedure(role: MembershipRole) {
  return orgProcedure.use(({ ctx, next }) => {
    if (ctx.membership.role !== role && ctx.membership.role !== "OWNER") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    return next();
  });
}
