import type { Metadata } from "next";
import { SnapshotGuide } from "@/components/snapshot-guide";
import { preloadHeroImages } from "@/lib/hero-preload";

export const metadata: Metadata = {
  title: "Export and import Buzz agents - hivebuzz",
  description: "Export a Buzz Agent Snapshot without memory, verify it locally, and import it with a fresh identity.",
};

export default function GuidePage() {
  preloadHeroImages("/hivebuzz-guide-dotted-v2.webp", "/hivebuzz-guide-dotted-mobile-v2.webp");
  return <SnapshotGuide />;
}
