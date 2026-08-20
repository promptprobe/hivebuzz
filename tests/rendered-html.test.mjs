import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished HiveBuzz product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const contentSecurityPolicy = response.headers.get("content-security-policy") ?? "";
  assert.match(contentSecurityPolicy, /default-src 'self'/);
  assert.match(contentSecurityPolicy, /connect-src 'self'/);
  assert.doesNotMatch(contentSecurityPolicy, /script-src[^;]*'unsafe-inline'/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");

  const html = await response.text();
  const nonce = /script-src[^;]*'nonce-([^']+)'/.exec(contentSecurityPolicy)?.[1];
  assert.ok(nonce);
  assert.match(html, new RegExp(`<script[^>]+nonce="${nonce}"`));
  assert.match(html, /<html lang="en">/i);
  assert.match(html, /<title>hivebuzz - Open Buzz Agent Library<\/title>/i);
  assert.match(html, /Ready agents/);
  assert.match(html, /for Buzz/);
  assert.match(html, /Choose an agent for the job/);
  assert.match(html, /24(?:<!-- -->)? ready to use Buzz agents/i);
  assert.match(html, /hivebuzz/);
  assert.match(html, /href="https:\/\/buzz\.xyz"/);
  assert.match(html, /<span>Buzz<\/span>/);
  assert.match(html, /Code Reviewer/);
  assert.match(html, /Evidence Mapper/);
  assert.match(html, /Option Comparator/);
  assert.match(html, /Spec Auditor/);
  assert.match(html, /Bug Triage/);
  assert.match(html, /Reader Tester/);
  assert.match(html, /UX Flow Reviewer/);
  assert.match(html, /Accessibility Reviewer/);
  assert.equal((html.match(/class="agent-card"/g) ?? []).length, 12);
  assert.match(html, /Codex/);
  assert.match(html, /Provider default/);
  assert.doesNotMatch(html, /Release Scout|Persona Packs|\.buzzpack/);
  assert.match(html, /No login/);
  assert.match(html, /0(?:<!-- -->)? total downloads/);
  assert.match(html, /aria-label="Add agent"/);
  assert.match(html, /Add agent/);
  assert.match(html, /placeholder="Search agents"/);
  assert.doesNotMatch(html, /Explore<\/a>|id="explore"|\.xyz · for Buzz/);
  assert.match(html, /All topics/);
  assert.match(html, /aria-pressed="true"[^>]*>All topics/);
  assert.match(html, /aria-label="Agent page 2"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /Get agent/);
  assert.match(html, /href="\/agents\/quiet-researcher"/);
  assert.doesNotMatch(html, />Withdraw<\/a>/);
  assert.match(html, /Research/);
  assert.match(html, /Read the full export and import guide/);
  assert.match(html, /Privacy_Protocol/);
  assert.match(html, /Terms_of_Use/);
  assert.match(html, /href="https:\/\/github\.com\/promptprobe\/hivebuzz\/blob\/main\/CONTRIBUTING\.md"/);
  assert.match(html, /Contribute_hivebuzz/);
  assert.match(html, /Withdraw_Agent/);
  assert.doesNotMatch(html, /Connect signer|Give Honey|Sign & publish|Recent signed/i);
  assert.match(html, /<meta property="og:url" content="https?:\/\/[^\"]+\/\?card=20260803-final"\/>/);
  assert.match(html, /<meta property="og:image" content="https?:\/\/[^\"]+\/hivebuzz-social-card-20260803\.png\?card=20260803-final"\/>/);
  assert.match(html, /<meta name="twitter:image" content="https?:\/\/[^\"]+\/hivebuzz-social-card-20260803\.png\?card=20260803-final"\/>/);
  assert.match(html, /href="\/hivebuzz-hero-dotted-mobile-v2\.webp"/);
  assert.match(html, /href="\/hivebuzz-hero-dotted-v2\.webp"/);
  assert.doesNotMatch(html, /<link[^>]+rel="preload"[^>]+as="font"/);
  assert.doesNotMatch(html, /\/Users\/[^\"]+\.woff2/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("server-renders a shareable agent page with exact instructions", async () => {
  const response = await render("/agents/quiet-researcher");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Quiet Researcher for Buzz \| HiveBuzz<\/title>/);
  assert.match(html, /Verify and get agent/);
  assert.match(html, /Read the behavior before you download/);
  assert.match(html, /\[(?:<!-- -->)?Role(?:<!-- -->)?\]/);
  assert.match(html, /\[(?:<!-- -->)?Authority boundary(?:<!-- -->)?\]/);
  assert.match(html, /No declared hosts/);
  assert.match(html, /Exact artifact registered/);
  assert.match(html, /rel="canonical" href="https:\/\/hivebuzz\.xyz\/agents\/quiet-researcher"/);
  assert.doesNotMatch(html, /<meta property="og:image"/);
});

