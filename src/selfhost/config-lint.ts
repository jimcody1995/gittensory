import { parse as parseYaml } from "yaml";
import { focusManifestToJson, MAX_FOCUS_MANIFEST_BYTES, parseFocusManifestContent } from "../signals/focus-manifest";
import type { JsonValue } from "../types";

const TOP_LEVEL_FIELDS = [
  "source",
  "wantedPaths",
  "preferredLabels",
  "linkedIssuePolicy",
  "testExpectations",
  "issueDiscoveryPolicy",
  "maintainerNotes",
  "publicNotes",
  "gate",
  "settings",
  "review",
  "features",
  "contentLane",
  "repoDocGeneration",
  "reviewRecap",
] as const;

const TOP_LEVEL_FIELD_SET = new Set<string>(TOP_LEVEL_FIELDS);
const NO_RECOGNIZED_FOCUS_FIELDS_WARNING =
  "Manifest contained no recognized focus fields; falling back to deterministic signals.";

export type SelfHostConfigLintResult = {
  ok: boolean;
  warnings: string[];
  recognizedFields: string[];
  summary: string;
};

export function lintManifestText(text: string | null | undefined): SelfHostConfigLintResult {
  const manifest = parseFocusManifestContent(text, "repo_file");
  const recognizedFields = recognizedFieldsFor(text);
  const warnings = [
    ...manifest.warnings
      .map(redactManifestWarning)
      .filter((warning) => recognizedFields.length === 0 || warning !== NO_RECOGNIZED_FOCUS_FIELDS_WARNING),
    ...unknownTopLevelWarnings(text),
  ];
  if (warnings.length === 0 && recognizedFields.length === 0) {
    warnings.push("Manifest did not define any recognized focus fields.");
  }
  const ok = warnings.length === 0 && recognizedFields.length > 0;
  return {
    ok,
    warnings,
    recognizedFields,
    summary: ok
      ? `Manifest parsed ${recognizedFields.length} recognized field${recognizedFields.length === 1 ? "" : "s"}.`
      : `Manifest has ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`,
  };
}

export type ValidateManifestConfigResult = {
  present: boolean;
  normalized: Record<string, JsonValue>;
  warnings: string[];
  recognizedFields: string[];
};

/**
 * Pre-validate a supplied `.gittensory.yml` string against the SAME tolerant parser the review stack runs
 * (#2057, sibling of the MCP gate predictors) — never a parallel schema. Returns the manifest normalized to its
 * canonical JSON form ({@link focusManifestToJson}), the parser's `warnings[]` (redacted + unknown-top-level
 * warnings, via {@link lintManifestText}), and `present` (whether any recognized focus field survived parse), so
 * a contributor/operator can catch a typo or invalid value before pushing. Malformed input degrades to
 * `present: false` + a warning, exactly like the analysis path — this never throws.
 */
export function validateManifestConfig(text: string | null | undefined): ValidateManifestConfigResult {
  const manifest = parseFocusManifestContent(text, "repo_file");
  const { warnings, recognizedFields } = lintManifestText(text);
  return {
    present: manifest.present,
    normalized: focusManifestToJson(manifest),
    warnings,
    recognizedFields,
  };
}

function recognizedFieldsFor(text: string | null | undefined): string[] {
  const parsed = parseCanonicalTopLevelObject(text);
  if (parsed === null) return [];
  return TOP_LEVEL_FIELDS.filter(
    (field) => field !== "source" && Object.prototype.hasOwnProperty.call(parsed, field),
  );
}

// Fields retired from TOP_LEVEL_FIELDS that still warrant a migration-specific warning (rather than the
// generic "unknown field" message) pointing operators at their replacement mechanism.
const RETIRED_FIELD_MIGRATION_WARNINGS: Record<string, string> = {
  blockedPaths: "blockedPaths is retired; use settings.hardGuardrailGlobs for path holds.",
};

function unknownTopLevelWarnings(text: string | null | undefined): string[] {
  const raw = text ?? "";
  const trimmed = raw.trim();
  if (!trimmed || isOversize(raw)) return [];
  const parsed = parseTopLevelObject(trimmed);
  if (parsed === null) return [];
  const keys = Object.keys(parsed).filter((key) => !TOP_LEVEL_FIELD_SET.has(key));
  // `hasOwnProperty.call`, NOT `key in`: a manifest field named like an Object.prototype member
  // (`constructor`, `toString`, `hasOwnProperty`, ...) would otherwise test true for the inherited
  // property and resolve to the prototype's function instead of a real retired-field warning string,
  // corrupting the string[] result and suppressing the genuine unknown-field warning.
  const isRetired = (key: string): boolean => Object.prototype.hasOwnProperty.call(RETIRED_FIELD_MIGRATION_WARNINGS, key);
  const retiredWarnings = keys.filter(isRetired).map((key) => RETIRED_FIELD_MIGRATION_WARNINGS[key]!);
  const unknown = keys.filter((key) => !isRetired(key)).map(formatFieldName);
  return [
    ...retiredWarnings,
    ...(unknown.length > 0 ? [`Manifest contains unknown top-level field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`] : []),
  ];
}

function parseCanonicalTopLevelObject(text: string | null | undefined): Record<string, unknown> | null {
  const raw = text ?? "";
  const trimmed = raw.trim();
  if (!trimmed || isOversize(raw)) return null;
  const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  try {
    return topLevelObjectOrNull(looksLikeJson ? JSON.parse(trimmed) : parseYaml(trimmed));
  } catch {
    return null;
  }
}

function parseTopLevelObject(text: string): Record<string, unknown> | null {
  const looksLikeJson = text.startsWith("{") || text.startsWith("[");
  if (looksLikeJson) {
    try {
      const parsed = JSON.parse(text);
      return topLevelObjectOrNull(parsed);
    } catch {
      // YAML flow mappings can start with "{" or "[" while still being valid manifest syntax.
    }
  }
  try {
    return topLevelObjectOrNull(parseYaml(text));
  } catch {
    return null;
  }
}

function topLevelObjectOrNull(parsed: unknown): Record<string, unknown> | null {
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function isOversize(text: string): boolean {
  return text.length > MAX_FOCUS_MANIFEST_BYTES || new TextEncoder().encode(text).byteLength > MAX_FOCUS_MANIFEST_BYTES;
}

function formatFieldName(name: string): string {
  const trimmed = name.replace(/[^\w.-]/g, "_").slice(0, 80);
  return trimmed || "<blank>";
}

function redactManifestWarning(warning: string): string {
  return warning
    .replace(/; ignoring "[^"]*"\./g, "; ignoring the supplied value.")
    .replace(/; ignoring "[^"]*"/g, "; ignoring the supplied value")
    .replace(/falling back to "[^"]*"/g, "falling back to the default");
}
