import { describe, expect, it } from "vitest";
import {
  appIdentifierFromObservation,
  isObservationInsideTargetApp,
  normalizeTargetAppId,
  resolveRuntimeAppIdentifier
} from "./target-app-runtime.js";

describe("target app runtime identity", () => {
  it("maps ClassIn to the Android package by default", () => {
    expect(
      resolveRuntimeAppIdentifier({
        appId: "classin",
        platform: "android",
        env: {}
      })
    ).toBe("cn.eeo.classin");
  });

  it("maps ClassIn to configured iOS bundleId", () => {
    expect(
      resolveRuntimeAppIdentifier({
        appId: "classin",
        platform: "ios",
        env: { CLASSIN_IOS_BUNDLE_ID: "com.eeo.classin.ios" }
      })
    ).toBe("com.eeo.classin.ios");
  });

  it("maps ClassIn to configured HarmonyOS bundleId", () => {
    expect(
      resolveRuntimeAppIdentifier({
        appId: "classin",
        platform: "harmony",
        env: { CLASSIN_HARMONY_BUNDLE_ID: "com.eeo.classin.harmony" }
      })
    ).toBe("com.eeo.classin.harmony");
  });

  it("uses the ClassIn HarmonyOS bundleId by default", () => {
    expect(
      resolveRuntimeAppIdentifier({
        appId: "classin",
        platform: "harmony",
        env: {}
      })
    ).toBe("cn.eeo.hos.classin.mobile");
  });

  it("normalizes known ClassIn runtime identifiers to the cross-platform product id", () => {
    expect(normalizeTargetAppId("cn.eeo.classin")).toBe("classin");
    expect(normalizeTargetAppId("cn.eeo.hos.classin.mobile")).toBe("classin");
    expect(normalizeTargetAppId(" classin ")).toBe("classin");
    expect(normalizeTargetAppId("com.demo.notes")).toBe("com.demo.notes");
  });

  it("keeps non-ClassIn app ids unchanged", () => {
    expect(
      resolveRuntimeAppIdentifier({
        appId: "com.demo.notes",
        platform: "harmony",
        env: {}
      })
    ).toBe("com.demo.notes");
  });

  it("reads the runtime app id from HarmonyOS observation bundleId", () => {
    expect(
      appIdentifierFromObservation({
        platform: "harmony",
        bundleId: "com.eeo.classin.harmony",
        capturedAt: "2026-08-04T00:00:00.000Z",
        uiElements: [],
        ocrTexts: []
      })
    ).toBe("com.eeo.classin.harmony");
  });

  it("matches ClassIn observation by configured runtime id", () => {
    expect(
      isObservationInsideTargetApp({
        appId: "classin",
        platform: "harmony",
        env: { CLASSIN_HARMONY_BUNDLE_ID: "com.eeo.classin.harmony" },
        observation: {
          platform: "harmony",
          bundleId: "com.eeo.classin.harmony",
          capturedAt: "2026-08-04T00:00:00.000Z",
          uiElements: [],
          ocrTexts: []
        }
      })
    ).toEqual({
      inside: true,
      expectedAppIdentifier: "com.eeo.classin.harmony",
      actualAppIdentifier: "com.eeo.classin.harmony"
    });
  });
});