test("adds the common security headers to optimized image responses", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("image-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const response = await worker.fetch(
    new Request("http://localhost/_vinext/image?url=%2Fhive-mark.png&w=64&q=75", {
      headers: { accept: "image/png" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response(image, { status: 200, headers: { "content-type": "image/png" } }),
      },
      IMAGES: {
        input() {
          return {
            transform() {
              return {
                output: async () => ({
                  response: () => new Response(image, { status: 200, headers: { "content-type": "image/png" } }),
                }),
              };
            },
          };
        },
      },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") ?? "", /script-src 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
});

test("server-renders the privacy and terms routes", async () => {
  const [privacyResponse, termsResponse] = await Promise.all([render("/privacy"), render("/terms")]);
  assert.equal(privacyResponse.status, 200);
  assert.equal(termsResponse.status, 200);

  const [privacyHtml, termsHtml] = await Promise.all([privacyResponse.text(), termsResponse.text()]);
  assert.match(privacyHtml, /Minimal data by design/);
  assert.match(privacyHtml, /Local file inspection/);
  assert.match(privacyHtml, /Checking Catalog/);
  assert.match(termsHtml, /Download first\. Trust last\./);
  assert.match(termsHtml, /No automatic execution/);
  assert.match(termsHtml, /Contribute_hivebuzz/);
});

test("server-renders the English Snapshot guide with safety defaults", async () => {
  const response = await render("/guide");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Export safely/);
  assert.match(html, /hero-skin guide-skin/);
  assert.equal(html.includes("Agent only + JSON"), true);
  assert.match(html, /Export Agent/);
  assert.match(html, /No login or signing/);
  assert.match(html, /Fresh keypair/);
  assert.match(html, /Clear allowlist/);
  assert.doesNotMatch(html, /Connect signer|Give Honey|Sign & publish/i);
});

test("server-renders the local-first agent registration flow", async () => {
  const response = await render("/contribute");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Register your/);
  assert.match(html, /hero-skin submit-skin/);
  assert.match(html, /HiveBuzz never receives the file from this page/);
  assert.match(html, /Local scan first/);
  assert.match(html, /Public GitHub identity/);
  assert.match(html, /GitHub handle/);
  assert.match(html, /Source commit/);
  assert.match(html, /Recommended harness/);
  assert.match(html, /Recommended model/);
  assert.match(html, /Open downloads/);
  assert.match(html, /Pull request path/);
  assert.doesNotMatch(html, /Pull-request path/);
  assert.match(html, /Open GitHub request/);
  assert.doesNotMatch(html, /Nostr sign|Connect wallet|Upload to HiveBuzz/i);
});

test("reference Agent Snapshot is public-safe and digest pinned", async () => {
  const snapshotUrl = new URL("../public/agents/quiet-researcher-1.0.0.agent.json", import.meta.url);
  const bytes = await readFile(snapshotUrl);
  assert.equal(bytes.byteLength, 725);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "97d1d095bd27ebf8430ff95b36ae5e8591ebc01fdffed3394598688c32cf166c");
  const snapshot = JSON.parse(bytes.toString("utf8"));
  assert.equal(snapshot.format, "buzz-agent-snapshot");
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.memory, { level: "none" });
  assert.equal(snapshot.definition.respondToAllowlist, undefined);
  assert.equal(snapshot.profile.avatarUrl, undefined);
  assert.equal(JSON.stringify(snapshot).includes("nsec1"), false);
});

test("removes disposable starter assets and metadata", async () => {
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(packageJson, /nostr-tools/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await access(new URL("../public/hivebuzz-social-card-20260803.png", import.meta.url));
  await access(new URL("../public/icon.png", import.meta.url));
  await access(new URL("../public/hive-mark.png", import.meta.url));
  await access(new URL("../public/hivebuzz-guide-dotted-v2.webp", import.meta.url));
  await access(new URL("../public/hivebuzz-guide-dotted-mobile-v2.webp", import.meta.url));
  await access(new URL("../public/hivebuzz-submit-dotted-v2.webp", import.meta.url));
  await access(new URL("../public/hivebuzz-submit-dotted-mobile-v2.webp", import.meta.url));
  await assert.rejects(access(new URL("../public/hivebuzz-hero-dotted.webp", import.meta.url)));
  await assert.rejects(access(new URL("../public/hivebuzz-guide-dotted.webp", import.meta.url)));
  await assert.rejects(access(new URL("../public/hivebuzz-submit-dotted.webp", import.meta.url)));
});

test("Persona Pack distribution is removed", async () => {
  await assert.rejects(access(new URL("../public/packs/", import.meta.url)));
  await assert.rejects(access(new URL("../sample-packs/", import.meta.url)));
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.doesNotMatch(packageJson, /fflate/);
});

test("declares Apache-2.0 for the platform without relicensing listed agents", async () => {
  const [license, notice, packageJson, readme] = await Promise.all([
    readFile(new URL("../LICENSE", import.meta.url), "utf8"),
    readFile(new URL("../NOTICE", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(license, /Copyright 2026 promptprobe/);
  assert.match(notice, /HiveBuzz/);
  assert.equal(JSON.parse(packageJson).license, "Apache-2.0");
  assert.match(readme, /Listing or distributing an artifact through\s+HiveBuzz does not relicense it/);
});
