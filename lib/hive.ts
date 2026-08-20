import {
  AGENT_CATEGORIES,
  AGENT_HARNESSES,
  CATALOG_SCHEMA,
  releaseKeyFor,
  type ReleaseManifest,
  type ReleaseRecord,
  type RiskLevel,
  type ValidationResult,
} from "./hive-contract";
import { containsKnownSecret, containsProhibitedBuzzText, isSafePublicLabel } from "./security-patterns";

export * from "./hive-contract";

const HEX_64 = /^[a-f0-9]{64}$/;
const RELEASE_ID = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShortString(value: unknown, min: number, max: number) {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

function isStringArray(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= maxLength);
}

function validateAllowedKeys(input: unknown, allowed: readonly string[], label: string, errors: string[]) {
  if (!isRecord(input)) return;
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(input).filter((key) => !allowedSet.has(key));
  if (unknown.length) errors.push(`${label} contains unsupported fields: ${unknown.join(", ")}.`);
}

function hasSecretMaterial(value: unknown, path = "manifest"): string[] {
  const matches: string[] = [];
  const sensitiveKeys = new Set([
    "secret", "privatekey", "apikey", "accesstoken", "refreshtoken",
    "authtag", "credential", "credentials", "password", "nsec",
  ]);

  if (typeof value === "string") {
    if (containsKnownSecret(value)) matches.push(path);
    return matches;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => matches.push(...hasSecretMaterial(item, `${path}[${index}]`)));
    return matches;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const itemPath = `${path}.${key}`;
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (sensitiveKeys.has(normalizedKey) && item !== null && item !== "" && item !== undefined) matches.push(itemPath);
      matches.push(...hasSecretMaterial(item, itemPath));
    }
  }
  return matches;
}

function hasSpoofingMaterial(value: unknown, path = "manifest"): string[] {
  const matches: string[] = [];
  if (typeof value === "string") {
    if (containsProhibitedBuzzText(value)) matches.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => matches.push(...hasSpoofingMaterial(item, `${path}[${index}]`)));
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => matches.push(...hasSpoofingMaterial(item, `${path}.${key}`)));
  }
  return matches;
}

