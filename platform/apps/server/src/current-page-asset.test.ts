import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ArtifactRef } from "@mobile-automation/shared";
import type { BusinessGraphVersion, BusinessNode, Observation } from "@mobile-automation/graph-core";
import { buildConfirmedPageAssetInput, createConfirmedPageAssetFromCandidate, identifyOrCreateCurrentPageDraft } from "./current-page-asset.js";

describe("identifyOrCreateCurrentPageDraft", () => {
  it("returns matched when the current page matches an active graph node", async () => {
    const home = node({
      id: "node-home",
      key: "home",
      name: "首页",
      status: "active",
      matchers: [{ id: "matcher-home", type: "resource_id", value: "demo:id/home", weight: 3, critical: true }]
    });
    const storage = new MemoryCurrentPageStorage([home]);

    const result = await identifyOrCreateCurrentPageDraft({
      graphVersion: graph([home]),
      observation: observation({ resourceId: "demo:id/home" }),
      storage
    });

    expect(result.status).toBe("matched");
    expect(result.match.node?.id).toBe(home.id);
    expect(storage.createdNodes).toHaveLength(0);
  });

  it("creates a runtime-discovered draft node when current page is unknown", async () => {
    const storage = new MemoryCurrentPageStorage([]);
    const writer = new MemoryArtifactWriter();

    const result = await identifyOrCreateCurrentPageDraft({
      graphVersion: graph([]),
      observation: observation({ resourceId: "demo:id/unknown", text: "未知页" }),
      storage,
      artifactWriter: writer
    });

    expect(result.status).toBe("draft_created");
    if (result.status === "matched") {
      throw new Error("expected draft creation");
    }
    expect(result.node).toEqual(
      expect.objectContaining({
        status: "draft",
        tags: ["runtime-discovered", "needs-review"],
        metadata: expect.objectContaining({
          observationCount: 1,
          artifactIds: [writer.artifacts[0]?.id]
        })
      })
    );
    expect(storage.createdNodes).toHaveLength(1);
    expect(writer.artifacts[0]?.name).toMatch(/^current-page-candidate-/);
  });

  it("summarizes the visual page name separately from the matched state node", async () => {
    const teacherClasses = node({
      id: "node-teacher-classes",
      key: "classin.teacher.classes",
      name: "我是教师班级列表",
      status: "active",
      matchers: [
        { id: "matcher-package", type: "package", value: "cn.eeo.classin", weight: 2 },
        { id: "matcher-home", type: "text", value: "主页", weight: 1 },
        { id: "matcher-teacher", type: "text", value: "我是教师", weight: 3 },
        { id: "matcher-all", type: "text", value: "全部班级", weight: 2 }
      ]
    });
    const storage = new MemoryCurrentPageStorage([teacherClasses]);

    const result = await identifyOrCreateCurrentPageDraft({
      graphVersion: graph([teacherClasses]),
      observation: observation({
        packageName: "cn.eeo.classin",
        resourceId: "cn.eeo.classin:id/home",
        text: "主页",
        extraTexts: ["我是教师", "全部班级", "创建班级"]
      }),
      storage
    });

    expect(result.status).toBe("matched");
    expect(result.match.node?.name).toBe("我是教师班级列表");
    expect(result.visualPageName).toBe("主页");
  });

  it("returns an unsaved page candidate and ignores unconfirmed recording nodes when assetOnly is enabled", async () => {
    const recordingNode = node({
      id: "recording-node",
      key: "recording.1u41ebp",
      name: "录制节点：新建公开课",
      tags: ["manual-recording", "recording-confirmed"],
      status: "active",
      matchers: [
        { id: "matcher-activity", type: "activity", value: ".CreatePublicCourseActivity", weight: 3, critical: true },
        { id: "matcher-title", type: "text", value: "新建公开课", weight: 2, critical: true }
      ]
    });
    const storage = new MemoryCurrentPageStorage([recordingNode]);

    const result = await identifyOrCreateCurrentPageDraft({
      graphVersion: graph([recordingNode]),
      observation: observation({
        resourceId: "cn.eeo.classin:id/create_title",
        text: "新建公开课",
        packageName: "cn.eeo.classin",
        activityName: ".CreatePublicCourseActivity"
      }),
      storage,
      assetOnly: true
    });

    expect(result.status).toBe("draft_candidate");
    if (result.status === "matched") {
      throw new Error("expected asset-only detection to ignore recording node");
    }
    expect(result.node?.key).not.toBe(recordingNode.key);
    expect(result.node?.tags).toEqual(["runtime-discovered", "needs-review"]);
    expect(storage.createdNodes).toHaveLength(0);
  });

  it("ignores confirmed page-state overlays when assetOnly is matching the stable current page", async () => {
    const overlay = node({
      id: "overlay-node",
      key: "classin.home.more",
      name: "主页-更多操作",
      nodeType: "business_state",
      tags: ["page-state", "page-overlay", "asset-recording"],
      status: "active",
      matchers: [
        { id: "matcher-package", type: "package", value: "cn.eeo.classin", weight: 1 },
        { id: "matcher-add-friend", type: "ocr_text", value: "添加好友", weight: 3, critical: true, platformScope: "mobile-both" }
      ],
      metadata: {
        assetRecordingConfirmed: true,
        assetKind: "overlay",
        parentPageName: "主页"
      }
    });
    const storage = new MemoryCurrentPageStorage([overlay]);

    const result = await identifyOrCreateCurrentPageDraft({
      graphVersion: graph([overlay]),
      observation: observation({
        resourceId: "cn.eeo.classin:id/home",
        text: "主页",
        extraTexts: ["添加好友", "加入班级", "加入公开课", "扫一扫"],
        packageName: "cn.eeo.classin",
        activityName: ".MainActivity",
        ocrTexts: [{ text: "添加好友", source: "ocr" }]
      }),
      storage,
      assetOnly: true
    });

    expect(result.status).toBe("draft_candidate");
    expect(result.match.candidates.map((candidate) => candidate.node.id)).not.toContain(overlay.id);
    expect(storage.createdNodes).toHaveLength(0);
  });

  it("exposes PageMatcher diagnostics for asset-only page matching", async () => {
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      status: "active",
      matchers: [
        { id: "matcher-package", type: "package", value: "cn.eeo.classin", weight: 2, critical: true },
        { id: "matcher-title", type: "text", value: "主页", weight: 2, critical: true },
        { id: "matcher-teacher", type: "ocr_text", value: "我是教师", weight: 1.8, critical: true, platformScope: "mobile-both" }
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await identifyOrCreateCurrentPageDraft({
      graphVersion: graph([home]),
      observation: observation({
        resourceId: "cn.eeo.classin:id/home",
        text: "主页",
        packageName: "cn.eeo.classin",
        activityName: ".MainActivity",
        ocrTexts: [{ text: "我是教师", source: "ocr" }]
      }),
      storage: new MemoryCurrentPageStorage([home]),
      assetOnly: true
    });

    expect(result.status).toBe("matched");
    expect(result.matcherDiagnostics).toEqual(
      expect.objectContaining({
        status: "matched",
        matchedNode: expect.objectContaining({ id: "node-home", name: "主页" }),
        matchedEvidence: expect.arrayContaining([
          expect.objectContaining({ type: "package", expected: "cn.eeo.classin", matched: true }),
          expect.objectContaining({ type: "text", expected: "主页", matched: true }),
          expect.objectContaining({ type: "ocr_text", expected: "我是教师", matched: true })
        ]),
        missingEvidence: []
      })
    );
  });

  it("exposes missing PageMatcher evidence for asset-only unknown pages", async () => {
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      status: "active",
      matchers: [
        { id: "matcher-package", type: "package", value: "cn.eeo.classin", weight: 2, critical: true },
        { id: "matcher-title", type: "text", value: "主页", weight: 2, critical: true },
        { id: "matcher-teacher", type: "ocr_text", value: "我是教师", weight: 1.8, critical: true, platformScope: "mobile-both" }
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await identifyOrCreateCurrentPageDraft({
      graphVersion: graph([home]),
      observation: observation({
        resourceId: "cn.eeo.classin:id/message",
        text: "消息",
        packageName: "cn.eeo.classin",
        activityName: ".MainActivity",
        ocrTexts: [{ text: "通知", source: "ocr" }]
      }),
      storage: new MemoryCurrentPageStorage([home]),
      assetOnly: true
    });

    expect(result.status).toBe("draft_candidate");
    expect(result.matcherDiagnostics).toEqual(
      expect.objectContaining({
        status: "unknown",
        topCandidate: expect.objectContaining({ nodeId: "node-home" }),
        matchedEvidence: [expect.objectContaining({ type: "package", expected: "cn.eeo.classin", matched: true })],
        missingEvidence: expect.arrayContaining([
          expect.objectContaining({ type: "text", expected: "主页", matched: false }),
          expect.objectContaining({ type: "ocr_text", expected: "我是教师", matched: false })
        ])
      })
    );
  });

  it("keeps a local popup menu attached to the matched parent page asset", async () => {
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      status: "active",
      matchers: [
        { id: "matcher-package", type: "package", value: "cn.eeo.classin", weight: 1 },
        { id: "matcher-title", type: "ocr_text", value: "主页", weight: 2, critical: true, region: { x: 8, y: 8, width: 18, height: 8 }, platformScope: "mobile-both" },
        { id: "matcher-create-class", type: "ocr_text", value: "创建班级", weight: 2, critical: true, region: { x: 5, y: 15, width: 35, height: 15 } }
      ],
      metadata: { assetRecordingConfirmed: true, pageName: "主页" }
    });

    const result = await identifyOrCreateCurrentPageDraft({
      graphVersion: graph([home]),
      observation: observation({
        resourceId: "cn.eeo.classin:id/home",
        text: "主页",
        extraTexts: ["添加好友", "加入班级", "加入公开课", "扫一扫"],
        packageName: "cn.eeo.classin",
        activityName: ".MainActivity",
        resolution: { width: 1080, height: 2340 },
        ocrTexts: [
          { text: "主页", source: "ocr", region: { x: 226, y: 280, width: 118, height: 50 } },
          { text: "添加好友", source: "ocr", region: { x: 770, y: 565, width: 160, height: 50 } },
          { text: "加入班级", source: "ocr", region: { x: 770, y: 645, width: 160, height: 50 } },
          { text: "加入公开课", source: "ocr", region: { x: 770, y: 725, width: 190, height: 50 } },
          { text: "扫一扫", source: "ocr", region: { x: 770, y: 805, width: 130, height: 50 } }
        ]
      }),
      storage: new MemoryCurrentPageStorage([home]),
      assetOnly: true
    });

    expect(result.status).toBe("matched");
    expect(result.match.node?.id).toBe(home.id);
    expect(result.visualPageName).toBe("主页");
  });

  it("creates confirmed page assets from explicit confirmed evidence only", () => {
    const storage = new MemoryCurrentPageStorage([]);
    const node = createConfirmedPageAssetFromCandidate({
      graphVersionId: "version-1",
      observation: observation({
        resourceId: "demo:id/home",
        text: "候选文字",
        extraTexts: ["未确认文字"],
        packageName: "cn.eeo.classin",
        activityName: ".MainActivity"
      }),
      storage,
      draft: {
        key: "classin.home",
        name: "主页",
        tags: ["page-asset", "asset-recording"],
        metadata: {
          confirmedMatchers: ["package:cn.eeo.classin"],
          confirmedUiTexts: ["候选文字"],
          confirmedOcrTexts: ["OCR标题"]
        }
      }
    });

    expect(node.matchers).toEqual([
      expect.objectContaining({ type: "ocr_text", value: "OCR标题", critical: true })
    ]);
    expect(node.matchers.map((matcher) => matcher.type)).not.toContain("package");
    expect(node.matchers.map((matcher) => matcher.type)).not.toContain("text");
    expect(node.matchers.map((matcher) => matcher.value)).not.toContain("未确认文字");
  });

  it("rejects platform-only page identity evidence", () => {
    const storage = new MemoryCurrentPageStorage([]);
    expect(() =>
      createConfirmedPageAssetFromCandidate({
        graphVersionId: "version-1",
        observation: observation({
          resourceId: "cn.eeo.classin:id/home",
          text: "主页",
          packageName: "cn.eeo.classin",
          activityName: ".MainActivity"
        }),
        storage,
        draft: {
          key: "classin.home",
          name: "主页",
          tags: ["page-asset", "asset-recording"],
          metadata: {
            confirmedMatchers: ["package:cn.eeo.classin", "resource-id:cn.eeo.classin:id/home", "activity:.MainActivity"],
            confirmedUiTexts: ["主页"]
          }
        }
      })
    ).toThrow("confirmed matching evidence");
  });

  it("rejects confirmed page assets that have no confirmed matching evidence", () => {
    const storage = new MemoryCurrentPageStorage([]);
    expect(() =>
      createConfirmedPageAssetFromCandidate({
        graphVersionId: "version-1",
        observation: observation({
          resourceId: "demo:id/home",
          text: "候选文字",
          extraTexts: ["未确认文字"],
          packageName: "cn.eeo.classin",
          activityName: ".MainActivity"
        }),
        storage,
        draft: {
          key: "classin.home",
          name: "主页",
          tags: ["page-asset", "asset-recording"],
          metadata: {}
        }
      })
    ).toThrow("confirmed matching evidence");
  });

  it("stores screenshot focus regions as metadata until a visual baseline is available", () => {
    const storage = new MemoryCurrentPageStorage([]);
    const node = createConfirmedPageAssetFromCandidate({
      graphVersionId: "version-1",
      observation: observation({
        resourceId: "cn.eeo.classin:id/menu",
        text: "主页",
        extraTexts: ["添加好友", "加入班级", "扫一扫"],
        ocrTexts: [
          { text: "添加好友", region: { x: 760, y: 150, width: 120, height: 40 } },
          { text: "主页", region: { x: 40, y: 2100, width: 80, height: 48 } }
        ],
        resolution: { width: 1080, height: 2400 }
      }),
      storage,
      draft: {
        key: "classin.home.more",
        name: "主页-更多操作",
        tags: ["page-state", "page-overlay", "asset-recording"],
        metadata: {
          assetKind: "overlay",
          confirmedOcrTexts: ["主页"],
          screenshotRegions: [
            {
              id: "region-more-menu",
              label: "更多菜单",
              x: 65,
              y: 3,
              width: 32,
              height: 22
            }
          ]
        }
      }
    });

    expect(node.matchers.some((matcher) => matcher.type === "image_region")).toBe(false);
    expect(node.metadata?.screenshotRegions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "region-more-menu",
          signature: expect.stringContaining(encodeURIComponent("添加好友")),
          evidenceTexts: expect.arrayContaining(["添加好友"])
        })
      ])
    );
  });

  it("can bind screenshot focus regions to visual baseline artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "page-asset-baseline-"));
    try {
      const artifacts: ArtifactRef[] = [];
      const nodeInput = await buildConfirmedPageAssetInput({
        graphVersionId: "version-1",
        observation: observation({
          resourceId: "cn.eeo.classin:id/menu",
          text: "主页",
          extraTexts: ["添加好友"],
          ocrTexts: [{ text: "添加好友", region: { x: 760, y: 150, width: 120, height: 40 } }],
          resolution: { width: 1080, height: 2400 },
          screenshotBase64: Buffer.from("baseline-home-more").toString("base64")
        }),
        draft: {
          key: "classin.home.more",
          name: "主页-更多操作",
          tags: ["page-state", "page-overlay", "asset-recording"],
          metadata: {
            assetKind: "overlay",
            screenshotRegions: [
              {
                id: "region-more-menu",
                label: "更多菜单",
                x: 65,
                y: 3,
                width: 32,
                height: 22,
                ignoreRegions: [{ x: 10, y: 10, width: 12, height: 8 }]
              }
            ]
          }
        },
        assetWriter: async (relativePath, bytes) => {
          const absolutePath = path.join(tempRoot, relativePath);
          await mkdir(path.dirname(absolutePath), { recursive: true });
          await writeFile(absolutePath, bytes);
          const artifact = {
            id: `artifact-${artifacts.length + 1}`,
            type: "screenshot" as const,
            name: path.basename(relativePath),
            path: relativePath,
            url: `/artifacts/${relativePath}`,
            mimeType: "image/png",
            sizeBytes: (await stat(absolutePath)).size,
            createdAt: "2026-06-14T10:00:00.000Z"
          };
          artifacts.push(artifact);
          return artifact;
        }
      });

      const imageMatcher = nodeInput.matchers.find((matcher) => matcher.type === "image_region");
      const semanticMatcher = nodeInput.matchers.find((matcher) => matcher.type === "semantic_image_region");
      expect(imageMatcher?.source?.artifactId).toBe("artifact-1");
      expect(imageMatcher?.ignoreRegions).toEqual([{ x: 10, y: 10, width: 12, height: 8 }]);
      expect(semanticMatcher).toEqual(
        expect.objectContaining({
          type: "semantic_image_region",
          value: expect.stringMatching(/^semantic-image-region:region-more-menu:/),
          threshold: 0.68,
          critical: false,
          platformScope: "mobile-both",
          region: { x: 65, y: 3, width: 32, height: 22 },
          semanticArea: "top",
          coordinateSpace: "screen",
          ignoreRegions: [{ x: 10, y: 10, width: 12, height: 8 }]
        })
      );
      expect(nodeInput.matchers).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ocr_text",
            value: "添加好友",
            critical: true,
            region: { x: 65, y: 3, width: 32, height: 22 }
          })
        ])
      );
      expect(nodeInput.metadata?.screenshotRegions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            baselineArtifactId: "artifact-1",
            baselinePath: expect.stringContaining("classin.home.more-region-more-menu"),
            semanticArea: "top",
            coordinateSpace: "screen",
            ignoreRegions: [{ x: 10, y: 10, width: 12, height: 8 }]
          })
        ])
      );
    expect(await readFile(path.join(tempRoot, artifacts[0]!.path), "utf8")).toBe("baseline-home-more");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
  });

  it("crops screenshot focus baselines using the png dimensions instead of observation resolution", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "page-asset-png-size-"));
    try {
      const screenshot = await makeSolidPng(100, 100, "white");
      const artifacts: ArtifactRef[] = [];
      await buildConfirmedPageAssetInput({
        graphVersionId: "version-1",
        observation: observation({
          resourceId: "cn.eeo.classin:id/menu",
          text: "主页",
          resolution: { width: 100, height: 200 },
          screenshotBase64: screenshot.toString("base64")
        }),
        draft: {
          key: "classin.home",
          name: "主页",
          tags: ["page-asset", "asset-recording"],
          metadata: {
            screenshotRegions: [
              {
                id: "bottom-tabs",
                label: "底部 Tab",
                x: 0,
                y: 90,
                width: 100,
                height: 10
              }
            ]
          }
        },
        assetWriter: async (relativePath, bytes) => {
          const absolutePath = path.join(tempRoot, relativePath);
          await mkdir(path.dirname(absolutePath), { recursive: true });
          await writeFile(absolutePath, bytes);
          const artifact = {
            id: `artifact-${artifacts.length + 1}`,
            type: "screenshot" as const,
            name: path.basename(relativePath),
            path: relativePath,
            url: `/artifacts/${relativePath}`,
            mimeType: "image/png",
            sizeBytes: (await stat(absolutePath)).size,
            createdAt: "2026-06-14T10:00:00.000Z"
          };
          artifacts.push(artifact);
          return artifact;
        }
      });

      expect(await pngDimensions(path.join(tempRoot, artifacts[0]!.path))).toEqual({ width: 100, height: 10 });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not match saved overlays as stable current pages even when visual baselines match", async () => {
    const baseline = Buffer.from("same-region-image");
    const overlay = node({
      id: "node-home-more",
      key: "classin.home.more",
      name: "主页-更多操作",
      nodeType: "business_state",
      tags: ["page-state", "page-overlay", "asset-recording"],
      status: "active",
      matchers: [
        {
          id: "matcher-region",
          type: "image_region",
          value: "screenshot-region:region-more-menu:%E6%B7%BB%E5%8A%A0%E5%A5%BD%E5%8F%8B",
          weight: 3,
          critical: true,
          threshold: 0.9,
          platformScope: "mobile-both",
          region: { x: 65, y: 3, width: 32, height: 22 },
          source: { sourceType: "manual_edit", artifactId: "artifact-region" }
        }
      ]
    });

    const result = await identifyOrCreateCurrentPageDraft({
      graphVersion: graph([overlay]),
      observation: observation({
        resourceId: "cn.eeo.classin:id/message",
        text: "消息",
        resolution: { width: 1080, height: 2400 },
        screenshotBase64: baseline.toString("base64")
      }),
      storage: new MemoryCurrentPageStorage([overlay]),
      assetOnly: true,
      baselineReader: async (artifactId) => (artifactId === "artifact-region" ? baseline : undefined)
    });

    expect(result.status).toBe("draft_candidate");
    expect(result.match.status).toBe("unknown");
    expect(result.match.candidates.map((candidate) => candidate.node.id)).not.toContain("node-home-more");
    expect(result.observation.imageRegions).toBeUndefined();
  });

  it("does not match a saved overlay when only weak text matches outside the screenshot focus region", async () => {
    const storage = new MemoryCurrentPageStorage([]);
    const overlay = node({
      id: "node-home-more",
      key: "classin.home.more",
      name: "主页-更多操作",
      nodeType: "business_state",
      tags: ["page-state", "page-overlay", "asset-recording"],
      status: "active",
      matchers: [
        { id: "matcher-home", type: "ocr_text", value: "主页", weight: 1.8, critical: true, platformScope: "mobile-both" },
        {
          id: "matcher-region",
          type: "image_region",
          value: "screenshot-region:region-more-menu:%E6%B7%BB%E5%8A%A0%E5%A5%BD%E5%8F%8B%7C%E5%8A%A0%E5%85%A5%E7%8F%AD%E7%BA%A7",
          weight: 3,
          critical: true,
          threshold: 0.9,
          platformScope: "mobile-both",
          region: { x: 65, y: 3, width: 32, height: 22 }
        }
      ],
      metadata: {
        assetRecordingConfirmed: true,
        assetKind: "overlay",
        screenshotRegions: [{ id: "region-more-menu", label: "更多菜单", x: 65, y: 3, width: 32, height: 22 }]
      }
    });

    const result = await identifyOrCreateCurrentPageDraft({
      graphVersion: graph([overlay]),
      observation: observation({
        resourceId: "cn.eeo.classin:id/message",
        text: "消息",
        ocrTexts: [{ text: "主页", region: { x: 40, y: 2100, width: 80, height: 48 } }],
        resolution: { width: 1080, height: 2400 }
      }),
      storage,
      assetOnly: true
    });

    expect(result.status).toBe("draft_candidate");
    expect(result.match.status).toBe("unknown");
    expect(result.match.candidates.map((candidate) => candidate.node.id)).not.toContain(overlay.id);
  });

  it("does not synthesize screenshot region matchers for previously saved assets without baselines", async () => {
    const storage = new MemoryCurrentPageStorage([]);
    const overlay = node({
      id: "node-home-more",
      key: "classin.home.more",
      name: "主页-更多操作",
      nodeType: "business_state",
      tags: ["page-state", "page-overlay", "asset-recording"],
      status: "active",
      matchers: [{ id: "matcher-home", type: "ocr_text", value: "主页", weight: 1.8, critical: true, platformScope: "mobile-both" }],
      metadata: {
        assetRecordingConfirmed: true,
        assetKind: "overlay",
        screenshotRegions: [{ id: "region-more-menu", label: "更多菜单", x: 65, y: 3, width: 32, height: 22 }]
      }
    });

    const result = await identifyOrCreateCurrentPageDraft({
      graphVersion: graph([overlay]),
      observation: observation({
        resourceId: "cn.eeo.classin:id/message",
        text: "消息",
        ocrTexts: [{ text: "主页", region: { x: 40, y: 2100, width: 80, height: 48 } }],
        resolution: { width: 1080, height: 2400 }
      }),
      storage,
      assetOnly: true
    });

    expect(result.status).toBe("draft_candidate");
    expect(result.match.status).toBe("unknown");
    expect(result.match.candidates.map((candidate) => candidate.node.id)).not.toContain(overlay.id);
  });

  it("does not let legacy screenshot regions without visual baselines block an otherwise matched page asset", async () => {
    const storage = new MemoryCurrentPageStorage([]);
    const home = node({
      id: "node-home",
      key: "classin.teacher.classes",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      status: "active",
      matchers: [
        { id: "matcher-package", type: "package", value: "cn.eeo.classin", weight: 2 },
        { id: "matcher-home", type: "text", value: "主页", weight: 1 },
        { id: "matcher-teacher", type: "text", value: "我是教师", weight: 3 },
        { id: "matcher-all", type: "text", value: "全部班级", weight: 2 },
        { id: "matcher-create", type: "text", value: "创建班级", weight: 2 }
      ],
      metadata: {
        assetRecordingConfirmed: true,
        pageName: "主页",
        screenshotRegions: [{ id: "region-home-title", label: "标题区域", x: 28, y: 6, width: 16, height: 8 }]
      }
    });

    const result = await identifyOrCreateCurrentPageDraft({
      graphVersion: graph([home]),
      observation: observation({
        packageName: "cn.eeo.classin",
        resourceId: "cn.eeo.classin:id/home",
        text: "主页",
        extraTexts: ["我是教师", "全部班级", "创建班级"],
        resolution: { width: 1080, height: 2340 }
      }),
      storage,
      assetOnly: true
    });

    expect(result.status).toBe("matched");
    expect(result.match.node?.id).toBe(home.id);
    expect(result.match.candidates[0]?.matcherResults.some((matcher) => matcher.type === "image_region")).toBe(false);
  });

  it("stores OCR evidence as mobile-both and keeps UI-tree/platform evidence out of formal identity", () => {
    const storage = new MemoryCurrentPageStorage([]);
    const node = createConfirmedPageAssetFromCandidate({
      graphVersionId: "version-1",
      observation: observation({
        resourceId: "cn.eeo.classin:id/home",
        text: "主页",
        packageName: "cn.eeo.classin",
        activityName: ".MainActivity"
      }),
      storage,
      draft: {
        key: "classin.home",
        name: "主页",
        tags: ["page-asset", "asset-recording"],
        metadata: {
          confirmedMatchers: ["package:cn.eeo.classin", "resource-id:cn.eeo.classin:id/home"],
          confirmedUiTexts: ["主页"],
          confirmedOcrTexts: ["消息"]
        }
      }
    });

    expect(node.matchers).toEqual(
      [
        expect.objectContaining({ type: "ocr_text", value: "消息", platformScope: "mobile-both" })
      ]
    );
    expect(node.matchers.map((matcher) => matcher.type)).not.toContain("package");
    expect(node.matchers.map((matcher) => matcher.type)).not.toContain("resource_id");
    expect(node.matchers.map((matcher) => matcher.type)).not.toContain("text");
  });

  it("can persist OCR evidence with an explicit matching region", () => {
    const storage = new MemoryCurrentPageStorage([]);
    const node = createConfirmedPageAssetFromCandidate({
      graphVersionId: "version-1",
      observation: observation({
        resourceId: "cn.eeo.classin:id/message",
        text: "消息",
        packageName: "cn.eeo.classin",
        activityName: ".MainActivity"
      }),
      storage,
      draft: {
        key: "classin.message",
        name: "消息",
        tags: ["page-asset", "asset-recording"],
        metadata: {
          confirmedOcrTexts: ["ocr_text:消息@region(15,7,18,6)"]
        }
      }
    });

    expect(node.matchers).toEqual([
      expect.objectContaining({
        type: "ocr_text",
        value: "消息",
        platformScope: "mobile-both",
        region: { x: 15, y: 7, width: 18, height: 6 },
        semanticArea: "top",
        coordinateSpace: "screen"
      })
    ]);
  });

  it("rejects platform-looking OCR evidence from formal page identity", () => {
    const storage = new MemoryCurrentPageStorage([]);

    expect(() =>
      createConfirmedPageAssetFromCandidate({
        graphVersionId: "version-1",
        observation: observation({
          resourceId: "cn.eeo.classin:id/home",
          text: "主页",
          packageName: "cn.eeo.classin",
          activityName: ".MainActivity"
        }),
        storage,
        draft: {
          key: "classin.home",
          name: "主页",
          tags: ["page-asset", "asset-recording"],
          metadata: {
            confirmedOcrTexts: [
              "resource-id:cn.eeo.classin:id/home",
              "package:cn.eeo.classin",
              "class:android.view.View",
              "android.widget.TextView"
            ]
          }
        }
      })
    ).toThrow("Page asset requires confirmed matching evidence");
  });

  it("creates confirmed overlay assets as business states bound to a parent page", () => {
    const storage = new MemoryCurrentPageStorage([]);
    const node = createConfirmedPageAssetFromCandidate({
      graphVersionId: "version-1",
      observation: observation({
        resourceId: "cn.eeo.classin:id/add_menu",
        text: "添加好友",
        extraTexts: ["加入班级", "加入公开课", "扫一扫"],
        packageName: "cn.eeo.classin",
        activityName: ".MainActivity"
      }),
      storage,
      draft: {
        key: "classin.home.add_menu",
        name: "主页添加菜单",
        tags: ["page-asset", "asset-recording"],
        metadata: {
          assetKind: "overlay",
          parentPageId: "node-home",
          parentPageName: "主页",
          overlayType: "popup_menu",
          overlayBehavior: "blocking",
          closeAction: "back",
          confirmedUiTexts: ["添加好友", "加入班级", "加入公开课", "扫一扫"],
          confirmedOcrTexts: ["添加好友"]
        }
      }
    });

    expect(node.nodeType).toBe("business_state");
    expect(node.tags).toEqual(expect.arrayContaining(["page-overlay", "page-state", "asset-recording"]));
    expect(node.metadata).toEqual(
      expect.objectContaining({
        assetKind: "overlay",
        parentPageId: "node-home",
        parentPageName: "主页",
        overlayType: "popup_menu",
        overlayBehavior: "blocking",
        closeAction: "back"
      })
    );
  });

  it("persists non-blocking overlay behavior for attached page states", () => {
    const storage = new MemoryCurrentPageStorage([]);
    const node = createConfirmedPageAssetFromCandidate({
      graphVersionId: "version-1",
      observation: observation({
        resourceId: "cn.eeo.classin:id/active_course_bar",
        text: "上课",
        extraTexts: ["主页", "创建班级"],
        packageName: "cn.eeo.classin",
        activityName: ".MainActivity"
      }),
      storage,
      draft: {
        key: "classin.home.active_course_bar",
        name: "主页-上课悬浮条",
        tags: ["page-asset", "asset-recording"],
        metadata: {
          assetKind: "overlay",
          parentPageName: "主页",
          overlayType: "attached_overlay",
          overlayBehavior: "non_blocking",
          closeAction: "",
          confirmedUiTexts: ["上课"],
          confirmedOcrTexts: ["上课"]
        }
      }
    });

    expect(node.nodeType).toBe("business_state");
    expect(node.tags).toEqual(expect.arrayContaining(["page-overlay", "page-state", "asset-recording"]));
    expect(node.metadata).toEqual(
      expect.objectContaining({
        assetKind: "overlay",
        parentPageName: "主页",
        overlayType: "attached_overlay",
        overlayBehavior: "non_blocking"
      })
    );
  });

  it("clears stale close actions when an existing overlay becomes a page state", () => {
    const storage = new MemoryCurrentPageStorage([
      node({
        id: "node-active-course-bar",
        key: "classin.home.active_course_bar",
        name: "主页-上课悬浮条",
        nodeType: "business_state",
        tags: ["page-overlay", "page-state", "asset-recording"],
        status: "active",
        matchers: [],
        metadata: {
          assetRecordingConfirmed: true,
          assetKind: "overlay",
          parentPageName: "主页",
          overlayType: "attached_overlay",
          overlayBehavior: "blocking",
          closeAction: "back"
        }
      })
    ]);

    const updated = createConfirmedPageAssetFromCandidate({
      graphVersionId: "version-1",
      observation: observation({
        resourceId: "cn.eeo.classin:id/active_course_bar",
        text: "上课",
        extraTexts: ["主页"]
      }),
      storage,
      draft: {
        key: "classin.home.active_course_bar",
        name: "主页-上课状态",
        tags: ["page-overlay", "page-state", "asset-recording"],
        metadata: {
          assetKind: "overlay",
          parentPageName: "主页",
          overlayType: "page_state",
          overlayBehavior: "page_state",
          closeAction: "",
          confirmedUiTexts: ["上课"],
          confirmedOcrTexts: ["上课"]
        }
      }
    });

    expect(updated.metadata).toEqual(
      expect.objectContaining({
        overlayType: "page_state",
        overlayBehavior: "page_state"
      })
    );
    expect(updated.metadata?.closeAction).toBe("");
  });
});

