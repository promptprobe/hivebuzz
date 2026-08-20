const KNOWN_SECRET_PATTERNS = [
  /\bnsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}\b/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bya29\.[0-9A-Za-z_-]{20,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bnpm_[A-Za-z0-9]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
] as const;

const BASE64_RUN = /[A-Za-z0-9+/]{80,}={0,2}/g;
const PRIVATE_KEY_MARKER = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const PUBLIC_LABEL_CONTROL = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const SPOOFING_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
const CONTROL_CHARACTER = /^\p{Cc}$/u;
const EXTENDED_PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u;

function isDefaultIgnorable(codePoint: number) {
  return codePoint === 0x00ad
    || codePoint === 0x034f
    || codePoint === 0x061c
    || (codePoint >= 0x115f && codePoint <= 0x1160)
    || (codePoint >= 0x17b4 && codePoint <= 0x17b5)
    || (codePoint >= 0x180b && codePoint <= 0x180f)
    || (codePoint >= 0x200b && codePoint <= 0x200f)
    || (codePoint >= 0x202a && codePoint <= 0x202e)
    || (codePoint >= 0x2060 && codePoint <= 0x206f)
    || codePoint === 0x3164
    || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || codePoint === 0xfeff
    || codePoint === 0xffa0
    || (codePoint >= 0xfff0 && codePoint <= 0xfff8)
    || (codePoint >= 0x1bca0 && codePoint <= 0x1bca3)
    || (codePoint >= 0x1d173 && codePoint <= 0x1d17a)
    || (codePoint >= 0xe0000 && codePoint <= 0xe0fff);
}

function isEmojiVariationBase(character: string) {
  return /^[#*0-9]$/.test(character) || EXTENDED_PICTOGRAPHIC.test(character);
}

function hasPrecedingEmojiBase(characters: string[], index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const character = characters[cursor];
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint !== 0xfe0f && !(codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)) {
      return EXTENDED_PICTOGRAPHIC.test(character);
    }
  }
  return false;
}

function isAllowedEmojiFormat(characters: string[], index: number) {
  const codePoint = characters[index].codePointAt(0) ?? 0;
  if (codePoint === 0xfe0f) return index > 0 && isEmojiVariationBase(characters[index - 1]);
  if (codePoint === 0x200d) {
    return hasPrecedingEmojiBase(characters, index)
      && index + 1 < characters.length
      && EXTENDED_PICTOGRAPHIC.test(characters[index + 1]);
  }
  return false;
}

export function containsKnownSecret(value: string): boolean {
  if (KNOWN_SECRET_PATTERNS.some((pattern) => pattern.test(value))) return true;

  let inspected = 0;
  for (const match of value.matchAll(BASE64_RUN)) {
    const encoded = match[0];
    if (encoded.length > 32_768 || encoded.length % 4 !== 0) continue;
    inspected += 1;
    if (inspected > 16) break;
    try {
      const decoded = atob(encoded);
      if (PRIVATE_KEY_MARKER.test(decoded)) return true;
    } catch {
      // Invalid base64 is not evidence of a credential.
    }
  }
  return false;
}

export function containsSpoofingControl(value: string): boolean {
  return SPOOFING_CONTROL.test(value);
}

/** Mirrors Buzz's human-visible agent text boundary for shared prompts. */
export function containsProhibitedBuzzText(value: string): boolean {
  const characters = Array.from(value);
  return characters.some((character, index) => {
    const allowedLayout = character === "\n" || character === "\t";
    const control = CONTROL_CHARACTER.test(character);
    const codePoint = character.codePointAt(0) ?? 0;
    return (!allowedLayout && control)
      || (isDefaultIgnorable(codePoint) && !isAllowedEmojiFormat(characters, index));
  });
}

export function isSafePublicLabel(value: unknown, min: number, max: number): value is string {
  return typeof value === "string"
    && value.trim().length >= min
    && value.length <= max
    && !PUBLIC_LABEL_CONTROL.test(value);
}
