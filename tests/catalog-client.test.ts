import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalogDownloadCounts, mergeDownloadCounts } from "../lib/catalog-client";
import { CATALOG_RELEASES } from "../lib/catalog-seeds";

test("deduplicates concurrent catalog count requests", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ downloadCounts: { [CATALOG_RELEASES[0].key]: 7 } });
  };

  try {
    const [first, second] = await Promise.all([
      loadCatalogDownloadCounts(),
      loadCatalogDownloadCounts(),
    ]);
    assert.equal(calls, 1);
    assert.equal(first[CATALOG_RELEASES[0].key], 7);
    assert.deepEqual(second, first);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("merges only valid aggregate counts into the server catalog", () => {
  const releases = CATALOG_RELEASES.slice(0, 2);
  const merged = mergeDownloadCounts(releases, { [releases[0].key]: 12 });

  assert.equal(merged[0].downloadCount, 12);
  assert.equal(merged[1], releases[1]);
  assert.equal(releases[0].downloadCount, 0);

  const locallyNewer = [{ ...releases[0], downloadCount: 20 }];
  assert.equal(mergeDownloadCounts(locallyNewer, { [releases[0].key]: 12 })[0].downloadCount, 20);
});
