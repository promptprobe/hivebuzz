import { containsKnownSecret, containsProhibitedBuzzText, isSafePublicLabel } from "./security-patterns";

const JSON_MAX_BYTES = 5 * 1024 * 1024;
const PNG_MAX_BYTES = 10 * 1024 * 1024;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const SYSTEM_PROMPT_MAX_BYTES = 64 * 1024;
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const SNAPSHOT_KEYWORD = "buzz_agent_snapshot";

export interface AgentSnapshotDefinition {
  name: string;
  sourceIsBuiltIn?: boolean;
  systemPrompt?: string | null;
  runtime?: string | null;
  model?: string | null;
  provider?: string | null;
  parallelism?: number | null;
  respondTo?: string | null;
  respondToAllowlist?: string[];
  namePool?: string[];
  idleTimeoutSeconds?: number | null;
  maxTurnDurationSeconds?: number | null;
}
export interface AgentSnapshot {
  format: "buzz-agent-snapshot";
  version: 1;
  definition: AgentSnapshotDefinition;
  profile: {
    displayName: string;
    about?: string | null;
    avatarDataUrl?: string | null;
    avatarUrl?: string | null;
  };
  memory: {
    level: "none";
    entries?: never[];
  };
}

export interface AgentSnapshotScanResult {
  ok: boolean;
  sha256: string;
  hardErrors: string[];
  warnings: string[];
  checks: string[];
  sourceFormat: "json" | "png" | null;
  snapshot: AgentSnapshot | null;
  suggested: {
    id: string;
    name: string;
    summary: string;
    description: string;
  } | null;
}

interface ExpectedArtifact {
  sha256?: string;
  sizeBytes?: number;
  mediaType?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string, errors: string[]) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length) errors.push(`${label} contains unsupported fields: ${unknown.join(", ")}.`);
}

function boundedOptionalString(value: unknown, label: string, max: number, errors: string[]) {
  if (value !== undefined && value !== null && (typeof value !== "string" || value.length > max)) {
    errors.push(`${label} is invalid or too large.`);
  }
}

function boundedOptionalUtf8(value: unknown, label: string, maxBytes: number, errors: string[]) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > maxBytes) {
    errors.push(`${label} exceeds Buzz's ${maxBytes / 1024} KiB UTF-8 limit.`);
  }
}

function boundedStringArray(value: unknown, label: string, maxItems: number, maxLength: number, errors: string[]) {
  if (
    value !== undefined &&
    (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string" || !item.trim() || item.length > maxLength))
  ) {
    errors.push(`${label} is invalid or too large.`);
  }
}

function boundedOptionalInteger(value: unknown, label: string, min: number, max: number, errors: string[]) {
  if (value !== undefined && value !== null && (!Number.isInteger(value) || Number(value) < min || Number(value) > max)) {
    errors.push(`${label} is outside the safe range.`);
  }
}

function possibleSecrets(value: unknown, path = "snapshot"): string[] {
  const matches: string[] = [];
  if (typeof value === "string") {
    if (containsKnownSecret(value)) matches.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => matches.push(...possibleSecrets(item, `${path}[${index}]`)));
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => matches.push(...possibleSecrets(item, `${path}.${key}`)));
  }
  return matches;
}

function possibleSpoofingControls(value: unknown, path = "snapshot"): string[] {
  const matches: string[] = [];
  if (typeof value === "string") {
    if (containsProhibitedBuzzText(value)) matches.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => matches.push(...possibleSpoofingControls(item, `${path}[${index}]`)));
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => matches.push(...possibleSpoofingControls(item, `${path}.${key}`)));
  }
  return matches;
}