function validateUrl(value: unknown, allowRelativeArtifact: boolean) {
  if (typeof value !== "string" || value.length > 2_048) return false;
  if (allowRelativeArtifact && (
    /^\/agents\/[a-z0-9._-]+\.agent\.(?:json|png)$/i.test(value)
  )) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function artifactPathEndsWith(value: unknown, suffix: string) {
  if (typeof value !== "string") return false;
  if (value.startsWith("/")) return value.toLowerCase().endsWith(suffix);
  try {
    return new URL(value).pathname.toLowerCase().endsWith(suffix);
  } catch {
    return false;
  }
}

function validateMetadata(input: unknown, errors: string[]): void {
  if (!isRecord(input)) {
    errors.push("Release metadata is required.");
    return;
  }
  validateAllowedKeys(input, ["id", "name", "version", "category", "summary", "description", "license", "homepage", "keywords", "engines", "recommendedHarness", "recommendedModel"], "Release metadata", errors);
  if (typeof input.id !== "string" || !RELEASE_ID.test(input.id)) errors.push("Release id is invalid.");
  if (!isSafePublicLabel(input.name, 2, 60)) errors.push("Release name must be 2–60 visible characters without control characters.");
  if (typeof input.version !== "string" || !SEMVER.test(input.version) || input.version.length > 32) errors.push("Release version must use semantic versioning.");
  if (!AGENT_CATEGORIES.includes(input.category as (typeof AGENT_CATEGORIES)[number])) errors.push("Release category is invalid.");
  if (!isShortString(input.summary, 12, 160)) errors.push("Summary must be 12–160 characters.");
  if (!isShortString(input.description, 12, 1_200)) errors.push("Description must be 12–1,200 characters.");
  if (!isShortString(input.license, 2, 80)) errors.push("License is required.");
  if (input.homepage !== undefined && !validateUrl(input.homepage, false)) errors.push("Homepage must use HTTPS.");
  if (!isStringArray(input.keywords, 8, 30)) errors.push("Keywords are invalid.");
  if (!isRecord(input.engines) || !isShortString(input.engines.buzz, 1, 30)) {
    errors.push("Buzz engine compatibility is required.");
  } else {
    validateAllowedKeys(input.engines, ["buzz"], "Engine compatibility", errors);
  }
  if (!AGENT_HARNESSES.includes(input.recommendedHarness as (typeof AGENT_HARNESSES)[number])) errors.push("Recommended Agent harness is invalid.");
  if (!isSafePublicLabel(input.recommendedModel, 1, 80)) errors.push("Recommended model must be 1–80 visible characters without control characters.");
}

function validateContents(input: unknown, errors: string[]): void {
  if (!isRecord(input)) {
    errors.push("Release contents summary is required.");
    return;
  }
  validateAllowedKeys(input, ["agents", "skills", "mcpServers", "hooks"], "Contents summary", errors);
  if (input.agents !== 1 || input.skills !== 0 || input.mcpServers !== 0 || input.hooks !== 0) {
    errors.push("Agent snapshots must contain exactly one agent and no bundled skills, MCP servers, or hooks.");
  }
}

function validateCapabilities(input: unknown, errors: string[]): void {
  if (!isRecord(input)) {
    errors.push("Capability declaration is required.");
    return;
  }
  validateAllowedKeys(input, ["networkHosts", "filesystem", "commands", "hooks", "mcpServers"], "Capability declaration", errors);
  if (!isStringArray(input.networkHosts, 32, 120)) errors.push("Network host declaration is invalid.");
  if (!["none", "read-only", "project-write"].includes(String(input.filesystem))) errors.push("Filesystem declaration is invalid.");
  if (!isStringArray(input.commands, 32, 240)) errors.push("Command declaration is invalid.");

  if (!Array.isArray(input.hooks) || input.hooks.length > 64) {
    errors.push("Hook declaration is invalid.");
  } else if (input.hooks.some((hook) => !isRecord(hook) || !isShortString(hook.phase, 1, 80) || !isShortString(hook.command, 1, 240))) {
    errors.push("Every hook must declare a bounded phase and command.");
  } else {
    input.hooks.forEach((hook) => validateAllowedKeys(hook, ["phase", "command"], "Hook declaration", errors));
  }

  if (!Array.isArray(input.mcpServers) || input.mcpServers.length > 32) {
    errors.push("MCP declaration is invalid.");
  } else if (input.mcpServers.some((server) => {
    if (!isRecord(server) || !isShortString(server.name, 1, 80)) return true;
    if (!["stdio", "http"].includes(String(server.transport))) return true;
    if (!["read-only", "write", "unknown"].includes(String(server.access))) return true;
    return server.command !== undefined && !isShortString(server.command, 1, 240);
  })) {
    errors.push("Every MCP server must declare a valid name, transport, access, and optional command.");
  } else {
    input.mcpServers.forEach((server) => validateAllowedKeys(server, ["name", "transport", "command", "access"], "MCP declaration", errors));
  }

  const commands = Array.isArray(input.commands) ? input.commands : [];
  const hooks = Array.isArray(input.hooks) ? input.hooks : [];
  const servers = Array.isArray(input.mcpServers) ? input.mcpServers : [];
  const composed = /[;|`]|&&|\$\(/;
  if (commands.some((command) => typeof command === "string" && composed.test(command))) errors.push("Shell composition is not allowed in declared commands.");
  if (hooks.some((hook) => isRecord(hook) && typeof hook.command === "string" && composed.test(hook.command))) errors.push("Shell composition is not allowed in hook commands.");
  if (servers.some((server) => isRecord(server) && typeof server.command === "string" && composed.test(server.command))) errors.push("Shell composition is not allowed in MCP commands.");

  if (
    input.filesystem !== "none"
    || commands.length > 0
    || hooks.length > 0
    || servers.length > 0
    || (Array.isArray(input.networkHosts) && input.networkHosts.length > 0)
  ) errors.push("Agent snapshots cannot declare executable, network, filesystem, hook, or MCP capabilities.");
}

export function validateManifest(
  input: unknown,
  options: { allowRelativeArtifact?: boolean } = {},
): ValidationResult<ReleaseManifest> {
  const errors: string[] = [];
  const allowRelativeArtifact = options.allowRelativeArtifact ?? false;
  if (!isRecord(input)) return { ok: false, errors: ["Release content must be a JSON object."] };

  validateAllowedKeys(input, ["schema", "type", "contributorName", "release", "artifact", "contents", "capabilities", "snapshot"], "Release manifest", errors);
  if (input.schema !== CATALOG_SCHEMA) errors.push("Unsupported catalog schema.");
  if (input.type !== "agent") errors.push("Release type must be agent.");
  if (input.contributorName !== undefined && !isSafePublicLabel(input.contributorName, 1, 60)) errors.push("Contributor name must be 60 visible characters or fewer without control characters.");
  validateMetadata(input.release, errors);

  if (!isRecord(input.artifact)) {
    errors.push("Artifact metadata is required.");
  } else {
    validateAllowedKeys(input.artifact, ["url", "sha256", "sizeBytes", "mediaType"], "Artifact metadata", errors);
    if (!validateUrl(input.artifact.url, allowRelativeArtifact)) errors.push("Artifact URL must use public HTTPS or an approved local catalog path.");
    if (typeof input.artifact.sha256 !== "string" || !HEX_64.test(input.artifact.sha256)) errors.push("Artifact SHA-256 is invalid.");
    const maxSize = input.artifact.mediaType === "image/png" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    if (!Number.isInteger(input.artifact.sizeBytes) || Number(input.artifact.sizeBytes) < 1 || Number(input.artifact.sizeBytes) > maxSize) errors.push(`Artifact size must be between 1 byte and ${maxSize / 1024 / 1024} MiB.`);
    if (!["application/vnd.buzz.agent-snapshot+json", "image/png"].includes(String(input.artifact.mediaType))) errors.push("Agent artifact media type is invalid.");
    if (input.artifact.mediaType === "image/png" && !artifactPathEndsWith(input.artifact.url, ".agent.png")) errors.push("PNG Agent artifact URL must end with .agent.png.");
    if (input.artifact.mediaType === "application/vnd.buzz.agent-snapshot+json" && !artifactPathEndsWith(input.artifact.url, ".agent.json")) errors.push("JSON Agent artifact URL must end with .agent.json.");
  }

  validateContents(input.contents, errors);
  validateCapabilities(input.capabilities, errors);
  const snapshot = input.snapshot;
  validateAllowedKeys(snapshot, ["format", "version", "memoryLevel", "identityPolicy", "sourceAllowlist"], "Snapshot policy", errors);
  if (!isRecord(snapshot)
    || snapshot.format !== "buzz-agent-snapshot"
    || snapshot.version !== 1
    || snapshot.memoryLevel !== "none"
    || snapshot.identityPolicy !== "fresh-on-import"
    || snapshot.sourceAllowlist !== "cleared-on-import") errors.push("Agent snapshot safety policy is missing or invalid.");
  if (hasSecretMaterial(input).length) errors.push("Possible secret or private identity material is present.");
  if (hasSpoofingMaterial(input).length) errors.push("Unicode direction or invisible control characters are not allowed in catalog metadata.");

  return errors.length
    ? { ok: false, errors: [...new Set(errors)] }
    : { ok: true, value: input as unknown as ReleaseManifest, errors: [] };
}

export function riskLevelFor(manifest: ReleaseManifest): RiskLevel {
  const { capabilities } = manifest;
  if (capabilities.filesystem === "project-write"
    || capabilities.commands.length > 0
    || capabilities.hooks.length > 0
    || capabilities.mcpServers.some((server) => server.access !== "read-only")) return "elevated";
  if (capabilities.filesystem === "read-only"
    || capabilities.networkHosts.length > 0
    || capabilities.mcpServers.length > 0) return "review";
  return "low";
}

export function recordFromManifest(manifest: ReleaseManifest, addedAt: number, downloadCount = 0): ReleaseRecord {
  const validation = validateManifest(manifest, { allowRelativeArtifact: true });
  if (!validation.ok) throw new Error(validation.errors.join(" "));
  return {
    key: releaseKeyFor(manifest),
    manifest,
    downloadCount: Math.max(0, Math.floor(downloadCount)),
    riskLevel: riskLevelFor(manifest),
    addedAt,
  };
}
