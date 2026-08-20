"use client";

import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Download,
  LockKeyhole,
  PackageCheck,
  Search,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { InstallDialog, type NoticeState } from "@/components/agent-install";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { loadCatalogDownloadCounts, mergeDownloadCounts } from "@/lib/catalog-client";
import type { DirectoryReleaseRecord } from "@/lib/directory-catalog";
import { AGENT_CATEGORIES, type AgentCategory, type AgentHarness } from "@/lib/hive-contract";

interface HiveAppProps {
  initialReleases: DirectoryReleaseRecord[];
  initialQuery?: string;
  initialCategory?: "all" | AgentCategory;
  initialHarness?: "all" | AgentHarness;
  initialPage?: number;
}

const numberFormatter = new Intl.NumberFormat("en-US");
const PAGE_SIZE = 12;
const CATEGORY_LABELS: Record<AgentCategory, string> = {
  research: "Research",
  development: "Development",
  design: "Design",
  operations: "Operations",
  data: "Data",
  marketing: "Marketing",
  security: "Security",
  personal: "Personal",
};
const HARNESS_LABELS: Record<AgentHarness, string> = {
  codex: "Codex",
  claude: "Claude Code",
  goose: "Goose",
  "buzz-agent": "Buzz Agent",
};

function RiskLabel({ release }: { release: DirectoryReleaseRecord }) {
  const labels = {
    low: "No tools",
    review: "Review access",
    elevated: "Elevated access",
  };
  return <span className={`risk risk-${release.riskLevel}`}>{labels[release.riskLevel]}</span>;
}