function bytesEqualPrefix(bytes: Uint8Array, prefix: Uint8Array) {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

function readU32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function ascii(bytes: Uint8Array) {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    output += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return output;
}

function decodeBase64(value: string) {
  const clean = value.trim();
  if (!clean || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error("Snapshot PNG contains invalid base64.");
  const binary = atob(clean);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

function extractPngSnapshot(bytes: Uint8Array) {
  if (!bytesEqualPrefix(bytes, PNG_SIGNATURE)) throw new Error("File is not a valid PNG snapshot.");
  const renderingChunks = new Set(["cHRM", "gAMA", "sBIT", "sRGB", "bKGD", "hIST", "tRNS", "sPLT"]);
  const criticalChunks = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
  let offset = PNG_SIGNATURE.length;
  let snapshotText: string | null = null;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("PNG chunk table is truncated.");
    const length = readU32(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > bytes.length) throw new Error("PNG chunk length is invalid.");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = ascii(typeBytes);
    const data = bytes.subarray(dataStart, dataEnd);
    const expectedCrc = readU32(bytes, dataEnd);
    const crcInput = new Uint8Array(4 + data.length);
    crcInput.set(typeBytes);
    crcInput.set(data, 4);
    if (crc32(crcInput) !== expectedCrc) throw new Error(`PNG ${type} chunk failed its integrity check.`);

    if (!sawHeader && type !== "IHDR") throw new Error("PNG header is missing or out of order.");
    if (type === "IHDR") {
      if (sawHeader || length !== 13) throw new Error("PNG has an invalid IHDR chunk.");
      const width = readU32(data, 0);
      const height = readU32(data, 4);
      if (!width || !height || width > 4_096 || height > 4_096 || width * height > 16_777_216) {
        throw new Error("PNG dimensions exceed the public snapshot limit.");
      }
      sawHeader = true;
    } else if (type === "IDAT") {
      sawImageData = true;
    } else if (type === "tEXt") {
      if (snapshotText !== null) throw new Error("PNG contains more than one text metadata channel.");
      const separator = data.indexOf(0);
      if (separator < 1 || ascii(data.subarray(0, separator)) !== SNAPSHOT_KEYWORD) {
        throw new Error("PNG contains text metadata outside the Buzz snapshot channel.");
      }
      snapshotText = ascii(data.subarray(separator + 1));
    } else if (["eXIf", "zTXt", "iTXt", "iCCP"].includes(type)) {
      throw new Error(`PNG metadata chunk ${type} is forbidden.`);
    } else if (type === "IEND") {
      if (length !== 0) throw new Error("PNG IEND chunk is invalid.");
      sawEnd = true;
      offset = chunkEnd;
      break;
    } else {
      const ancillary = (typeBytes[0] & 0x20) !== 0;
      if ((ancillary && !renderingChunks.has(type)) || (!ancillary && !criticalChunks.has(type))) {
        throw new Error(`PNG chunk ${type} is not allowed in a public snapshot.`);
      }
    }
    offset = chunkEnd;
  }

  if (!sawHeader || !sawImageData || !sawEnd || offset !== bytes.length) throw new Error("PNG image structure is incomplete or has trailing data.");
  if (snapshotText === null) throw new Error("PNG does not contain a buzz_agent_snapshot payload.");
  const decoded = decodeBase64(snapshotText);
  if (decoded.length > JSON_MAX_BYTES) throw new Error("Embedded Agent snapshot exceeds 5 MiB.");
  return decoded;
}

function validateDataAvatar(value: string, errors: string[]) {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match) {
    errors.push("Embedded avatar must be a base64 PNG, JPEG, GIF, or WebP image.");
    return;
  }
  try {
    const avatar = decodeBase64(match[2]);
    if (avatar.length > AVATAR_MAX_BYTES) errors.push("Embedded avatar exceeds Buzz's 2 MiB limit.");
    const signatures: Record<string, boolean> = {
      "image/png": bytesEqualPrefix(avatar, PNG_SIGNATURE),
      "image/jpeg": avatar.length >= 3 && avatar[0] === 0xff && avatar[1] === 0xd8 && avatar[2] === 0xff,
      "image/gif": avatar.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(avatar.subarray(0, 6))),
      "image/webp": avatar.length >= 12 && ascii(avatar.subarray(0, 4)) === "RIFF" && ascii(avatar.subarray(8, 12)) === "WEBP",
    };
    if (!signatures[match[1]]) errors.push("Embedded avatar bytes do not match their declared image type.");
  } catch {
    errors.push("Embedded avatar base64 is invalid.");
  }
}

