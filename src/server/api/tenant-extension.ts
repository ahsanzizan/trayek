import { type PrismaClient } from "../../../generated/prisma";

type RecordValue = Record<string, unknown>;

/**
 * Organization-owned models. New tenant models must be added here in the same
 * change that adds them to the schema, with an isolation test. Unknown models
 * fail closed below.
 */
export const TENANT_SCOPED_MODELS = new Set<string>([
  "JobExecution",
  "DeadLetterJob",
  "HumanFallbackEvent",
  "AuditLog",
  "Shipper",
  "RequirementProfile",
  "Driver",
  "Order",
  "DsoBaseline",
  "HistoricalInvoice",
  "MessageLog",
  "ChannelConnection",
]);
const UNSCOPED_MODELS = new Set(["User", "Organization", "Membership", "Post"]);

type ScopeTenantOperationInput = {
  model: string;
  operation: string;
  args: RecordValue;
  organizationId: string;
  tenantModels: ReadonlySet<string>;
};

type ScopedOperation = {
  operation: string;
  args: RecordValue;
};

const whereOperations = new Set([
  "findMany",
  "findFirst",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
  "update",
  "delete",
  "findFirstOrThrow",
]);

/**
 * Bulk operations that can affect every row of an organization. A caller
 * omitting `where` would otherwise hit the entire org; require an explicit,
 * non-empty where for these.
 */
const bulkRequireWhere = new Set([
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);

function asRecord(value: unknown): RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as RecordValue) }
    : {};
}

function withOrganizationWhere(
  args: RecordValue,
  organizationId: string,
): RecordValue {
  return {
    ...args,
    where: {
      ...asRecord(args.where),
      organizationId,
    },
  };
}

function withOrganizationData(
  args: RecordValue,
  organizationId: string,
): RecordValue {
  const data = args.data;

  if (Array.isArray(data)) {
    return {
      ...args,
      data: data.map((item) => ({
        ...asRecord(item),
        organizationId,
      })),
    };
  }

  return {
    ...args,
    data: {
      ...asRecord(data),
      organizationId,
    },
  };
}

export function scopeTenantUpsert(
  args: RecordValue,
  organizationId: string,
): RecordValue {
  return {
    where: {
      ...asRecord(args.where),
      organizationId,
    },
    update: {
      ...asRecord(args.update),
      organizationId,
    },
    create: {
      ...asRecord(args.create),
      organizationId,
    },
  };
}

export function scopeTenantOperation({
  model,
  operation,
  args,
  organizationId,
  tenantModels,
}: ScopeTenantOperationInput): ScopedOperation {
  if (UNSCOPED_MODELS.has(model)) {
    return { operation, args };
  }

  if (!tenantModels.has(model)) {
    throw new Error(
      `Tenant model ${model} is not explicitly classified for organization scoping`,
    );
  }

  if (operation === "findUnique" || operation === "findUniqueOrThrow") {
    return {
      operation: "findFirst",
      args: withOrganizationWhere(args, organizationId),
    };
  }

  if (
    bulkRequireWhere.has(operation) &&
    Object.keys(asRecord(args.where)).length === 0
  ) {
    throw new Error(
      `Tenant operation ${model}.${operation} requires an explicit where`,
    );
  }

  if (
    operation === "update" ||
    operation === "updateMany" ||
    operation === "updateManyAndReturn"
  ) {
    return {
      operation,
      args: withOrganizationData(
        withOrganizationWhere(args, organizationId),
        organizationId,
      ),
    };
  }

  if (whereOperations.has(operation)) {
    return {
      operation,
      args: withOrganizationWhere(args, organizationId),
    };
  }

  if (
    operation === "create" ||
    operation === "createMany" ||
    operation === "createManyAndReturn"
  ) {
    return {
      operation,
      args: withOrganizationData(args, organizationId),
    };
  }

  if (operation === "upsert") {
    return {
      operation,
      args: scopeTenantUpsert(args, organizationId),
    };
  }

  throw new Error(`Unsupported tenant operation ${model}.${operation}`);
}

type TenantDelegate = {
  findFirst(args: RecordValue): Promise<unknown>;
  findFirstOrThrow(args: RecordValue): Promise<unknown>;
  update(args: RecordValue): Promise<unknown>;
  create(args: RecordValue): Promise<unknown>;
};

function isTenantDelegate(value: unknown): value is TenantDelegate {
  return (
    typeof value === "object" &&
    value !== null &&
    "findFirst" in value &&
    "findFirstOrThrow" in value &&
    "update" in value &&
    "create" in value &&
    typeof value.findFirst === "function" &&
    typeof value.findFirstOrThrow === "function" &&
    typeof value.update === "function" &&
    typeof value.create === "function"
  );
}

function modelDelegate(database: PrismaClient, model: string): TenantDelegate {
  const delegateName = model.charAt(0).toLowerCase() + model.slice(1);
  const candidate = (database as unknown as Record<string, unknown>)[
    delegateName
  ];

  if (!isTenantDelegate(candidate)) {
    throw new Error(`No Prisma delegate available for tenant model ${model}`);
  }

  return candidate;
}

/**
 * A PrismaClient that pre-filters every tenant-scoped model by organization.
 *
 * Declared as `PrismaClient` rather than the inferred `$extends` type. The two
 * are structurally different — the extension type drops `$on` and reshapes the
 * transaction client — so without this every caller would need its own cast to
 * use the client with Prisma's own input types. The behaviour is a drop-in
 * replacement, so the type says so once, here, instead of at each call site.
 */
export function createTenantScopedDb(
  database: PrismaClient,
  organizationId: string,
): PrismaClient {
  return database.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const rawArgs = args;

          if (UNSCOPED_MODELS.has(model)) {
            return query(args);
          }

          if (operation === "findUnique" || operation === "findUniqueOrThrow") {
            const scoped = scopeTenantOperation({
              model,
              operation,
              args: rawArgs,
              organizationId,
              tenantModels: TENANT_SCOPED_MODELS,
            });
            const delegate = modelDelegate(database, model);
            const findArgs = scoped.args;

            return operation === "findUniqueOrThrow"
              ? delegate.findFirstOrThrow(findArgs)
              : delegate.findFirst(findArgs);
          }

          if (operation === "upsert") {
            const scoped = scopeTenantOperation({
              model,
              operation,
              args: rawArgs,
              organizationId,
              tenantModels: TENANT_SCOPED_MODELS,
            });
            const delegate = modelDelegate(database, model);
            const where = scoped.args.where;
            const existing = await delegate.findFirst({
              where,
              select: { id: true },
            });

            if (existing !== null) {
              const existingId = asRecord(existing).id;
              if (
                typeof existingId !== "string" &&
                typeof existingId !== "number"
              ) {
                throw new Error(
                  `Tenant model ${model} must expose an id for scoped upsert`,
                );
              }

              return delegate.update({
                where: { id: existingId },
                data: scoped.args.update,
              });
            }

            return delegate.create({
              data: scoped.args.create,
            });
          }

          const scoped = scopeTenantOperation({
            model,
            operation,
            args: rawArgs,
            organizationId,
            tenantModels: TENANT_SCOPED_MODELS,
          });

          return query(scoped.args);
        },
      },
    },
  }) as unknown as PrismaClient;
}
