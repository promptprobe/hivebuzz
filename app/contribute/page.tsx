import type { Metadata } from "next";
import { ContributeAgent } from "@/components/contribute-agent";
import { preloadHeroImages } from "@/lib/hero-preload";

export const metadata: Metadata = {
  title: "Submit a Buzz agent - hivebuzz",
  description: "Scan a Buzz Agent Snapshot without memory locally and register it for public source review.",
};

export default function ContributePage() {
  preloadHeroImages("/hivebuzz-submit-dotted-v2.webp", "/hivebuzz-submit-dotted-mobile-v2.webp");
  return <ContributeAgent />;
}