class MemoryCurrentPageStorage {
  createdNodes: BusinessNode[] = [];

  constructor(private readonly nodes: BusinessNode[]) {}

  findBusinessNodeByKey(_graphVersionId: string, key: string): BusinessNode | undefined {
    return [...this.nodes, ...this.createdNodes].find((node) => node.key === key);
  }

  createBusinessNode(input: Omit<BusinessNode, "id"> & { id?: string }): BusinessNode {
    const node = {
      ...input,
      id: input.id ?? `node-${this.createdNodes.length + 1}`
    };
    this.createdNodes.push(node);
    return node;
  }

  updateBusinessNodeMetadata(nodeId: string, metadata: Record<string, unknown>): BusinessNode | undefined {
    const node = [...this.nodes, ...this.createdNodes].find((item) => item.id === nodeId);
    if (!node) {
      return undefined;
    }
    node.metadata = metadata;
    return node;
  }

  updateBusinessNodeDetails(
    nodeId: string,
    input: {
      key?: string;
      name?: string;
      nodeType?: BusinessNode["nodeType"];
      tags?: string[];
      matchers?: BusinessNode["matchers"];
      platformScope?: BusinessNode["platformScope"];
      metadata?: Record<string, unknown>;
      status?: BusinessNode["status"];
    }
  ): BusinessNode | undefined {
    const node = [...this.nodes, ...this.createdNodes].find((item) => item.id === nodeId);
    if (!node) {
      return undefined;
    }
    Object.assign(node, input);
    return node;
  }
}

