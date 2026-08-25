import { type RequirementRules } from "./requirement-rules";

/**
 * Difference between two requirement profile versions.
 *
 * A profile version is immutable, so the only way to answer "what did we
 * change about this shipper, and when" is to compare two versions. TRK-010
 * requires a diff view in the admin UI; this is the pure half of it.
 */
export type RuleChangeKind = "ADDED" | "REMOVED" | "CHANGED";

export type RuleChange = {
  /** Dotted path into the rules, e.g. `terms.netDays`. */
  path: string;
  kind: RuleChangeKind;
  before: unknown;
  after: unknown;
};

/**
 * Requirement lists whose order carries no meaning. Reporting these
 * member-by-member ("stempel added") reads far better than showing two whole
 * arrays, which is what a reviewer actually needs to see.
 *
 * `packetFormat.ordering` is deliberately absent: its order is the point, so
 * it is compared as a single value.
 */
const SET_LIKE_PATHS = new Set(["requiredPodFields", "requiredDocuments"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => isEqual(item, b[i]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => isEqual(a[key], b[key]));
  }

  return false;
}

function join(prefix: string, key: string): string {
  return prefix.length === 0 ? key : `${prefix}.${key}`;
}

function diffSetLike(
  path: string,
  before: readonly unknown[],
  after: readonly unknown[],
  changes: RuleChange[],
): void {
  const beforeSet = new Set(before.map((value) => String(value)));
  const afterSet = new Set(after.map((value) => String(value)));

  for (const value of before) {
    if (!afterSet.has(String(value))) {
      changes.push({
        path: join(path, String(value)),
        kind: "REMOVED",
        before: value,
        after: undefined,
      });
    }
  }

  for (const value of after) {
    if (!beforeSet.has(String(value))) {
      changes.push({
        path: join(path, String(value)),
        kind: "ADDED",
        before: undefined,
        after: value,
      });
    }
  }
}

function walk(
  prefix: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  changes: RuleChange[],
): void {
  const keys = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort();

  for (const key of keys) {
    const path = join(prefix, key);
    const left = before[key];
    const right = after[key];

    if (isEqual(left, right)) {
      continue;
    }

    if (
      SET_LIKE_PATHS.has(path) &&
      Array.isArray(left) &&
      Array.isArray(right)
    ) {
      diffSetLike(path, left, right, changes);
      continue;
    }

    if (isPlainObject(left) && isPlainObject(right)) {
      walk(path, left, right, changes);
      continue;
    }

    changes.push({
      path,
      kind:
        left === undefined
          ? "ADDED"
          : right === undefined
            ? "REMOVED"
            : "CHANGED",
      before: left,
      after: right,
    });
  }
}

/**
 * Compares two rule sets, newest-argument-last, returning one entry per
 * meaningful change. An empty array means the two versions are equivalent.
 */
export function diffRequirementRules(
  before: RequirementRules,
  after: RequirementRules,
): RuleChange[] {
  const changes: RuleChange[] = [];

  walk("", before, after, changes);

  return changes;
}
