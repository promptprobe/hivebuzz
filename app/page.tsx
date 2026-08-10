import { HiveApp } from "@/components/hive-app";
import { CATALOG_RELEASES } from "@/lib/catalog-seeds";
import { preloadHeroImages } from "@/lib/hero-preload";

export default function Home() {
  preloadHeroImages("/hivebuzz-hero-dotted-v2.webp", "/hivebuzz-hero-dotted-mobile-v2.webp");
  return <HiveApp initialReleases={CATALOG_RELEASES} />;
}
