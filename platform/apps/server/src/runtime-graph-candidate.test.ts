import { describe, expect, it } from "vitest";
import type { NodeMatchResult, Observation } from "@mobile-automation/graph-core";
import { buildRuntimeUnknownNodeCandidate, mergeRuntimeUnknownNodeMetadata } from "./runtime-graph-candidate.js";

describe("runtime graph candidates", () => {
  it("builds a draft node from the current observation with stable semantic matchers", () => {
    const observation = observationFixture();
    const candidate = buildRuntimeUnknownNodeCandidate("version-1", observation, unknownMatch());

    expect(candidate).toEqual(
      expect.objectContaining({
        graphVersionId: "version-1",
        key: expect.stringMatching(/^runtime\.unknown\./),
        name: "运行期未知节点：我是教师",
        nodeType: "page",
        status: "draft",
        tags: ["runtime-discovered", "needs-review"],
        platformScope: "android"
      })
    );
    expect(candidate.matchers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "package", value: "cn.eeo.classin", critical: true }),
        expect.objectContaining({ type: "activity", value: ".MainActivity", critical: true }),
        expect.objectContaining({ type: "resource_id", value: "cn.eeo.classin:id/teacher", critical: true }),
        expect.objectContaining({ type: "text", value: "我是教师", critical: true })
      ])
    );
    expect(candidate.metadata).toEqual(
      expect.objectContaining({
        source: "runtime_unknown_state",
        visibleTexts: ["我是教师", "首页", "课堂"],
        resourceIds: ["cn.eeo.classin:id/teacher"],
        createdFrom: expect.objectContaining({ capturedAt: observation.capturedAt })
      })
    );
  });

  it("merges duplicate unknown-node metadata and appends artifact history", () => {
    const merged = mergeRuntimeUnknownNodeMetadata(
      {
        artifactId: "artifact-1",
        artifactIds: ["artifact-1"],
        observationCount: 2,
        firstObservedAt: "2026-06-14T09:00:00.000Z",
        lastObservedAt: "2026-06-14T09:01:00.000Z"
      },
      {
        visibleTexts: ["首页"],
        resourceIds: ["cn.eeo.classin:id/teacher"]
      },
      "artifact-2"
    );

    expect(merged).toEqual(
      expect.objectContaining({
        artifactId: "artifact-2",
        artifactIds: ["artifact-1", "artifact-2"],
        observationCount: 3,
        firstObservedAt: "2026-06-14T09:00:00.000Z",
        visibleTexts: ["首页"],
        resourceIds: ["cn.eeo.classin:id/teacher"]
      })
    );
  });
});

function observationFixture(): Observation {
  return {
    id: "observation-1",
    deviceSerial: "device-1",
    platform: "android",
    capturedAt: "2026-06-14T10:00:00.000Z",
    packageName: "cn.eeo.classin",
    activityName: ".MainActivity",
    componentName: "cn.eeo.classin/.MainActivity",
    uiElements: [
      {
        resourceId: "cn.eeo.classin:id/teacher",
        text: "我是教师",
        className: "android.widget.TextView",
        enabled: true,
        visible: true
      }
    ],
    ocrTexts: [
      { text: "首页", source: "ocr" },
      { text: "课堂", source: "ocr" }
    ]
  };
}

function unknownMatch(): NodeMatchResult {
  return {
    status: "unknown",
    capturedAt: "2026-06-14T10:00:00.000Z",
    score: 0,
    candidates: [],
    threshold: 0.6
  };
}
