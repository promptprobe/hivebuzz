import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CATALOG_RELEASES } from "../lib/catalog-seeds";
import { recordFromManifest, releaseKeyFor, validateManifest } from "../lib/hive";
import { scanAgentSnapshot } from "../lib/snapshot-scan";

test("accepts every bounded catalog release with a stable key", () => {
  assert.equal(CATALOG_RELEASES.length, 24);
  assert.equal(new Set(CATALOG_RELEASES.map((release) => release.key)).size, CATALOG_RELEASES.length);

  const categoryCounts = new Map<string, number>();

  for (const release of CATALOG_RELEASES) {
    const validation = validateManifest(release.manifest, { allowRelativeArtifact: true });
    assert.equal(validation.ok, true, validation.errors.join(" "));
    assert.equal(release.key, releaseKeyFor(release.manifest));
    assert.equal(release.downloadCount, 0);
    assert.ok(["research", "development", "design", "operations", "data", "marketing", "security", "personal"].includes(release.manifest.release.category));
    categoryCounts.set(release.manifest.release.category, (categoryCounts.get(release.manifest.release.category) ?? 0) + 1);
    assert.deepEqual(recordFromManifest(release.manifest, release.addedAt), release);
  }
  assert.deepEqual([...categoryCounts.entries()].sort(), [
    ["data", 3],
    ["design", 3],
    ["development", 3],
    ["marketing", 3],
    ["operations", 3],
    ["personal", 3],
    ["research", 3],
    ["security", 3],
  ]);
});

test("rejects hidden fields, unsafe Agent capabilities, secrets, and bad artifact suffixes", () => {
  const base = structuredClone(CATALOG_RELEASES.find((release) => release.manifest.type === "agent")!.manifest);

  const hidden = { ...base, hiddenChannel: "arbitrary metadata" };
  assert.match(validateManifest(hidden, { allowRelativeArtifact: true }).errors.join(" "), /unsupported fields/i);

  const executable = structuredClone(base);
  executable.capabilities.commands = ["node unsafe.mjs"];
  assert.match(validateManifest(executable, { allowRelativeArtifact: true }).errors.join(" "), /cannot declare executable/i);

  const secret = structuredClone(base) as typeof base & { apiKey?: string };
  secret.apiKey = "sk-example-secret-value-that-must-never-ship";
  assert.match(validateManifest(secret, { allowRelativeArtifact: true }).errors.join(" "), /secret|unsupported/i);

  const badUrl = structuredClone(base);
  badUrl.artifact.url = "/agents/download";
  assert.match(validateManifest(badUrl, { allowRelativeArtifact: true }).errors.join(" "), /approved local catalog path|must end with/i);

  const badCategory = structuredClone(base) as unknown as { release: { category: string } };
  badCategory.release.category = "uncategorized";
  assert.match(validateManifest(badCategory, { allowRelativeArtifact: true }).errors.join(" "), /category is invalid/i);

  const badHarness = structuredClone(base) as unknown as { release: { recommendedHarness: string } };
  badHarness.release.recommendedHarness = "unknown-runtime";
  assert.match(validateManifest(badHarness, { allowRelativeArtifact: true }).errors.join(" "), /harness is invalid/i);

  const pack = structuredClone(base) as unknown as { type: string };
  pack.type = "pack";
  assert.match(validateManifest(pack, { allowRelativeArtifact: true }).errors.join(" "), /type must be agent/i);

  const missingSnapshot = structuredClone(base) as Partial<typeof base>;
  delete missingSnapshot.snapshot;
  assert.match(validateManifest(missingSnapshot, { allowRelativeArtifact: true }).errors.join(" "), /snapshot safety policy/i);

  const spoofed = structuredClone(base);
  spoofed.release.name = "Safe agent\u202Egpj.exe";
  assert.match(validateManifest(spoofed, { allowRelativeArtifact: true }).errors.join(" "), /control characters|Unicode direction/i);

  for (const hiddenCharacter of ["\u00ad", "\u3164"]) {
    const invisible = structuredClone(base);
    invisible.release.summary = `Safe${hiddenCharacter} looking summary text`;
    assert.match(validateManifest(invisible, { allowRelativeArtifact: true }).errors.join(" "), /invisible control characters/i);
  }

  const knownSecrets = [
    `AIza${"A".repeat(35)}`,
    `sk_live_${"A".repeat(24)}`,
    `ya29.${"A".repeat(30)}`,
    `npm_${"A".repeat(36)}`,
    Buffer.from("-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----").toString("base64"),
  ];
  for (const knownSecret of knownSecrets) {
    const leaked = structuredClone(base);
    leaked.release.description = `Credential sample ${knownSecret}`;
    assert.match(validateManifest(leaked, { allowRelativeArtifact: true }).errors.join(" "), /secret|private identity/i, knownSecret.slice(0, 12));
  }
});

test("every bundled catalog artifact passes the exact browser handoff scanner", async () => {
  for (const release of CATALOG_RELEASES) {
    const artifact = release.manifest.artifact;
    const fileName = artifact.url.split("/").pop()!;
    const bytes = await readFile(new URL(`../public${artifact.url}`, import.meta.url));
    const result = await scanAgentSnapshot(bytes, fileName, {
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      mediaType: artifact.mediaType,
    });
    assert.equal(result.ok, true, `${release.key}: ${result.hardErrors.join(" ")}`);
    assert.equal(result.sha256, artifact.sha256);
  }
});
