import { type Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "~/app/_components/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export const metadata: Metadata = {
  title: "Login - Create T3 App",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="container flex flex-col items-center justify-center gap-6 px-4 py-16">
        <Card className="w-full max-w-xs">
          <CardHeader>
            <CardTitle className="text-3xl">Login</CardTitle>
            <CardDescription>Sign in to your account</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense>
              <LoginForm />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
