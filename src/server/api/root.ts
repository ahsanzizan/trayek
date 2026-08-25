import { auditRouter } from "~/server/api/routers/audit";
import { baselineRouter } from "~/server/api/routers/baseline";
import { driverRouter } from "~/server/api/routers/driver";
import { orderRouter } from "~/server/api/routers/order";
import { podLinkRouter } from "~/server/api/routers/pod-link";
import { organizationRouter } from "~/server/api/routers/organization";
import { postRouter } from "~/server/api/routers/post";
import { shipperRouter } from "~/server/api/routers/shipper";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  post: postRouter,
  organization: organizationRouter,
  audit: auditRouter,
  shipper: shipperRouter,
  driver: driverRouter,
  order: orderRouter,
  baseline: baselineRouter,
  podLink: podLinkRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
