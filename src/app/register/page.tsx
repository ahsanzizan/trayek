import { type Metadata } from "next";

import { RegisterForm } from "~/app/_components/register-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export const metadata: Metadata = {
  title: "Register - Create T3 App",
};

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="container flex flex-col items-center justify-center gap-6 px-4 py-16">
        <Card className="w-full max-w-xs">
          <CardHeader>
            <CardTitle className="text-3xl">Register</CardTitle>
            <CardDescription>Create your account</CardDescription>
          </CardHeader>
          <CardContent>
            <RegisterForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
