import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SanitizeResult {
  /** Original text — never modified */
  text: string;
  /** Labels of detected prompt-injection patterns */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Detection pattern definitions
// ---------------------------------------------------------------------------

interface DetectionRule {
  label: string;
  pattern: RegExp;
}

/**
 * Core prompt-injection detection rules.
 *
 * References:
 *  - OWASP LLM Top 10 2025 – LLM01 Prompt Injection
 *  - OWASP Cheat Sheet: LLM Prompt Injection Prevention
 *
 * Design principle: **never block messages** (false-positive risk is too
 * high). We only populate `warnings` so downstream code can add context to
 * the system prompt.
 */
const DETECTION_RULES: DetectionRule[] = [
  // 1. Instruction override attempts
  {
    label: 'ignore-instructions',
    pattern: /ignore\s+(all\s+)?(?:previous|above)\s+instructions/i,
  },
  // 2. Identity override attempts
  {
    label: 'identity-override',
    pattern: /(?:you\s+are\s+now|from\s+now\s+on\s+you\s+are)/i,
  },
  // 3. System role injection (line-start "system:")
  {
    label: 'system-role-injection',
    pattern: /^system:/im,
  },
  // 4. Chat-template delimiter injection (ChatML, Llama, etc.)
  {
    label: 'chat-template-injection',
    pattern: /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|system\|>|<<SYS>>/i,
  },
  // 5. Structured-output injection — MOST IMPORTANT
  //    Attacker could manipulate memory, profile, or schedule actions.
  {
    label: 'structured-output-injection',
    pattern: /\[MEMORY_SAVE\]|\[PROFILE_UPDATE\]|\[SCHEDULE_ACTION\]/i,
  },
];

// ---------------------------------------------------------------------------
// Base64 detection helpers
// ---------------------------------------------------------------------------

/** Matches Base64-encoded strings of 50+ characters */
const BASE64_PATTERN = /[A-Za-z0-9+/]{50,}={0,2}/g;

/**
 * Try to decode a Base64 string. Returns `null` on failure.
 */
function tryDecodeBase64(encoded: string): string | null {
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    // Heuristic: if the decoded string contains too many non-printable
    // characters it was probably not real Base64 text.
    const printableRatio =
      decoded.replace(/[^\x20-\x7E\t\n\r]/g, '').length / decoded.length;
    if (printableRatio < 0.8) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Check whether decoded Base64 text triggers any of the core rules (1-5).
 */
function base64ContainsInjection(decoded: string): boolean {
  return DETECTION_RULES.some((rule) => rule.pattern.test(decoded));
}

// ---------------------------------------------------------------------------
// Unicode mixed-script detection
// ---------------------------------------------------------------------------

/** Matches Cyrillic characters */
const CYRILLIC_PATTERN = /[\u0400-\u04FF]/;
/** Matches Basic Latin letters (ASCII a-z, A-Z) */
const LATIN_PATTERN = /[A-Za-z]/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyse user input for known prompt-injection patterns.
 *
 * The original text is **never modified** — we only return warning labels so
 * downstream code can surface them in the system prompt or audit log.
 */
export function sanitizeUserInput(text: string): SanitizeResult {
  const warnings: string[] = [];

  // --- Core rules (1-5) ---
  for (const rule of DETECTION_RULES) {
    if (rule.pattern.test(text)) {
      warnings.push(rule.label);
    }
  }

  // --- 6. Base64-encoded injection ---
  const base64Matches = text.match(BASE64_PATTERN);
  if (base64Matches) {
    for (const match of base64Matches) {
      const decoded = tryDecodeBase64(match);
      if (decoded !== null && base64ContainsInjection(decoded)) {
        warnings.push('base64-injection');
        break; // one warning is enough
      }
    }
  }

  // --- 7. Mixed Cyrillic + Latin characters ---
  if (CYRILLIC_PATTERN.test(text) && LATIN_PATTERN.test(text)) {
    warnings.push('unicode-mixed-script');
  }

  return { text, warnings };
}

/**
 * Sanitise a file name to prevent path-traversal and control-character
 * attacks.
 *
 * 1. Strip directory components via `path.basename()`.
 * 2. Remove null bytes and control characters (code < 32) except tab (0x09)
 *    and newline (0x0A).
 * 3. Fall back to `'unnamed_file'` when the result is empty, `.`, or `..`.
 */
export function sanitizeFileName(name: string): string {
  // Step 1 – strip path traversal
  let sanitized = path.basename(name);

  // Step 2 – remove null bytes and control characters (< 0x20) except
  //          tab (0x09) and newline (0x0A)
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');

  // Step 3 – fallback for empty / dot-only results
  if (sanitized === '' || sanitized === '.' || sanitized === '..') {
    return 'unnamed_file';
  }

  return sanitized;
}
