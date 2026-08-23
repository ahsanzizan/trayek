"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";

import { Button } from "~/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { loginSchema, type LoginInput } from "~/lib/login-schema";

type LoginStatus =
  "idle" | "success" | "invalid-link" | "rate-limit" | "error" | "network";

function getSafeCallbackUrl(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

function isRateLimitError(error: string) {
  return error.toLowerCase().includes("rate");
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  const [status, setStatus] = useState<LoginStatus>(() =>
    searchParams.get("error") ? "invalid-link" : "idle",
  );
  const [submittedEmail, setSubmittedEmail] = useState("");
  const callbackUrl = getSafeCallbackUrl(searchParams.get("callbackUrl"));

  const {
    register,
    handleSubmit,
    clearErrors,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "" },
  });

  useEffect(() => {
    if (status === "success" || status === "invalid-link") {
      successHeadingRef.current?.focus();
    }
  }, [status]);

  const resetToForm = () => {
    setStatus("idle");
    window.setTimeout(() => setFocus("email"), 0);
  };

  const onSubmit = handleSubmit(async (data) => {
    clearErrors();
    setStatus("idle");

    try {
      const result = await signIn("resend", {
        email: data.email,
        redirect: false,
        callbackUrl,
      });

      if (!result || result.error) {
        setStatus(
          result?.error && isRateLimitError(result.error)
            ? "rate-limit"
            : "error",
        );
        return;
      }

      setSubmittedEmail(data.email);
      setStatus("success");
    } catch {
      setStatus("network");
    }
  });

  if (status === "success") {
    return (
      <div aria-live="polite" className="flex flex-col gap-4">
        <h2
          ref={successHeadingRef}
          tabIndex={-1}
          className="text-base font-semibold outline-none"
        >
          Cek email Anda
        </h2>
        <p className="text-muted-foreground text-sm">
          Kami mengirim tautan masuk ke {submittedEmail}.
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 rounded-[var(--radius-control)]"
          onClick={resetToForm}
        >
          Minta tautan baru
        </Button>
      </div>
    );
  }

  if (status === "invalid-link") {
    return (
      <div aria-live="polite" className="flex flex-col gap-4">
        <h2
          ref={successHeadingRef}
          tabIndex={-1}
          className="text-base font-semibold outline-none"
        >
          Tautan tidak valid atau sudah kedaluwarsa.
        </h2>
        <p className="text-muted-foreground text-sm">
          Minta tautan baru untuk melanjutkan.
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 rounded-[var(--radius-control)]"
          onClick={resetToForm}
        >
          Minta tautan baru
        </Button>
      </div>
    );
  }

  const statusMessage =
    status === "rate-limit"
      ? "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi."
      : status === "network"
        ? "Koneksi terputus. Periksa internet Anda dan coba lagi."
        : status === "error"
          ? "Terjadi kesalahan saat mengirim. Coba lagi."
          : null;

  return (
    <div aria-live="polite" className="flex flex-col gap-4">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FieldGroup>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="nama@perusahaan.id"
              autoComplete="email"
              className="border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)]"
              aria-invalid={!!errors.email}
              {...register("email", { onChange: () => clearErrors() })}
            />
            <FieldError errors={[{ message: errors.email?.message }]} />
          </Field>
        </FieldGroup>

        {statusMessage && (
          <p role="alert" className="text-destructive text-sm">
            {statusMessage}
          </p>
        )}

        <Button
          type="submit"
          disabled={isSubmitting}
          className="min-h-11 rounded-[var(--radius-control)]"
        >
          {isSubmitting ? (
            <>
              <Spinner aria-label="Mengirim tautan masuk" />
              <span>Mengirim tautan…</span>
            </>
          ) : (
            "Kirim tautan masuk"
          )}
        </Button>

        {statusMessage && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 rounded-[var(--radius-control)]"
            onClick={resetToForm}
          >
            Coba lagi
          </Button>
        )}
      </form>
    </div>
  );
}
