import bcrypt from "bcryptjs";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { db } from "~/server/db";

// Constant dummy hash used when no user matches, so bcrypt.compare always runs
// and response timing stays uniform (defeats email-enumeration timing attacks).
const DUMMY_HASH = bcrypt.hashSync("credentials-auth-dummy", 12);

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      // ...other properties
      // role: UserRole;
    } & DefaultSession["user"];
  }

  // interface User {
  //   // ...other properties
  //   // role: UserRole;
  // }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authConfig = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email as string;
        const password = credentials.password as string;

        const user = await db.user.findUnique({ where: { email } });
        // Always run bcrypt.compare (with a dummy hash when no user) so response
        // time is constant — prevents email-enumeration via timing side-channel.
        const hash = user?.password ?? DUMMY_HASH;
        const ok = await bcrypt.compare(password, hash);
        if (!user || !ok) return null;

        // Return only safe fields — password hash never enters the JWT
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  session: { strategy: "jwt" as const },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) token.id = user.id;
      return token;
    },
    session: ({ session, token }) => ({
      ...session,
      user: { ...session.user, id: token.id as string },
    }),
  },
} satisfies NextAuthConfig;
