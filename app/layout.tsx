import type { Metadata } from "next";
import { headers } from "next/headers";
import { Space_Grotesk, DM_Sans } from "next/font/google";
import "./globals.css";
import { AgentationProvider } from "@/components/AgentationProvider";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VYXO",
  description: "A private, local-first AI workspace.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (process.env.SHIPSTUDIO_DESKTOP === "1") {
    await headers();
  }

  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${dmSans.variable}`}>
      <body className="font-[family-name:var(--font-body)] antialiased">
        <WorkspaceShell>{children}</WorkspaceShell>
        <AgentationProvider />
      </body>
    </html>
  );
}