function validateSnapshot(input: unknown, errors: string[]): AgentSnapshot | null {
  if (!isRecord(input)) {
    errors.push("Snapshot JSON must be an object.");
    return null;
  }
  onlyKeys(input, ["format", "version", "definition", "profile", "memory"], "Snapshot", errors);
  if (input.format !== "buzz-agent-snapshot") errors.push("Only unlocked Buzz Agent Snapshot files are accepted.");
  if (input.version !== 1) errors.push("Only Buzz Agent Snapshot version 1 is supported.");

  const definition = input.definition;
  if (!isRecord(definition)) {
    errors.push("Snapshot definition is missing.");
  } else {
    onlyKeys(definition, [
      "name", "sourceIsBuiltIn", "systemPrompt", "runtime", "model", "provider", "parallelism", "respondTo",
      "respondToAllowlist", "namePool", "idleTimeoutSeconds", "maxTurnDurationSeconds",
    ], "Snapshot definition", errors);
    if (!isSafePublicLabel(definition.name, 1, 120)) errors.push("Agent definition name must use visible characters without control characters.");
    if (definition.sourceIsBuiltIn !== undefined && typeof definition.sourceIsBuiltIn !== "boolean") errors.push("sourceIsBuiltIn must be a boolean.");
    boundedOptionalUtf8(definition.systemPrompt, "System prompt", SYSTEM_PROMPT_MAX_BYTES, errors);
    if (typeof definition.systemPrompt === "string" && containsProhibitedBuzzText(definition.systemPrompt)) {
      errors.push("System prompt contains a character that Buzz cannot show safely in an import review.");
    }
    boundedOptionalString(definition.runtime, "Runtime", 120, errors);
    boundedOptionalString(definition.model, "Model", 160, errors);
    boundedOptionalString(definition.provider, "Provider", 120, errors);
    boundedOptionalString(definition.respondTo, "Response policy", 80, errors);
    boundedOptionalInteger(definition.parallelism, "Parallelism", 1, 64, errors);
    boundedOptionalInteger(definition.idleTimeoutSeconds, "Idle timeout", 1, 31_536_000, errors);
    boundedOptionalInteger(definition.maxTurnDurationSeconds, "Maximum turn duration", 1, 86_400, errors);
    boundedStringArray(definition.respondToAllowlist, "Source allowlist", 128, 128, errors);
    boundedStringArray(definition.namePool, "Name pool", 64, 120, errors);
    if (Array.isArray(definition.respondToAllowlist) && definition.respondToAllowlist.length > 0) {
      errors.push("Source environment response allowlists cannot be shared. Export without them or clear the list first.");
    }
  }

  const profile = input.profile;
  if (!isRecord(profile)) {
    errors.push("Snapshot profile is missing.");
  } else {
    onlyKeys(profile, ["displayName", "about", "avatarDataUrl", "avatarUrl"], "Snapshot profile", errors);
    if (!isSafePublicLabel(profile.displayName, 1, 120)) errors.push("Agent display name must use visible characters without control characters.");
    boundedOptionalString(profile.about, "Profile description", 4_000, errors);
    boundedOptionalString(profile.avatarDataUrl, "Embedded avatar", 3 * 1024 * 1024, errors);
    if (typeof profile.avatarDataUrl === "string") validateDataAvatar(profile.avatarDataUrl, errors);
    if (profile.avatarUrl !== undefined && profile.avatarUrl !== null && profile.avatarUrl !== "") {
      errors.push("Remote avatar URLs are blocked because they can leak importer network metadata. Embed the avatar or remove it.");
    }
  }

  const memory = input.memory;
  if (!isRecord(memory)) {
    errors.push("Snapshot memory policy is missing.");
  } else {
    onlyKeys(memory, ["level", "entries"], "Snapshot memory", errors);
    if (memory.level !== "none") errors.push("Public HiveBuzz snapshots must be exported with memory set to None.");
    if (memory.entries !== undefined && (!Array.isArray(memory.entries) || memory.entries.length > 0)) {
      errors.push("Public HiveBuzz snapshots cannot contain plaintext memory entries.");
    }
  }

  if (possibleSecrets(input).length) errors.push("Possible API secret, private key, or credential material was detected.");
  if (possibleSpoofingControls(input).length) errors.push("Unicode direction or invisible control characters are not allowed in a public snapshot.");
  return errors.length ? null : input as unknown as AgentSnapshot;
}

