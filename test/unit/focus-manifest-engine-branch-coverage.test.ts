import { describe, expect, it } from "vitest";

import {
  MAX_FOCUS_MANIFEST_BYTES,
  parseFocusManifest,
  parseFocusManifestContent,
  reviewConfigToJson,
} from "../../packages/gittensory-engine/src/focus-manifest";

describe("focus-manifest engine branch coverage (#2280)", () => {
  it("warns when settings.linkedIssueHardRules is not an object", () => {
    const parsed = parseFocusManifest({ settings: { linkedIssueHardRules: "not-an-object" } });
    expect(parsed.settings.linkedIssueHardRules).toBeUndefined();
    expect(parsed.warnings.some((w) => w.includes('settings.linkedIssueHardRules" must be an object'))).toBe(true);
  });

  it("warns on malformed review.enrichment and unknown analyzer keys", () => {
    const parsed = parseFocusManifest({
      review: {
        enrichment: "not-a-mapping",
      },
    });
    expect(parsed.review.enrichmentAnalyzers).toEqual({});
    expect(parsed.warnings.some((w) => w.includes('review.enrichment" must be a mapping'))).toBe(true);

    const withUnknown = parseFocusManifest({
      review: {
        enrichment: { dependency: true, notARealAnalyzer: false },
      },
    });
    expect(withUnknown.review.enrichmentAnalyzers).toEqual({ dependency: true });
    expect(withUnknown.warnings.some((w) => w.includes('unknown analyzer "notARealAnalyzer"'))).toBe(true);
  });

  it("validates review.labeling_rules entries and reserved gittensor: labels", () => {
    const parsed = parseFocusManifest({
      review: {
        labeling_rules: "not-a-list",
      },
    });
    expect(parsed.review.labelingRules).toEqual([]);
    expect(parsed.warnings.some((w) => w.includes("labeling_rules") && w.includes("list"))).toBe(true);

    const capped = parseFocusManifest({
      review: {
        labeling_rules: Array.from({ length: 51 }, (_, index) => ({
          label: `area:${index}`,
          when_paths: ["src/**"],
        })),
      },
    });
    expect(capped.review.labelingRules).toHaveLength(50);
    expect(capped.warnings.some((w) => w.includes("capped at 50"))).toBe(true);

    const withMissingLabel = parseFocusManifest({
      review: {
        labeling_rules: [{ when_paths: ["src/**"] }],
      },
    });
    expect(withMissingLabel.review.labelingRules).toEqual([]);
    expect(withMissingLabel.warnings.some((w) => w.includes(".label\" is required"))).toBe(true);

    const withRules = parseFocusManifest({
      review: {
        labeling_rules: [
          "not-a-mapping",
          { label: "gittensor:priority", when_paths: ["src/**"] },
          { label: "area:ui", when_paths: ["src/**"] },
          { label: "area:docs", title_contains: "docs" },
          { label: "area:empty" },
        ],
      },
    });
    expect(withRules.review.labelingRules).toEqual([
      { label: "area:ui", whenPaths: ["src/**"], titleContains: null, descriptionContains: null },
      { label: "area:docs", whenPaths: [], titleContains: "docs", descriptionContains: null },
    ]);
    expect(withRules.warnings.some((w) => w.includes("labeling_rules[0]") && w.includes("mapping"))).toBe(true);
    expect(withRules.warnings.some((w) => w.includes('reserved "gittensor:"'))).toBe(true);
    expect(withRules.warnings.some((w) => w.includes("needs at least one of when_paths"))).toBe(true);
  });

  it("serializes labeling_rules optional fields through reviewConfigToJson", () => {
    const manifest = parseFocusManifest({
      review: {
        labeling_rules: [
          {
            label: "area:ui",
            when_paths: ["src/**"],
            title_contains: "feat",
            description_contains: "screenshot",
          },
        ],
      },
    });
    expect(reviewConfigToJson(manifest.review)).toEqual({
      labeling_rules: [
        {
          label: "area:ui",
          when_paths: ["src/**"],
          title_contains: "feat",
          description_contains: "screenshot",
        },
      ],
    });
  });

  it("rejects manifest content whose UTF-8 byte length exceeds MAX_FOCUS_MANIFEST_BYTES", () => {
    const oversized = `wantedPaths:\n  - ${"x".repeat(MAX_FOCUS_MANIFEST_BYTES)}`;
    const parsed = parseFocusManifestContent(oversized);
    expect(parsed.present).toBe(false);
    expect(parsed.warnings.some((w) => w.includes(`${MAX_FOCUS_MANIFEST_BYTES} bytes`))).toBe(true);
  });
});
