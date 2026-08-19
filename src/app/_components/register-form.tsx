"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TRPCClientError } from "@trpc/client";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { api } from "~/trpc/react";
import { registerSchema, type RegisterInput } from "~/lib/register-schema";

export function RegisterForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const registerMutation = api.user.register.useMutation({
    onSuccess: () => {
      router.push("/login");
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      await registerMutation.mutateAsync(data);
    } catch (err) {
      if (err instanceof TRPCClientError) {
        setServerError(err.message);
        return;
      }
      setServerError("Registration failed. Please try again.");
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-4">
      <Field data-invalid={!!errors.name}>
        <FieldLabel htmlFor="name">Name</FieldLabel>
        <Input
          id="name"
          type="text"
          placeholder="John Doe"
          autoComplete="name"
          aria-invalid={!!errors.name}
          {...register("name")}
        />
        <FieldError errors={[errors.name]} />
      </Field>

      <Field data-invalid={!!errors.email}>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          aria-invalid={!!errors.email}
          {...register("email")}
        />
        <FieldError errors={[errors.email]} />
      </Field>

      <Field data-invalid={!!errors.password}>
        <FieldLabel htmlFor="password">Password</FieldLabel>
        <Input
          id="password"
          type="password"
          placeholder="Password (min 8 characters)"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          {...register("password")}
        />
        <FieldError errors={[errors.password]} />
      </Field>

      {serverError && <FieldError errors={[{ message: serverError }]} />}

      <Button type="submit" disabled={isSubmitting || registerMutation.isSuccess}>
        {isSubmitting ? (
          <>
            <Spinner />
            <span className="ml-2">Registering…</span>
          </>
        ) : (
          "Register"
        )}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
