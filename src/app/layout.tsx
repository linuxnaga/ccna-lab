import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { NavBar, NavBarShell } from "@/components/NavBar";
import { BRAND } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: `${BRAND}: Gamified Network Labs`,
  description: "Practice CCNA and other network certifications in a gamified, browser-based lab simulator.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen noc-grid`}>
        <Suspense fallback={<NavBarShell />}>
          <NavBar />
        </Suspense>
        <Suspense>
          <main>{children}</main>
        </Suspense>
      </body>
    </html>
  );
}
