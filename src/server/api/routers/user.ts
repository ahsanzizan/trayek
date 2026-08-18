import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { registerSchema } from "~/lib/register-schema";

export const userRouter = createTRPCRouter({
  register: publicProcedure
    .input(registerSchema)
    .mutation(async ({ ctx, input }) => {
      const { name, email, password } = input;

      const hashedPassword = await bcrypt.hash(password, 12);

      try {
        await ctx.db.user.create({
          data: {
            name,
            email,
            password: hashedPassword,
          },
        });
      } catch (error) {
        // Prisma unique constraint violation
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Email already registered",
          });
        }
        throw error;
      }

      return { success: true };
    }),
});
