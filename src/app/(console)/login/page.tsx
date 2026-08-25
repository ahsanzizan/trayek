import { type Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "~/app/(console)/_components/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export const metadata: Metadata = {
  title: "Masuk — Trayek",
};

export default function LoginPage() {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="border-border w-full max-w-xs rounded-[var(--radius-card)] border shadow-none ring-0">
        <CardHeader>
          <CardTitle className="text-title-lg font-semibold">Masuk</CardTitle>
          <CardDescription>
            Masuk dengan email Anda untuk mengakses Trayek.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense>
            <LoginForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
