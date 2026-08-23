import "~/styles/globals.css";

import { type Metadata } from "next";
import { Inter } from "next/font/google";

import { UtilityBar } from "~/app/_components/utility-bar";
import { cn } from "~/lib/utils";
import { auth } from "~/server/auth";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: "Trayek",
  description: "Console operasional Trayek",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();

  return (
    <html lang="id" className={cn(inter.variable, "dark font-sans")}>
      <body>
        <TRPCReactProvider session={session}>
          {session?.user && <UtilityBar />}
          {children}
        </TRPCReactProvider>
      </body>
    </html>
  );
}
