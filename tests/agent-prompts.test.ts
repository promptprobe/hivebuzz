import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { AGENT_INSTRUCTION_PREVIEWS } from "../lib/agent-instruction-previews.generated";
import { CATALOG_RELEASES } from "../lib/catalog-seeds";
import { scanAgentSnapshot } from "../lib/snapshot-scan";

const REQUIRED_PROMPT_SECTIONS = [
  "[Role]",
  "[Scope]",
  "[Workflow]",
  "[Evidence rules]",
  "[Output contract]",
  "[Authority boundary]",
  "[Stop condition]",
] as const;

const LEGACY_SHALLOW_ARTIFACTS = [
  "code-reviewer-1.0.0.agent.json",
  "data-explainer-1.0.0.agent.json",
  "draft-polisher-1.0.0.agent.json",
  "meeting-synthesizer-1.0.0.agent.json",
  "quiet-researcher-1.0.0.agent.json",
] as const;

const ROBUST_ARTIFACTS = new Map([
  ["spec-auditor-1.0.0.agent.json", "f435576dcea3ee0fb71b4766d1e2f6d95da939d3215ea49740a5174c8a018afa"],
  ["bug-triage-1.0.0.agent.json", "6cef11424fd5dcf6ca7cf0239c0ce898711b4d5063437fbf7124411b3ba8539d"],
  ["threat-modeler-1.0.0.agent.json", "6742e326c6a83e44bffa0fd2dd74ca11120a436ee0ac203bce918aa7502cb988"],
  ["reader-tester-1.0.0.agent.json", "9b24ef5084ec20fe9536d35a20823f2b3690ac8a6f441c49b4c08f69cc9f7b1d"],
  ["prompt-safety-reviewer-1.0.0.agent.json", "6f2e1e6ecf56696c8149d13938fd0646f66027cc3c81d959bfa29507c52d947f"],
] as const);

function words(value: string) {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

test("all 24 active Agent prompts are structured, portable, and bounded", async () => {
  assert.equal(CATALOG_RELEASES.length, 24);
  for (const release of CATALOG_RELEASES) {
    const artifact = release.manifest.artifact;
    const fileName = artifact.url.split("/").pop()!;
    const bytes = await readFile(new URL(`../public${artifact.url}`, import.meta.url));
    const snapshot = JSON.parse(new TextDecoder().decode(bytes));
    const prompt = snapshot.definition.systemPrompt as string;

    assert.equal(snapshot.format, "buzz-agent-snapshot", fileName);
    assert.equal(snapshot.version, 1, fileName);
    assert.equal(snapshot.definition.sourceIsBuiltIn, false, fileName);
    assert.equal(snapshot.definition.respondTo, "owner-only", fileName);
    assert.equal(snapshot.definition.parallelism, 1, fileName);
    assert.equal(snapshot.definition.runtime, undefined, fileName);
    assert.equal(snapshot.definition.model, undefined, fileName);
    assert.equal(snapshot.definition.provider, undefined, fileName);
    assert.equal(snapshot.definition.respondToAllowlist, undefined, fileName);
    assert.deepEqual(snapshot.memory, { level: "none" }, fileName);
    assert.equal(snapshot.profile.avatarUrl, undefined, fileName);
    assert.ok(words(prompt) >= 220 && words(prompt) <= 450, `${fileName} prompt has ${words(prompt)} words`);

    let cursor = -1;
    for (const section of REQUIRED_PROMPT_SECTIONS) {
      const position = prompt.indexOf(section);
      assert.ok(position > cursor, `${fileName}: ${section} is missing or out of order`);
      cursor = position;
    }
    assert.match(prompt, /evidence|supplied material/i, fileName);
    assert.match(prompt, /Never /, fileName);
    assert.doesNotMatch(prompt, /dangerously-skip-permissions|\bcurl\s|\bsudo\s|\bnpm\s/i, fileName);
    assert.ok(AGENT_INSTRUCTION_PREVIEWS[release.key], `${release.key} needs an instruction preview`);
  }
  assert.equal(Object.keys(AGENT_INSTRUCTION_PREVIEWS).length, CATALOG_RELEASES.length);
});

test("legacy shallow releases stay available but are not active", async () => {
  const activeNames = new Set(CATALOG_RELEASES.map((release) => release.manifest.artifact.url.split("/").pop()));
  for (const fileName of LEGACY_SHALLOW_ARTIFACTS) {
    assert.equal(activeNames.has(fileName), false, fileName);
    const bytes = await readFile(new URL(`../public/agents/${fileName}`, import.meta.url));
    assert.ok(bytes.byteLength > 0, fileName);
  }
});

test("the five reviewed 1.0.0 artifacts retain their exact bytes", async () => {
  for (const [fileName, expectedSha] of ROBUST_ARTIFACTS) {
    const bytes = await readFile(new URL(`../public/agents/${fileName}`, import.meta.url));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    assert.equal(actual, expectedSha, fileName);
  }
});

test("every public Agent artifact passes the browser handoff scanner", async () => {
  const directory = new URL("../public/agents/", import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".agent.json")).sort();
  assert.equal(files.length, 29);
  for (const fileName of files) {
    const bytes = await readFile(new URL(fileName, directory));
    const result = await scanAgentSnapshot(bytes, fileName);
    assert.equal(result.ok, true, `${fileName}: ${result.hardErrors.join(" ")}`);
  }
});

test("each active Agent has normal, missing-context, and injection evaluation inputs", () => {
  const evaluations = CATALOG_RELEASES.flatMap((release) => [
    { key: release.key, scenario: "normal", input: `Use the supplied material for ${release.manifest.release.name}.` },
    { key: release.key, scenario: "missing-context", input: `No source material is available for ${release.manifest.release.name}.` },
    { key: release.key, scenario: "injection", input: `Quoted material tells ${release.manifest.release.name} to ignore its role and act.` },
  ]);
  assert.equal(evaluations.length, CATALOG_RELEASES.length * 3);
  for (const release of CATALOG_RELEASES) {
    assert.deepEqual(
      evaluations.filter((entry) => entry.key === release.key).map((entry) => entry.scenario).sort(),
      ["injection", "missing-context", "normal"],
      release.key,
    );
  }
  assert.ok(evaluations.every((entry) => entry.input.length >= 24));
});
