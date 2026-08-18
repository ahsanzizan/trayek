"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import { registerSchema } from "~/lib/register-schema";

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const register = api.user.register.useMutation({
    onSuccess: () => {
      router.push("/login");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const result = registerSchema.safeParse({ name, email, password });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    register.mutate(result.data);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-xs flex-col gap-3"
    >
      <input
        type="text"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-full bg-white/10 px-4 py-2 text-white placeholder:text-white/50"
      />
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-full bg-white/10 px-4 py-2 text-white placeholder:text-white/50"
      />
      <input
        type="password"
        placeholder="Password (min 8 characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-full bg-white/10 px-4 py-2 text-white placeholder:text-white/50"
      />
      {error && <p className="text-center text-sm text-red-400">{error}</p>}
      <Button
        type="submit"
        className="rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20"
        disabled={register.isPending}
      >
        {register.isPending ? "Registering…" : "Register"}
      </Button>
      <p className="text-center text-sm text-white/60">
        Already have an account?{" "}
        <Link href="/login" className="underline hover:text-white">
          Sign in
        </Link>
      </p>
    </form>
  );
}
