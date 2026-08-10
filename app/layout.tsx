import type { Metadata } from "next";
import "./globals.css";

const origin = "https://hivebuzz.xyz";
const socialCardVersion = "20260803-final";
const shareUrl = `${origin}/?card=${socialCardVersion}`;
const imageUrl = `${origin}/hivebuzz-social-card-20260803.png?card=${socialCardVersion}`;

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: "hivebuzz - Open Buzz Agent Library",
  description: "A library of locally verified, portable Buzz Agent Snapshots with no login required.",
  applicationName: "hivebuzz",
  keywords: ["Buzz", "AI agents", "Agent Snapshots", "portable agents", "open library"],
  icons: { icon: "/icon.png", apple: "/icon.png" },
  alternates: { canonical: origin },
  openGraph: {
    title: "hivebuzz - Open Buzz Agent Library",
    description: "A library of locally verified Buzz agents with no login required.",
    siteName: "hivebuzz",
    type: "website",
    url: shareUrl,
    images: [{ url: imageUrl, width: 1200, height: 630, alt: "hivebuzz - Open Buzz Agent Library" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@promptprobe",
    creator: "@promptprobe",
    title: "hivebuzz - Open Buzz Agent Library",
    description: "A library of locally verified Buzz agents with no login required.",
    images: [{ url: imageUrl, alt: "hivebuzz - Open Buzz Agent Library" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
