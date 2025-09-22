import type { Metadata } from "next";
import Link from "next/link";
import { DevAuthButtons } from '@/components/DevAuthButtons';
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false, // avoid preloading if not used above-the-fold
});

export const metadata: Metadata = {
  title: "spasht - AI Interview Coach",
  description: "Master job interviews with AI-powered coaching, real-time feedback, and fluency training",
  keywords: "interview coach, AI coaching, job preparation, communication skills, fluency training",
  authors: [{ name: "spasht Team" }],
  openGraph: {
    title: "spasht - AI Interview Coach",
    description: "Master job interviews with AI-powered coaching",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div>
      <html lang="en">
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
          <header style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <nav style={{ display: "flex", gap: "16px", alignItems: "center" }}>
              <Link href="/" style={{ textDecoration: "none", fontWeight: "600", color: "#1f2937" }}>Spasht</Link>
              <Link href="/practice" style={{ textDecoration: "none", color: "#6b7280" }}>Practice</Link>
              <Link href="/analytics" style={{ textDecoration: "none", color: "#6b7280" }}>Analytics</Link>
              <Link href="/settings" style={{ textDecoration: "none", color: "#6b7280" }}>Settings</Link>
            </nav>
            <div>
              <DevAuthButtons />
            </div>
          </header>
          {children}
        </body>
      </html>
    </div>
  );
}
