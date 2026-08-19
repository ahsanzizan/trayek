"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { loginSchema, type LoginInput } from "~/lib/login-schema";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const [isRedirecting, setIsRedirecting] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    clearErrors("root");

    const res = await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirect: false,
      callbackUrl,
    });

    if (res?.error) {
      setError("root", { message: "Invalid email or password" });
      return;
    }

    setIsRedirecting(true);
    router.push(res?.url ?? callbackUrl);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          aria-invalid={!!errors.email}
          {...register("email", { onChange: () => clearErrors("root") })}
        />
        <FieldError errors={[{ message: errors.email?.message }]} />
      </Field>

      <Field>
        <FieldLabel htmlFor="password">Password</FieldLabel>
        <Input
          id="password"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          {...register("password", { onChange: () => clearErrors("root") })}
        />
        <FieldError errors={[{ message: errors.password?.message }]} />
      </Field>

      {errors.root?.message && (
        <FieldError errors={[{ message: errors.root.message }]} />
      )}

      <Button type="submit" disabled={isSubmitting || isRedirecting}>
        {isSubmitting ? (
          <>
            <Spinner />
            <span className="ml-2">Signing in…</span>
          </>
        ) : (
          "Sign in"
        )}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Register
        </Link>
      </p>
    </form>
  );
}
