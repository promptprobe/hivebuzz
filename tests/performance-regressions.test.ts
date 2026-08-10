import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("keeps the catalog bootstrap count only and shared", async () => {
  const [app, footer, client, route] = await Promise.all([
    readFile(new URL("../components/hive-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/site-footer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/catalog-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/releases/route.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(app, /fetch\(["']\/api\/releases/);
  assert.doesNotMatch(footer, /fetch\(["']\/api\/releases/);
  assert.equal((client.match(/fetch\(["']\/api\/releases\?view=counts/g) ?? []).length, 1);
  assert.doesNotMatch(route, /ensureCatalog|manifest_json|validateManifest/);
  assert.match(route, /s-maxage=30/);
});

test("keeps responsive hero images within the measured byte budgets", async () => {
  const budgets = new Map([
    ["hivebuzz-hero-dotted-v2.webp", 500_000],
    ["hivebuzz-guide-dotted-v2.webp", 400_000],
    ["hivebuzz-submit-dotted-v2.webp", 350_000],
    ["hivebuzz-hero-dotted-mobile-v2.webp", 150_000],
    ["hivebuzz-guide-dotted-mobile-v2.webp", 150_000],
    ["hivebuzz-submit-dotted-mobile-v2.webp", 150_000],
  ]);

  for (const [filename, maximum] of budgets) {
    const details = await stat(new URL(`../public/${filename}`, import.meta.url));
    assert.ok(details.size <= maximum, `${filename} is ${details.size} bytes; budget is ${maximum}.`);
  }
});

test("avoids request dependent metadata and eager webfont loading", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /next\/headers|next\/font|generateMetadata|Geist_Mono/);
});
