import "~/styles/globals.css";

import { type Metadata } from "next";

/**
 * The driver surface's own root layout (TRK-030).
 *
 * A second root layout rather than a nested one, because what the console
 * root provides is exactly what this surface must not pay for: Pak Herman has
 * no session, makes no tRPC call, and is on a throttled 3G connection at a
 * warehouse gate. `TRPCReactProvider` and two downloaded font families would
 * be most of the 150 KB budget spent before the camera button renders.
 *
 * Three deliberate omissions:
 *
 * - No `TRPCReactProvider`. There is no session to query with.
 * - No `next/font/google`. `--font-sans` already resolves to a system stack in
 *   `globals.css`, so not setting the Inter variable costs a font request and
 *   its layout shift, and gains the font already on the device.
 * - No `dark` class. The console is dark; this screen is read in daylight at a
 *   loading bay, where a light surface is what survives the glare.
 */

export const metadata: Metadata = {
  title: "Unggah POD · Trayek",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
  // A driver link is forwarded through WhatsApp groups. Nothing here should
  // be indexed, and the token in the path is why (TRK-024).
  robots: { index: false, follow: false },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom stays enabled: a driver squinting at a surat jalan number on a
  // cracked screen in the sun needs to be able to pinch it larger.
  maximumScale: 5,
  themeColor: "#ffffff",
};

export default function DriverRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className="font-sans">
      <body className="bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
