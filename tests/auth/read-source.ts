import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function readSource(relativePath: string): Promise<string> {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}
