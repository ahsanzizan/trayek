import { type Metadata } from "next";

import { RegisterForm } from "~/app/_components/register-form";

export const metadata: Metadata = {
  title: "Register - Create T3 App",
};

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="container flex flex-col items-center justify-center gap-6 px-4 py-16">
        <h1 className="text-4xl font-extrabold tracking-tight">Register</h1>
        <RegisterForm />
      </div>
    </main>
  );
}