class MemoryArtifactWriter {
  artifacts: ArtifactRef[] = [];

  async writeLog(runId: string, name: string, _content: string): Promise<ArtifactRef> {
    const artifact = {
      id: `artifact-${this.artifacts.length + 1}`,
      runId,
      type: "log" as const,
      name,
      path: `runs/${runId}/logs/${name}`,
      url: `/artifacts/runs/${runId}/logs/${name}`,
      createdAt: "2026-06-14T10:00:00.000Z"
    };
    this.artifacts.push(artifact);
    return artifact;
  }
}

function graph(nodes: BusinessNode[]): BusinessGraphVersion {
  return {
    id: "version-1",
    graphId: "graph-1",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes,
    edges: [],
    createdAt: "2026-06-14T10:00:00.000Z"
  };
}

function node(input: Partial<BusinessNode> & { id: string; key: string; name: string }): BusinessNode {
  return {
    graphVersionId: "version-1",
    nodeType: "page",
    tags: [],
    status: "active",
    matchers: [],
    defaultExpectations: [],
    ...input
  };
}

function observation(input: {
  resourceId: string;
  text?: string;
  extraTexts?: string[];
  packageName?: string;
  activityName?: string;
  ocrTexts?: Observation["ocrTexts"];
  resolution?: Observation["resolution"];
  screenshotBase64?: string;
}): Observation {
  const texts = [input.text ?? "首页", ...(input.extraTexts ?? [])];
  return {
    id: "observation-1",
    platform: "android",
    capturedAt: "2026-06-14T10:00:00.000Z",
    packageName: input.packageName ?? "demo",
    activityName: input.activityName ?? ".MainActivity",
    resolution: input.resolution,
    uiElements: texts.map((text, index) => ({
        resourceId: input.resourceId,
        text,
        visible: true,
        enabled: true,
        bounds: input.resolution
          ? {
              x: 720 + index * 20,
              y: 160 + index * 56,
              width: 160,
              height: 44
            }
          : undefined
    })),
    ocrTexts: input.ocrTexts ?? [],
    raw: input.screenshotBase64 ? { screenshotBase64: input.screenshotBase64 } : undefined
  };
}

async function makeSolidPng(width: number, height: number, color: string): Promise<Buffer> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "page-asset-test-image-"));
  const outputPath = path.join(tempRoot, "solid.png");
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=${width}x${height}`,
      "-frames:v",
      "1",
      outputPath
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function pngDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const output = await execFileText("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=s=x:p=0",
    filePath
  ]);
  const [width, height] = output.trim().split("x").map(Number);
  return { width, height };
}

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10000, encoding: "utf8", maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve();
    });
  });
}

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10000, encoding: "utf8", maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}
