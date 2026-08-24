// @ts-check

import path from "node:path";

const repositoryRoot = path.resolve(process.cwd());

/**
 * @param {string} relativePath
 * @param {string} targetPath
 */
function matchesPath(relativePath, targetPath) {
  return (
    relativePath === targetPath ||
    relativePath.startsWith(`${targetPath}/`) ||
    relativePath.startsWith(`${targetPath}.`)
  );
}

/**
 * @param {string} source
 * @param {string} filename
 */
function resolveImportPath(source, filename) {
  if (source.startsWith("~/")) {
    return path.resolve(repositoryRoot, "src", source.slice(2));
  }

  if (source.startsWith(".")) {
    return path.resolve(path.dirname(filename), source);
  }

  return undefined;
}

/**
 * @param {string} source
 * @param {string} filename
 */
function getRestriction(source, filename) {
  if (source === "@prisma/client" || source.startsWith("@prisma/client/")) {
    return "Prisma client dependencies belong in infrastructure adapters";
  }

  if (source === "pg-boss" || source.startsWith("pg-boss/")) {
    return "the queue vendor belongs behind JobQueuePort, not in the domain";
  }

  const resolvedPath = resolveImportPath(source, filename);

  if (!resolvedPath) {
    return undefined;
  }

  const relativePath = path
    .relative(repositoryRoot, resolvedPath)
    .split(path.sep)
    .join("/");

  if (
    matchesPath(relativePath, "src/server/db") ||
    matchesPath(relativePath, "generated/prisma")
  ) {
    return "Prisma dependencies belong in infrastructure adapters";
  }

  if (matchesPath(relativePath, "src/server/channels")) {
    return "channel adapters must depend on the domain, not the reverse";
  }

  if (matchesPath(relativePath, "src/server/jobs")) {
    return "the queue implementation must depend on the domain, not the reverse";
  }

  return undefined;
}

/** @type {import("eslint").Rule.RuleModule} */
export const noDomainInfrastructureImports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep Prisma, queue, and channel infrastructure outside the domain layer",
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();

    /**
     * @param {import("eslint").Rule.Node & { source?: { type: string; value?: unknown } | null }} node
     */
    function checkImport(node) {
      if (!node.source || node.source.type !== "Literal") {
        return;
      }

      const source = node.source.value;

      if (typeof source !== "string") {
        return;
      }

      const restriction = getRestriction(source, filename);

      if (restriction) {
        context.report({
          node: node.source,
          message: `Domain layer cannot import "${source}": ${restriction}.`,
        });
      }
    }

    return {
      ImportDeclaration: checkImport,
      ExportAllDeclaration: checkImport,
      ExportNamedDeclaration: checkImport,
    };
  },
};
