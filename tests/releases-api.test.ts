import assert from "node:assert/strict";
import test from "node:test";
import { getReleaseResponse } from "../app/api/releases/route";

const QUIET_RESEARCHER_KEY = "agent:agent.quiet-researcher@1.0.0";

function databaseWithCounts(statements: string[]) {
  return {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind() {
          return {
            async all() {
              return { results: [{ release_key: QUIET_RESEARCHER_KEY, count: 9 }] };
            },
          };
        },
      };
    },
  } as unknown as Pick<D1Database, "prepare">;
}

test("serves a cached count only catalog refresh without manifest database reads", async () => {
  const statements: string[] = [];
  const response = await getReleaseResponse(
    new Request("https://hivebuzz.xyz/api/releases?view=counts"),
    databaseWithCounts(statements),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=30/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const text = await response.text();
  assert.ok(Buffer.byteLength(text) < 1_000);
  const payload = JSON.parse(text) as { downloadCounts: Record<string, number> };
  assert.equal(payload.downloadCounts[QUIET_RESEARCHER_KEY], 9);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /FROM downloads/);
  assert.doesNotMatch(statements[0], /manifest_json|FROM releases/);
});

test("keeps the full compatibility catalog while sourcing manifests from code", async () => {
  const statements: string[] = [];
  const response = await getReleaseResponse(
    new Request("https://hivebuzz.xyz/api/releases"),
    databaseWithCounts(statements),
  );
  const payload = await response.json() as { releases: Array<{ key: string; downloadCount: number }> };

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.releases.length, 10);
  assert.equal(payload.releases.find((release) => release.key === QUIET_RESEARCHER_KEY)?.downloadCount, 9);
  assert.equal(statements.length, 1);
});