function suggestedMetadata(snapshot: AgentSnapshot) {
  const name = snapshot.profile.displayName.trim();
  const slug = (snapshot.definition.name || name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 68) || "shared-agent";
  const about = snapshot.profile.about?.replace(/\s+/g, " ").trim();
  const fallback = "A Buzz agent shared without memory, private keys, or source environment access.";
  const description = about && about.length >= 12 ? about.slice(0, 1_200) : fallback;
  const summary = description.length <= 160 ? description : `${description.slice(0, 157).trimEnd()}…`;
  return { id: `agent.${slug}`, name: name.slice(0, 60), summary, description };
}

export async function scanAgentSnapshot(
  input: ArrayBuffer | Uint8Array,
  fileName: string,
  expected: ExpectedArtifact = {},
): Promise<AgentSnapshotScanResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const hardErrors: string[] = [];
  const warnings: string[] = [];
  const checks: string[] = [];
  const lowerName = fileName.toLowerCase();
  const isPng = lowerName.endsWith(".agent.png") || bytesEqualPrefix(bytes, PNG_SIGNATURE);
  const isJson = lowerName.endsWith(".agent.json") && !isPng;
  const sourceFormat = isPng ? "png" : isJson ? "json" : null;
  const maxBytes = isPng ? PNG_MAX_BYTES : JSON_MAX_BYTES;

  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!sourceFormat) hardErrors.push("Choose a .agent.json or .agent.png Buzz Agent Snapshot.");
  if (bytes.length < 1 || bytes.length > maxBytes) hardErrors.push(`Agent snapshot must be between 1 byte and ${maxBytes / 1024 / 1024} MiB.`);
  if (expected.sizeBytes !== undefined && bytes.length !== expected.sizeBytes) hardErrors.push("Artifact size does not match the catalog record.");
  if (expected.sha256 !== undefined && sha256 !== expected.sha256) hardErrors.push("Artifact SHA 256 does not match the catalog record.");
  if (expected.mediaType === "image/png" && !isPng) hardErrors.push("The catalog record requires a .agent.png artifact.");
  if (expected.mediaType === "application/vnd.buzz.agent-snapshot+json" && !isJson) hardErrors.push("The catalog record requires a .agent.json artifact.");

  let snapshot: AgentSnapshot | null = null;
  if (!hardErrors.length) {
    try {
      const jsonBytes = isPng ? extractPngSnapshot(bytes) : bytes;
      const json = new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes);
      snapshot = validateSnapshot(JSON.parse(json) as unknown, hardErrors);
    } catch (error) {
      hardErrors.push(error instanceof Error ? error.message : "Agent snapshot could not be decoded.");
    }
  }

  if (!hardErrors.length && snapshot) {
    checks.push("Buzz Agent Snapshot v1 structure verified");
    checks.push("No plaintext memory or source allowlist");
    checks.push("No known private key or credential pattern detected");
    checks.push(isPng ? "PNG metadata channels restricted" : "Strict JSON fields only");
    checks.push("Exact SHA 256 and byte size verified");
    warnings.push("Static checks cannot prove an agent's instructions are benign. Review the full Buzz import preview before starting it.");
  }

  return {
    ok: hardErrors.length === 0 && Boolean(snapshot),
    sha256,
    hardErrors: [...new Set(hardErrors)],
    warnings,
    checks,
    sourceFormat,
    snapshot,
    suggested: snapshot ? suggestedMetadata(snapshot) : null,
  };
}