export function HiveApp({
  initialReleases,
  initialQuery = "",
  initialCategory = "all",
  initialHarness = "all",
  initialPage = 1,
}: HiveAppProps) {
  const [releases, setReleases] = useState(initialReleases);
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<"all" | AgentCategory>(initialCategory);
  const [harness, setHarness] = useState<"all" | AgentHarness>(initialHarness);
  const [page, setPage] = useState(initialPage);
  const [installRelease, setInstallRelease] = useState<DirectoryReleaseRecord | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [categoryDragging, setCategoryDragging] = useState(false);
  const catalogRef = useRef<HTMLElement>(null);
  const categoryDragRef = useRef({ pointerId: -1, startX: 0, scrollLeft: 0, moved: false, suppressClick: false });

  useEffect(() => {
    let active = true;
    loadCatalogDownloadCounts()
      .then((counts) => {
        if (active) setReleases((current) => mergeDownloadCounts(current, counts));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const filteredReleases = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return releases
      .filter((release) => {
        if (category !== "all" && release.manifest.release.category !== category) return false;
        if (harness !== "all" && release.manifest.release.recommendedHarness !== harness) return false;
        if (!normalized) return true;
        const item = release.manifest.release;
        return [
          item.name,
          item.summary,
          CATEGORY_LABELS[item.category],
          HARNESS_LABELS[item.recommendedHarness],
          release.manifest.contributorName ?? "",
          ...item.keywords,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      })
      .sort((a, b) => b.addedAt - a.addedAt);
  }, [category, harness, query, releases]);

  const pageCount = Math.max(1, Math.ceil(filteredReleases.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedReleases = filteredReleases.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const totalDownloads = releases.reduce((total, release) => total + release.downloadCount, 0);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (category !== "all") params.set("topic", category);
    if (harness !== "all") params.set("harness", harness);
    if (safePage > 1) params.set("page", String(safePage));
    const search = params.toString();
    window.history.replaceState(window.history.state, "", search ? `/?${search}` : "/");
  }, [category, harness, query, safePage]);

  const updateQuery = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  const updateCategory = (value: "all" | AgentCategory) => {
    setCategory(value);
    setPage(1);
  };

  const updateHarness = (value: "all" | AgentHarness) => {
    setHarness(value);
    setPage(1);
  };

  const goToPage = (nextPage: number) => {
    const targetPage = Math.min(Math.max(nextPage, 1), pageCount);
    setPage(targetPage);
    requestAnimationFrame(() => catalogRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const updateDownloadCount = (releaseKey: string, downloadCount: number) => {
    setReleases((current) => current.map((release) => release.key === releaseKey
      ? { ...release, downloadCount }
      : release));
  };

  const startCategoryDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    categoryDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      moved: false,
      suppressClick: false,
    };
  };

  const moveCategoryDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = categoryDragRef.current;
    if (event.pointerId !== drag.pointerId) return;
    const delta = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(delta) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      setCategoryDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.currentTarget.scrollLeft = drag.scrollLeft - delta;
  };

  const finishCategoryDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = categoryDragRef.current;
    if (event.pointerId !== drag.pointerId) return;
    if (drag.moved) drag.suppressClick = true;
    drag.pointerId = -1;
    setCategoryDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="site-shell">
      <header className="hero-skin home-skin" id="top">
        <SiteNav current="home" />
        <section className="intro">
          <div>
            <p className="eyebrow">{releases.length} ready to use Buzz agents</p>
            <h1>Ready agents<br />for Buzz.</h1>
          </div>
          <div className="intro-copy">
            <p>Choose an agent for the job, verify the exact file in your browser, then import it into Buzz.</p>
            <div className="principles" aria-label="HiveBuzz principles">
              <span><LockKeyhole size={15} aria-hidden="true" /> No login</span>
              <span><ShieldCheck size={15} aria-hidden="true" /> Checked locally</span>
              <span><PackageCheck size={15} aria-hidden="true" /> Never runs here</span>
            </div>
          </div>
        </section>
      </header>

      <main>
        <section id="agents" ref={catalogRef} className="agent-directory" aria-labelledby="directory-title">
          <div className="directory-heading">
            <div>
              <p className="eyebrow">Ready for Buzz</p>
              <h2 id="directory-title">Find your agent</h2>
              <p>Each agent is a portable, stopped snapshot. Nothing runs until you review and start it in Buzz.</p>
            </div>
            <Link className="button button-outline" href="/contribute"><Upload size={15} aria-hidden="true" /> Add your agent</Link>
          </div>

          <div className="directory-controls">
            <label className="directory-search">
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">Search agents</span>
              <input value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Search agents" />
              {query ? <button type="button" onClick={() => updateQuery("")} aria-label="Clear search"><X size={15} /></button> : null}
            </label>
            <label className="harness-filter">
              <span>Works with</span>
              <select value={harness} onChange={(event) => updateHarness(event.target.value as "all" | AgentHarness)}>
                <option value="all">Any harness</option>
                {Object.entries(HARNESS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>

          <div
            className={`category-filter directory-categories ${categoryDragging ? "dragging" : ""}`}
            aria-label="Agent category"
            role="group"
            onPointerDown={startCategoryDrag}
            onPointerMove={moveCategoryDrag}
            onPointerUp={finishCategoryDrag}
            onPointerCancel={finishCategoryDrag}
            onClickCapture={(event) => {
              if (!categoryDragRef.current.suppressClick) return;
              categoryDragRef.current.suppressClick = false;
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <button type="button" className={category === "all" ? "active" : ""} onClick={() => updateCategory("all")} aria-pressed={category === "all"}>All topics</button>
            {AGENT_CATEGORIES.map((item) => (
              <button key={item} type="button" className={category === item ? "active" : ""} onClick={() => updateCategory(item)} aria-pressed={category === item}>{CATEGORY_LABELS[item]}</button>
            ))}
          </div>
          <p className="sr-only" aria-live="polite">{category === "all" ? "All topics" : CATEGORY_LABELS[category]} filter selected</p>

          <div className="directory-results" aria-live="polite">
            <span>{filteredReleases.length} agent{filteredReleases.length === 1 ? "" : "s"}</span>
            <span>{numberFormatter.format(totalDownloads)} total downloads</span>
          </div>

          {pagedReleases.length ? (
            <div className="agent-grid">
              {pagedReleases.map((release) => {
                const item = release.manifest.release;
                return (
                  <article className="agent-card" key={release.key}>
                    <Link className="agent-card-main" href={`/agents/${item.id.split(".").pop()}`} aria-label={`View ${item.name} details`}>
                      <span className="agent-card-heading">
                        <span className="agent-card-mark" aria-hidden="true"><Bot size={18} /></span>
                        <span className="agent-card-tags">
                          <span className="category-pill">{CATEGORY_LABELS[item.category]}</span>
                          <RiskLabel release={release} />
                        </span>
                      </span>
                      <strong className="agent-card-name">{item.name}</strong>
                      <span className="agent-card-summary">{item.summary}</span>
                      <span className="agent-card-runtime">{HARNESS_LABELS[item.recommendedHarness]} · {item.recommendedModel}</span>
                      <span className="agent-card-surface"><LockKeyhole size={13} aria-hidden="true" /> No memory <span>·</span> No bundled tools</span>
                    </Link>
                    <div className="agent-card-actions">
                      <span className="download-count"><Download size={13} aria-hidden="true" /> {numberFormatter.format(release.downloadCount)}</span>
                      <button className="button button-dark" type="button" onClick={() => setInstallRelease(release)}><ShieldCheck size={15} aria-hidden="true" /> Get agent</button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="directory-empty">
              <Search size={26} aria-hidden="true" />
              <strong>No matching agents</strong>
              <span>Try a broader search or clear the filters.</span>
              <button className="button button-outline" type="button" onClick={() => { updateQuery(""); updateCategory("all"); updateHarness("all"); }}>Clear filters</button>
            </div>
          )}

          {filteredReleases.length > PAGE_SIZE ? (
            <nav className="catalog-pagination directory-pagination" aria-label="Agent pages">
              <button type="button" onClick={() => goToPage(safePage - 1)} disabled={safePage === 1} aria-label="Previous agent page"><ChevronLeft size={15} aria-hidden="true" /></button>
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                <button
                  type="button"
                  key={pageNumber}
                  className={pageNumber === safePage ? "active" : ""}
                  aria-current={pageNumber === safePage ? "page" : undefined}
                  aria-label={`Agent page ${pageNumber}`}
                  onClick={() => goToPage(pageNumber)}
                >
                  {pageNumber}
                </button>
              ))}
              <button type="button" onClick={() => goToPage(safePage + 1)} disabled={safePage === pageCount} aria-label="Next agent page"><ChevronRight size={15} aria-hidden="true" /></button>
            </nav>
          ) : null}
        </section>

        <section className="how-it-works" aria-labelledby="how-title">
          <div>
            <p className="eyebrow">Built for the Buzz workflow</p>
            <h2 id="how-title">Download first. Trust last.</h2>
            <Link className="guide-link" href="/guide">Read the full export and import guide</Link>
            <Link className="guide-link" href="/contribute">Made an agent? Scan and submit it for review <Upload size={13} /></Link>
          </div>
          <ol>
            <li><span>1</span><div><strong>Choose</strong><p>No account or wallet.</p></div></li>
            <li><span>2</span><div><strong>Verify</strong><p>Exact bytes checked locally.</p></div></li>
            <li><span>3</span><div><strong>Import</strong><p>Review once more in Buzz.</p></div></li>
          </ol>
        </section>
      </main>

      <SiteFooter />

      <InstallDialog
        key={installRelease?.key ?? "install-closed"}
        release={installRelease}
        onClose={() => setInstallRelease(null)}
        onNotice={setNotice}
        onCounted={updateDownloadCount}
      />

      {notice ? <div className={`notice notice-${notice.tone}`} role="status">{notice.message}</div> : null}
    </div>
  );
}
