import { gzipSync } from "node:zlib";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { getReleaseResponse } from "../app/api/releases/route";

const root = resolve(import.meta.dirname, "..");
const distClient = join(root, "dist/client");
const label = process.argv.find((argument) => argument.startsWith("--label="))?.slice(8) ?? "current";
const outputArgument = process.argv.find((argument) => argument.startsWith("--output="))?.slice(9);
const outputPath = resolve(root, outputArgument ?? `benchmarks/${label}.json`);
const enforceBudgets = process.argv.includes("--check");

interface ManifestEntry {
  file: string;
  imports?: string[];
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
}

function byteLength(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

async function measureRendering() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("benchmark", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };
  const render = async () => {
    const started = performance.now();
    const response = await worker.fetch(
      new Request("https://hivebuzz.xyz/", { headers: { accept: "text/html" } }),
      env,
      context,
    );
    const html = await response.text();
    if (!response.ok) throw new Error(`Home render failed with ${response.status}.`);
    return { milliseconds: performance.now() - started, html };
  };

  for (let index = 0; index < 5; index += 1) await render();
  const samples: number[] = [];
  let html = "";
  for (let index = 0; index < 30; index += 1) {
    const result = await render();
    samples.push(result.milliseconds);
    html = result.html;
  }
  const preloadTags = [...html.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g)].map((match) => match[0]);
  const preloadedFonts = preloadTags
    .filter((tag) => /\bas="font"/.test(tag))
    .map((tag) => /\bhref="([^"]+)"/.exec(tag)?.[1])
    .filter((href): href is string => Boolean(href));
  const packagedFontPaths = (await walk(distClient)).filter((path) => path.endsWith(".woff2"));
  const packagedFontBytes = new Map<string, number>(await Promise.all(packagedFontPaths.map(async (path) => [
    basename(path),
    (await stat(path)).size,
  ] as const)));
  const preloadedFontBytes = (await Promise.all(preloadedFonts.map(async (href) => {
    try {
      return (await stat(join(distClient, href.replace(/^\//, "")))).size;
    } catch {
      return packagedFontBytes.get(basename(href)) ?? 0;
    }
  }))).reduce((sum, bytes) => sum + bytes, 0);
  const preloadedImages = preloadTags
    .filter((tag) => /\bas="image"/.test(tag))
    .map((tag) => /\bhref="([^"]+)"/.exec(tag)?.[1])
    .filter((href): href is string => Boolean(href));

  return {
    samples: samples.length,
    p50Ms: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    htmlBytes: byteLength(html),
    htmlGzipBytes: gzipSync(html).byteLength,
    preloadedFontFileCount: preloadedFonts.length,
    preloadedFontBytes,
    absoluteWorkspacePreloadCount: preloadedFonts.filter((href) => href.startsWith(root)).length,
    preloadedImageHrefs: preloadedImages,
  };
}

async function measureClientAssets() {
  const manifestPath = join(distClient, ".vite/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, ManifestEntry>;
  const roots = [
    "virtual:vinext-app-browser-entry",
    "virtual:vite-rsc/client-references/group/facade:virtual:cloudflare/worker-entry",
  ];
  const visited = new Set<string>();

  function visit(key: string) {
    if (visited.has(key)) return;
    const entry = manifest[key];
    if (!entry) return;
    visited.add(key);
    for (const dependency of entry.imports ?? []) visit(dependency);
  }
  roots.forEach(visit);

  const javascript = await Promise.all([...visited].map(async (key) => {
    const contents = await readFile(join(distClient, manifest[key].file));
    return { file: manifest[key].file, rawBytes: contents.byteLength, gzipBytes: gzipSync(contents).byteLength };
  }));
  const cssPaths = (await walk(join(distClient, "assets"))).filter((path) => path.endsWith(".css"));
  const css = await Promise.all(cssPaths.map(async (path) => {
    const contents = await readFile(path);
    return { file: relative(distClient, path), rawBytes: contents.byteLength, gzipBytes: gzipSync(contents).byteLength };
  }));
  const fontPaths = (await walk(distClient)).filter((path) => path.endsWith(".woff2"));
  const fonts = await Promise.all(fontPaths.map(async (path) => ({
    file: relative(distClient, path),
    bytes: (await stat(path)).size,
  })));

  return {
    initialJavascriptFiles: javascript.map((entry) => entry.file).sort(),
    initialJavascriptRawBytes: javascript.reduce((sum, entry) => sum + entry.rawBytes, 0),
    initialJavascriptGzipBytes: javascript.reduce((sum, entry) => sum + entry.gzipBytes, 0),
    cssRawBytes: css.reduce((sum, entry) => sum + entry.rawBytes, 0),
    cssGzipBytes: css.reduce((sum, entry) => sum + entry.gzipBytes, 0),
    fontFileCount: fonts.length,
    fontBytes: fonts.reduce((sum, entry) => sum + entry.bytes, 0),
    monoFontFileCount: fonts.filter((entry) => entry.file.includes("geist-mono")).length,
    monoFontBytes: fonts.filter((entry) => entry.file.includes("geist-mono")).reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

async function measureCatalogBootstrap() {
  const sourcePaths = [
    join(root, "components/hive-app.tsx"),
    join(root, "components/site-footer.tsx"),
    join(root, "lib/catalog-client.ts"),
  ];
  const sources = await Promise.all(sourcePaths.map(async (path) => {
    try {
      return await readFile(path, "utf8");
    } catch {
      return "";
    }
  }));
  const urls = sources.flatMap((source) => [...source.matchAll(/fetch\(["'](\/api\/releases[^"']*)["']/g)].map((match) => match[1]));
  const database = {
    prepare() {
      return {
        bind() {
          return { all: async () => ({ results: [] }) };
        },
      };
    },
  };
  const fetchPayload = async (pathname: string) => {
    const response = await getReleaseResponse(
      new Request(`https://hivebuzz.xyz${pathname}`, { headers: { accept: "application/json" } }),
      database as unknown as Pick<D1Database, "prepare">,
    );
    const text = await response.text();
    if (!response.ok) throw new Error(`${pathname} failed with ${response.status}.`);
    return { bytes: byteLength(text), cacheControl: response.headers.get("cache-control") };
  };
  const [fullPayload, countPayload] = await Promise.all([
    fetchPayload("/api/releases"),
    fetchPayload("/api/releases?view=counts"),
  ]);

  return {
    staticRequestCallSites: urls.length,
    requestUrls: urls,
    fullCatalogResponseBytes: fullPayload.bytes,
    countSummaryResponseBytes: countPayload.bytes,
    countSummaryCacheControl: countPayload.cacheControl,
    estimatedBootstrapTransferBytes: urls.reduce(
      (sum, url) => sum + (url.includes("view=counts") ? countPayload.bytes : fullPayload.bytes),
      0,
    ),
  };
}

async function publicAssetBytes(filename: string) {
  const path = join(root, "public", filename);
  return (await stat(path)).size;
}

const cssSource = await readFile(join(root, "app/globals.css"), "utf8");
const imageNames = [...cssSource.matchAll(/url\(["']?\/(hivebuzz-(?:hero|guide|submit)-dotted[^"')]*\.webp)["']?\)/g)]
  .map((match) => match[1]);
const uniqueImages = [...new Set(imageNames)];
const images: Record<string, number> = Object.fromEntries(await Promise.all(
  uniqueImages.map(async (filename) => [basename(filename), await publicAssetBytes(filename)] as const),
));

const report = {
  label,
  generatedAt: new Date().toISOString(),
  node: process.version,
  rendering: await measureRendering(),
  client: await measureClientAssets(),
  catalogBootstrap: await measureCatalogBootstrap(),
  heroImages: images,
  referencedHeroAssetInventoryBytes: Object.values(images).reduce((sum, bytes) => sum + bytes, 0),
};

const desktopMajorInitialBytes = report.rendering.htmlGzipBytes
  + report.client.initialJavascriptGzipBytes
  + report.client.cssGzipBytes
  + report.rendering.preloadedFontBytes
  + (images["hivebuzz-hero-dotted-v2.webp"] ?? 0)
  + report.catalogBootstrap.estimatedBootstrapTransferBytes;
const mobileMajorInitialBytes = report.rendering.htmlGzipBytes
  + report.client.initialJavascriptGzipBytes
  + report.client.cssGzipBytes
  + report.rendering.preloadedFontBytes
  + (images["hivebuzz-hero-dotted-mobile-v2.webp"] ?? 0)
  + report.catalogBootstrap.estimatedBootstrapTransferBytes;

if (enforceBudgets) {
  const failures: string[] = [];
  const maximum = (name: string, actual: number, limit: number) => {
    if (actual > limit) failures.push(`${name} is ${actual}; budget is ${limit}.`);
  };
  maximum("Home HTML gzip", report.rendering.htmlGzipBytes, 10_000);
  maximum("Initial JavaScript gzip", report.client.initialJavascriptGzipBytes, 105_000);
  maximum("CSS gzip", report.client.cssGzipBytes, 10_000);
  maximum("Preloaded fonts", report.rendering.preloadedFontBytes, 0);
  maximum("Absolute workspace preloads", report.rendering.absoluteWorkspacePreloadCount, 0);
  maximum("Catalog request call sites", report.catalogBootstrap.staticRequestCallSites, 1);
  maximum("Catalog bootstrap estimate", report.catalogBootstrap.estimatedBootstrapTransferBytes, 1_000);
  maximum("Desktop home hero", images["hivebuzz-hero-dotted-v2.webp"] ?? Number.POSITIVE_INFINITY, 500_000);
  maximum("Mobile home hero", images["hivebuzz-hero-dotted-mobile-v2.webp"] ?? Number.POSITIVE_INFINITY, 150_000);
  maximum("Desktop major initial bytes", desktopMajorInitialBytes, 650_000);
  maximum("Mobile major initial bytes", mobileMajorInitialBytes, 300_000);
  if (failures.length) throw new Error(`Performance budget failed:\n${failures.join("\n")}`);
}

await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`\nSaved ${relative(root, outputPath)}`);
