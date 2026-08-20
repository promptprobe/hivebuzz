import { HiveApp } from "@/components/hive-app";
import { CATALOG_RELEASES } from "@/lib/catalog-seeds";
import { directoryRecordFromRelease } from "@/lib/directory-catalog";
import { preloadHeroImages } from "@/lib/hero-preload";
import { AGENT_CATEGORIES, AGENT_HARNESSES, type AgentCategory, type AgentHarness } from "@/lib/hive-contract";

type SearchValue = string | string[] | undefined;

function first(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, SearchValue>> }) {
  preloadHeroImages("/hivebuzz-hero-dotted-v2.webp", "/hivebuzz-hero-dotted-mobile-v2.webp");
  const params = await searchParams;
  const query = (first(params.q) ?? "").slice(0, 160);
  const categoryValue = first(params.topic);
  const category: "all" | AgentCategory = categoryValue && AGENT_CATEGORIES.includes(categoryValue as AgentCategory)
    ? categoryValue as AgentCategory
    : "all";
  const harnessValue = first(params.harness);
  const harness: "all" | AgentHarness = harnessValue && AGENT_HARNESSES.includes(harnessValue as AgentHarness)
    ? harnessValue as AgentHarness
    : "all";
  const pageValue = Number(first(params.page) ?? 1);
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  return <HiveApp initialReleases={CATALOG_RELEASES.map(directoryRecordFromRelease)} initialQuery={query} initialCategory={category} initialHarness={harness} initialPage={page} />;
}
