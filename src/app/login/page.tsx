import { type Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "~/app/_components/login-form";

export const metadata: Metadata = {
  title: "Login - Create T3 App",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="container flex flex-col items-center justify-center gap-6 px-4 py-16">
        <h1 className="text-4xl font-extrabold tracking-tight">Login</h1>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
