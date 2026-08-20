import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "./agent-page.css";
import {
  ArrowLeft,
  Bot,
  Check,
  ExternalLink,
  FileText,
  FolderLock,
  Hash,
  LockKeyhole,
  Network,
  PackageCheck,
  Plug,
  TerminalSquare,
} from "lucide-react";
import Link from "next/link";
import { AgentDownloadCount } from "@/components/agent-download-count";
import { AgentGetButton } from "@/components/agent-install";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { AGENT_INSTRUCTION_PREVIEWS, type AgentInstructionPreview } from "@/lib/agent-instruction-previews.generated";
import { CATALOG_RELEASES } from "@/lib/catalog-seeds";
import type { AgentCategory, AgentHarness, ReleaseRecord } from "@/lib/hive-contract";

const origin = "https://hivebuzz.xyz";
const numberFormatter = new Intl.NumberFormat("en-US");
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
const PROMPT_SECTIONS: Array<keyof AgentInstructionPreview> = [
  "Role",
  "Scope",
  "Workflow",
  "Evidence rules",
  "Output contract",
  "Authority boundary",
  "Stop condition",
];

function slugFor(release: ReleaseRecord) {
  return release.manifest.release.id.split(".").pop() ?? release.manifest.release.id;
}

function releaseFor(slug: string) {
  return CATALOG_RELEASES.find((release) => slugFor(release) === slug);
}

export function generateStaticParams() {
  return CATALOG_RELEASES.map((release) => ({ slug: slugFor(release) }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const release = releaseFor(slug);
  if (!release) return {};
  const item = release.manifest.release;
  const title = `${item.name} for Buzz | HiveBuzz`;
  const description = item.summary;
  const url = `${origin}/agents/${slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", images: [] },
    twitter: { card: "summary", title, description, images: [] },
  };
}

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const release = releaseFor(slug);
  if (!release) notFound();

  const item = release.manifest.release;
  const preview = AGENT_INSTRUCTION_PREVIEWS[release.key];
  if (!preview) notFound();
  const related = CATALOG_RELEASES
    .filter((candidate) => candidate.key !== release.key && candidate.manifest.release.category === item.category)
    .slice(0, 2);

  return (
    <div className="site-shell agent-page-shell">
      <header className="hero-skin agent-page-header">
        <SiteNav current="agent" />
      </header>

      <main className="agent-page-main">
        <Link className="agent-page-back" href="/#agents"><ArrowLeft size={15} aria-hidden="true" /> All agents</Link>

        <section className="agent-page-hero" aria-labelledby="agent-title">
          <div className="agent-page-identity">
            <span className="agent-page-glyph" aria-hidden="true"><Bot size={26} /></span>
            <div>
              <div className="agent-page-kicker">
                <span>{CATEGORY_LABELS[item.category]}</span>
                <span>No tools</span>
                <span>v{item.version}</span>
              </div>
              <h1 id="agent-title">{item.name}</h1>
              <p>{item.summary}</p>
            </div>
          </div>
          <div className="agent-page-hero-actions">
            <AgentGetButton release={release} label="Verify and get agent" />
            {item.homepage ? (
              <a className="button button-outline button-large" href={item.homepage} target="_blank" rel="noopener noreferrer">Source <ExternalLink size={15} aria-hidden="true" /></a>
            ) : null}
          </div>
          <dl className="agent-page-meta">
            <div><dt>Contributed by</dt><dd>{release.manifest.contributorName ?? "Community contributor"}</dd></div>
            <div><dt>Downloads</dt><dd><AgentDownloadCount releaseKey={release.key} initialCount={release.downloadCount} /></dd></div>
            <div><dt>License</dt><dd>{item.license}</dd></div>
            <div><dt>Buzz</dt><dd>{item.engines.buzz.replace(">=", "")} or newer</dd></div>
          </dl>
        </section>

        <div className="agent-page-layout">
          <div className="agent-page-content">
            <section className="agent-page-section">
              <p className="section-label">What it does</p>
              <h2>What this agent handles.</h2>
              <p className="agent-page-description">{item.description}</p>
            </section>

            <section className="agent-page-section agent-prompt-section" aria-labelledby="instructions-title">
              <div className="agent-page-section-heading">
                <div>
                  <p className="section-label">Exact instructions</p>
                  <h2 id="instructions-title">Read the behavior before you download.</h2>
                </div>
                <span><FileText size={15} aria-hidden="true" /> Public snapshot prompt</span>
              </div>
              <div className="agent-prompt-preview">
                {PROMPT_SECTIONS.map((section) => (
                  <section key={section}>
                    <h3>[{section}]</h3>
                    <p>{preview[section]}</p>
                  </section>
                ))}
              </div>
            </section>

            <section className="agent-page-section">
              <p className="section-label">Before download</p>
              <div className="agent-page-checks">
                <div><Hash size={18} aria-hidden="true" /><span><strong>Exact SHA 256 pinned</strong><small>A one byte change blocks the handoff.</small></span></div>
                <div><LockKeyhole size={18} aria-hidden="true" /><span><strong>Private state excluded</strong><small>Memory, credentials, allowlists, and remote avatars are rejected.</small></span></div>
                <div><PackageCheck size={18} aria-hidden="true" /><span><strong>Nothing runs here</strong><small>Buzz shows the final import review before you start the agent.</small></span></div>
              </div>
            </section>
          </div>

          <aside className="agent-page-sidebar">
            <section>
              <p className="section-label">Recommended runtime</p>
              <dl className="agent-runtime-list">
                <div><dt>Works with</dt><dd>{HARNESS_LABELS[item.recommendedHarness]}</dd></div>
                <div><dt>Model</dt><dd>{item.recommendedModel}</dd></div>
              </dl>
              <p className="agent-sidebar-note">Recommendation only. HiveBuzz never chooses credentials or enforces a model.</p>
            </section>

            <section>
              <p className="section-label">Declared surface</p>
              <div className="agent-surface-list">
                <div><Network size={17} aria-hidden="true" /><span><small>Network</small><strong>No declared hosts</strong></span></div>
                <div><FolderLock size={17} aria-hidden="true" /><span><small>Filesystem</small><strong>No access</strong></span></div>
                <div><Plug size={17} aria-hidden="true" /><span><small>Tools</small><strong>None</strong></span></div>
                <div><TerminalSquare size={17} aria-hidden="true" /><span><small>Executable</small><strong>None</strong></span></div>
              </div>
            </section>

            <section className="agent-digest-card">
              <p className="section-label">Catalog record</p>
              <div><Check size={16} aria-hidden="true" /> Exact artifact registered</div>
              <code>{release.manifest.artifact.sha256}</code>
              <small>{numberFormatter.format(release.manifest.artifact.sizeBytes)} bytes</small>
            </section>

            {related.length ? (
              <section>
                <p className="section-label">More in {CATEGORY_LABELS[item.category]}</p>
                <div className="related-agents">
                  {related.map((candidate) => (
                    <Link key={candidate.key} href={`/agents/${slugFor(candidate)}`}>
                      <strong>{candidate.manifest.release.name}</strong>
                      <span>{candidate.manifest.release.summary}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </aside>
        </div>

        <section className="agent-page-final-cta">
          <div><p className="eyebrow">Ready for Buzz</p><h2>Verify the exact file. Import when you are ready.</h2></div>
          <AgentGetButton release={release} label="Get this agent" />
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
