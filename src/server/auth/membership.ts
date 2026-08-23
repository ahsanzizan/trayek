import { type PrismaClient } from "../../../generated/prisma";

export type MembershipRole = "OWNER" | "ADMIN" | "FINANCE" | "VIEWER";

export type MembershipSummary = Readonly<{
  id: string;
  organizationId: string;
  role: MembershipRole;
}>;

const rolePriority: Record<MembershipRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  FINANCE: 2,
  VIEWER: 1,
};

export const membershipSelect = {
  id: true,
  organizationId: true,
  role: true,
} as const;

type MembershipDatabase = Pick<PrismaClient, "membership" | "organization">;

export const DEFAULT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS = 24 * 60 * 60;

export type SessionLifetime = Readonly<{
  maxAge: number;
  updateAge: number;
}>;

export function resolveSessionLifetime(
  organization:
    | Readonly<{
        sessionMaxAgeSeconds: number | null;
        sessionIdleTimeoutSeconds: number | null;
      }>
    | null
    | undefined,
): SessionLifetime {
  return {
    maxAge:
      organization?.sessionMaxAgeSeconds ?? DEFAULT_SESSION_MAX_AGE_SECONDS,
    updateAge:
      organization?.sessionIdleTimeoutSeconds ??
      DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS,
  };
}

export async function listMemberships(
  database: MembershipDatabase,
  userId: string,
): Promise<MembershipSummary[]> {
  return database.membership.findMany({
    where: { userId },
    select: membershipSelect,
    orderBy: { createdAt: "asc" },
  });
}

export async function resolveMembership(
  database: MembershipDatabase,
  userId: string,
  organizationId: string,
): Promise<MembershipSummary | null> {
  return database.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: membershipSelect,
  });
}

export async function defaultActiveOrganization(
  database: MembershipDatabase,
  userId: string,
  tokenPreference?: string | null,
): Promise<string | null> {
  const memberships = await listMemberships(database, userId);

  return chooseActiveOrganization(memberships, tokenPreference);
}

export function chooseActiveOrganization(
  memberships: readonly Pick<MembershipSummary, "organizationId" | "role">[],
  tokenPreference: string | null | undefined,
): string | null {
  if (
    tokenPreference &&
    memberships.some(
      (membership) => membership.organizationId === tokenPreference,
    )
  ) {
    return tokenPreference;
  }

  let highest: (typeof memberships)[number] | undefined;

  for (const membership of memberships) {
    if (
      highest === undefined ||
      rolePriority[membership.role] > rolePriority[highest.role]
    ) {
      highest = membership;
    }
  }

  return highest?.organizationId ?? null;
}
