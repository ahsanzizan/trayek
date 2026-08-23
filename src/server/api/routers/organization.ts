import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { membershipSelect } from "~/server/auth/membership";

export const organizationRouter = createTRPCRouter({
  switchOrganization: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const membership = await ctx.db.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: ctx.session.user.id,
            organizationId: input.organizationId,
          },
        },
        select: membershipSelect,
      });

      if (!membership) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // The client applies this verified value with useSession().update(),
      // which invokes Auth.js's JWT callback with trigger="update".
      return {
        activeOrganizationId: membership.organizationId,
        membership,
      };
    }),

  listMemberships: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.membership.findMany({
      where: { userId: ctx.session.user.id },
      select: {
        id: true,
        organizationId: true,
        role: true,
        organization: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }),
});
