import { randomBytes } from "node:crypto";

import {
  encodeUploadToken,
  hashUploadToken,
  POD_TOKEN_LENGTH,
} from "~/server/domain/pod-link/token";

export type IssuedToken = {
  /** Shown once, at issue time. Nothing stores this. */
  token: string;
  tokenHash: string;
};

/**
 * Draws a new upload token.
 *
 * Separated from the domain because it is the one step that is not a function
 * of its input. One byte per symbol is wasteful and deliberate: it keeps
 * `encodeUploadToken` a straight map from byte to symbol, which is what makes
 * its uniformity testable.
 */
export function issueUploadToken(): IssuedToken {
  const token = encodeUploadToken(randomBytes(POD_TOKEN_LENGTH));

  return { token, tokenHash: hashUploadToken(token) };
}
