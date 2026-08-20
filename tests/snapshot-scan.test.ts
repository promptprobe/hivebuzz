import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { scanAgentSnapshot } from "../lib/snapshot-scan";

const referenceUrl = new URL("../public/agents/quiet-researcher-1.0.0.agent.json", import.meta.url);

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function pngChunk(type: string, data = new Uint8Array()) {
  const typeBytes = new TextEncoder().encode(type);
  return concat(u32(data.length), typeBytes, data, u32(crc32(concat(typeBytes, data))));
}

function snapshotPng(snapshotBytes: Uint8Array, extraText = false) {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = concat(u32(1), u32(1), new Uint8Array([8, 6, 0, 0, 0]));
  const keyword = new TextEncoder().encode("buzz_agent_snapshot\0");
  const encoded = new TextEncoder().encode(Buffer.from(snapshotBytes).toString("base64"));
  const comment = new TextEncoder().encode("comment\0hidden metadata");
  const pixels = new Uint8Array(deflateSync(new Uint8Array([0, 0, 0, 0, 0])));
  return concat(
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", concat(keyword, encoded)),
    ...(extraText ? [pngChunk("tEXt", comment)] : []),
    pngChunk("IDAT", pixels),
    pngChunk("IEND"),
  );
}

test("accepts the reference memory-free Agent Snapshot", async () => {
  const bytes = new Uint8Array(await readFile(referenceUrl));
  const result = await scanAgentSnapshot(bytes, "quiet-researcher.agent.json", {
    sha256: "97d1d095bd27ebf8430ff95b36ae5e8591ebc01fdffed3394598688c32cf166c",
    sizeBytes: 725,
    mediaType: "application/vnd.buzz.agent-snapshot+json",
  });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot?.memory.level, "none");
  assert.match(result.warnings.join(" "), /cannot prove.*benign/i);
});
test("blocks memory, source identities, remote beacons, unknown fields, and secrets", async () => {
  const base = JSON.parse(await readFile(referenceUrl, "utf8"));
  const cases: Array<[string, unknown, RegExp]> = [
    ["memory.agent.json", { ...base, memory: { level: "core", entries: [{ slug: "core", body: "private" }] } }, /memory/i],
    ["allowlist.agent.json", { ...base, definition: { ...base.definition, respondToAllowlist: ["ab".repeat(32)] } }, /allowlist/i],
    ["avatar.agent.json", { ...base, profile: { ...base.profile, avatarUrl: "https://tracker.example/avatar.png" } }, /avatar URLs are blocked/i],
    ["unknown.agent.json", { ...base, privateKey: "not-even-needed" }, /unsupported fields/i],
    ["secret.agent.json", { ...base, definition: { ...base.definition, systemPrompt: "Use nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" } }, /private key|credential/i],
  ];

  for (const [name, value, expected] of cases) {
    const result = await scanAgentSnapshot(new TextEncoder().encode(JSON.stringify(value)), name);
    assert.equal(result.ok, false, name);
    assert.match(result.hardErrors.join(" "), expected, name);
  }
});

test("blocks additional known credentials, encoded private keys, and spoofing controls", async () => {
  const base = JSON.parse(await readFile(referenceUrl, "utf8"));
  const values = [
    `AIza${"A".repeat(35)}`,
    `sk_live_${"A".repeat(24)}`,
    `ya29.${"A".repeat(30)}`,
    `npm_${"A".repeat(36)}`,
    Buffer.from("-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----").toString("base64"),
  ];
  for (const value of values) {
    const snapshot = { ...base, definition: { ...base.definition, systemPrompt: `Use ${value}` } };
    const result = await scanAgentSnapshot(new TextEncoder().encode(JSON.stringify(snapshot)), "secret.agent.json");
    assert.equal(result.ok, false, value.slice(0, 12));
    assert.match(result.hardErrors.join(" "), /private key|credential/i);
  }

  const encodedKey = Buffer.from("-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----").toString("base64");
  const disguised = { ...base, definition: { ...base.definition, systemPrompt: `data:image/not-real;base64,${encodedKey}` } };
  const disguisedResult = await scanAgentSnapshot(new TextEncoder().encode(JSON.stringify(disguised)), "disguised.agent.json");
  assert.equal(disguisedResult.ok, false);
  assert.match(disguisedResult.hardErrors.join(" "), /private key|credential/i);

  const spoofed = { ...base, profile: { ...base.profile, displayName: "Researcher\u202Egpj.exe" } };
  const spoofedResult = await scanAgentSnapshot(new TextEncoder().encode(JSON.stringify(spoofed)), "spoofed.agent.json");
  assert.equal(spoofedResult.ok, false);
  assert.match(spoofedResult.hardErrors.join(" "), /control characters|Unicode direction/i);
});

test("matches Buzz's 64 KiB prompt and visible text import limits", async () => {
  const base = JSON.parse(await readFile(referenceUrl, "utf8"));
  const oversized = { ...base, definition: { ...base.definition, systemPrompt: "a".repeat((64 * 1024) + 1) } };
  const oversizedResult = await scanAgentSnapshot(new TextEncoder().encode(JSON.stringify(oversized)), "oversized.agent.json");
  assert.equal(oversizedResult.ok, false);
  assert.match(oversizedResult.hardErrors.join(" "), /64 KiB UTF-8 limit/i);

  for (const character of ["\u00ad", "\u034f", "\u3164", "\u{e007f}"]) {
    const hidden = { ...base, definition: { ...base.definition, systemPrompt: `Review${character}this` } };
    const hiddenResult = await scanAgentSnapshot(new TextEncoder().encode(JSON.stringify(hidden)), "hidden.agent.json");
    assert.equal(hiddenResult.ok, false, `U+${character.codePointAt(0)?.toString(16)}`);
    assert.match(hiddenResult.hardErrors.join(" "), /cannot show safely/i);
  }

  const emoji = { ...base, definition: { ...base.definition, systemPrompt: "Review with care 👩‍💻 ❤️" } };
  const emojiResult = await scanAgentSnapshot(new TextEncoder().encode(JSON.stringify(emoji)), "emoji.agent.json");
  assert.equal(emojiResult.ok, true, emojiResult.hardErrors.join(" "));
});

test("accepts only the dedicated Buzz PNG snapshot metadata channel", async () => {
  const snapshotBytes = new Uint8Array(await readFile(referenceUrl));
  const valid = await scanAgentSnapshot(snapshotPng(snapshotBytes), "quiet-researcher.agent.png", { mediaType: "image/png" });
  assert.equal(valid.ok, true, valid.hardErrors.join(" "));
  assert.equal(valid.sourceFormat, "png");

  const hiddenMetadata = await scanAgentSnapshot(snapshotPng(snapshotBytes, true), "quiet-researcher.agent.png");
  assert.equal(hiddenMetadata.ok, false);
  assert.match(hiddenMetadata.hardErrors.join(" "), /more than one text metadata channel/i);
});

test("blocks a digest mismatch before download handoff", async () => {
  const bytes = new Uint8Array(await readFile(referenceUrl));
  const result = await scanAgentSnapshot(bytes, "quiet-researcher.agent.json", { sha256: "00".repeat(32) });
  assert.equal(result.ok, false);
  assert.match(result.hardErrors.join(" "), /SHA 256 does not match/i);
});
