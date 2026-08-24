import { PrismaAdapter } from "@auth/prisma-adapter";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import { encode as encodeJwt } from "next-auth/jwt";
import ResendProvider from "next-auth/providers/resend";

import { env } from "~/env";
import {
  chooseActiveOrganization,
  DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS,
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  listMemberships,
  resolveMembership,
  resolveSessionLifetime,
  type MembershipSummary,
} from "~/server/auth/membership";
import { db } from "~/server/db";

const MAGIC_LINK_MAX_AGE_SECONDS = 15 * 60;

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      activeOrganizationId: string | null;
    } & DefaultSession["user"];
    memberships: MembershipSummary[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    activeOrganizationId?: string | null;
    memberships?: MembershipSummary[];
    sessionMaxAgeSeconds?: number;
    sessionIdleTimeoutSeconds?: number;
    sessionIssuedAt?: number;
    lastActivityAt?: number;
  }
}

type JwtEncode = NonNullable<NonNullable<NextAuthConfig["jwt"]>["encode"]>;

const encodeWithOrganizationLifetime: JwtEncode = async (params) => {
  const token = params.token;
  const now = Math.floor(Date.now() / 1000);
  const configuredMaxAge =
    typeof token?.sessionMaxAgeSeconds === "number"
      ? token.sessionMaxAgeSeconds
      : DEFAULT_SESSION_MAX_AGE_SECONDS;
  const configuredIdleTimeout =
    typeof token?.sessionIdleTimeoutSeconds === "number"
      ? token.sessionIdleTimeoutSeconds
      : DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS;
  const sessionIssuedAt =
    typeof token?.sessionIssuedAt === "number" ? token.sessionIssuedAt : now;
  const lastActivityAt =
    typeof token?.lastActivityAt === "number" ? token.lastActivityAt : now;
  const maxAgeRemaining = Math.max(
    1,
    configuredMaxAge - Math.max(0, now - sessionIssuedAt),
  );
  const idleAgeRemaining = Math.max(
    1,
    configuredIdleTimeout - Math.max(0, now - lastActivityAt),
  );

  return encodeJwt({
    ...params,
    maxAge: Math.min(maxAgeRemaining, idleAgeRemaining),
  });
};

async function applyOrganizationLifetime(
  token: NonNullable<Parameters<JwtEncode>[0]["token"]>,
  organizationId: string | null,
) {
  const organization = organizationId
    ? await db.organization.findUnique({
        where: { id: organizationId },
        select: {
          sessionMaxAgeSeconds: true,
          sessionIdleTimeoutSeconds: true,
        },
      })
    : null;
  const lifetime = resolveSessionLifetime(organization);

  token.sessionMaxAgeSeconds = lifetime.maxAge;
  token.sessionIdleTimeoutSeconds = lifetime.updateAge;
}

export const authConfig = {
  adapter: PrismaAdapter(db),
  providers: [
    ResendProvider({
      apiKey: env.AUTH_RESEND_KEY ?? "",
      from: env.AUTH_EMAIL_FROM,
      maxAge: MAGIC_LINK_MAX_AGE_SECONDS,
    }),
  ],
  session: {
    strategy: "jwt" as const,
    maxAge: DEFAULT_SESSION_MAX_AGE_SECONDS,
    updateAge: 0, // no refresh throttle; idle expiry is enforced in the jwt callback
  },
  jwt: {
    encode: encodeWithOrganizationLifetime,
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user?.id) token.id = user.id;

      if (!token.id) return token;

      const now = Math.floor(Date.now() / 1000);
      const sessionIssuedAt = token.sessionIssuedAt ?? now;
      token.sessionIssuedAt = sessionIssuedAt;

      const memberships = await listMemberships(db, token.id);
      const requestedOrganizationId =
        trigger === "update"
          ? getRequestedOrganizationId(session)
          : token.activeOrganizationId;

      if (requestedOrganizationId) {
        const membership = await resolveMembership(
          db,
          token.id,
          requestedOrganizationId,
        );
        if (membership) token.activeOrganizationId = requestedOrganizationId;
      }

      token.memberships = memberships;
      token.activeOrganizationId = chooseActiveOrganization(
        memberships,
        token.activeOrganizationId,
      );
      await applyOrganizationLifetime(token, token.activeOrganizationId);

      const maxAge =
        token.sessionMaxAgeSeconds ?? DEFAULT_SESSION_MAX_AGE_SECONDS;
      if (now - sessionIssuedAt >= maxAge) return null;

      // Idle timeout: Auth.js's `updateAge` only throttles token refreshes in
      // the JWT strategy and does not expire the session. Enforce the idle
      // window here against the last observed activity.
      const idleTimeout =
        token.sessionIdleTimeoutSeconds ?? DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS;
      if (now - (token.lastActivityAt ?? now) >= idleTimeout) return null;

      token.lastActivityAt = now;

      return token;
    },
    async session({ session, token }) {
      if (!token.id) return session;

      const memberships = await listMemberships(db, token.id);
      const activeOrganizationId = chooseActiveOrganization(
        memberships,
        token.activeOrganizationId,
      );

      token.activeOrganizationId = activeOrganizationId;
      token.memberships = memberships;
      await applyOrganizationLifetime(token, activeOrganizationId);

      return {
        ...session,
        user: {
          ...session.user,
          id: token.id,
          activeOrganizationId,
        },
        memberships,
      };
    },
  },
} satisfies NextAuthConfig;

function getRequestedOrganizationId(
  session: unknown,
): string | null | undefined {
  if (typeof session !== "object" || session === null) return undefined;

  const sessionRecord = session as Record<string, unknown>;
  const direct = sessionRecord.activeOrganizationId;
  if (typeof direct === "string" || direct === null) return direct;

  const user = sessionRecord.user;
  if (typeof user !== "object" || user === null) return undefined;

  const nested = (user as Record<string, unknown>).activeOrganizationId;
  return typeof nested === "string" || nested === null ? nested : undefined;
}
