"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { signIn } from "next-auth/react";

import { Button } from "~/components/ui/button";
import { loginSchema } from "~/lib/login-schema";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    setIsPending(true);
    const res = await signIn("credentials", {
      email: result.data.email,
      password: result.data.password,
      redirect: false,
      callbackUrl,
    });
    setIsPending(false);

    if (res?.error) {
      setError("Invalid email or password");
      return;
    }

    router.push(res?.url ?? callbackUrl);
    router.refresh();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-xs flex-col gap-3"
    >
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-full bg-white/10 px-4 py-2 text-white placeholder:text-white/50"
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-full bg-white/10 px-4 py-2 text-white placeholder:text-white/50"
      />
      {error && <p className="text-center text-sm text-red-400">{error}</p>}
      <Button
        type="submit"
        className="rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20"
        disabled={isPending}
      >
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-white/60">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="underline hover:text-white">
          Register
        </Link>
      </p>
    </form>
  );
}
