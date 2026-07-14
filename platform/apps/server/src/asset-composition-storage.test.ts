import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let cleanupRoot: string | undefined;
let closeStorage: (() => void) | undefined;

afterEach(async () => {
  closeStorage?.();
  closeStorage = undefined;
  delete process.env.DATA_DIR;
  vi.resetModules();
  if (cleanupRoot) {
    await rm(cleanupRoot, { recursive: true, force: true });
    cleanupRoot = undefined;
  }
});

describe("asset composition storage", () => {
  it("persists and versions parameter profiles", async () => {
    const storage = await createStorage();
    const created = storage.createParameterProfile({
      appId: "cn.eeo.classin",
      platform: "android",
      name: "教师账号 A",
      environment: "test",
      values: {
        className: { type: "string", value: "班级四十二号" },
        duration: { type: "number", value: 30 },
        recordLive: { type: "boolean", value: true }
      }
    });

    expect(created).toEqual(expect.objectContaining({ version: 1, status: "active" }));
    expect(storage.listParameterProfiles({ appId: "cn.eeo.classin", platform: "android" })).toEqual([
      expect.objectContaining({ id: created.id, name: "教师账号 A" })
    ]);

    const updated = storage.updateParameterProfile(created.id, {
      ...created,
      name: "教师账号 A-更新",
      values: { ...created.values, lessonName: { type: "template", value: "自动化课堂-{{timestamp}}" } }
    });
    expect(updated).toEqual(expect.objectContaining({ name: "教师账号 A-更新", version: 2 }));
    expect(storage.deleteParameterProfile(created.id)).toBe(true);
    expect(storage.getParameterProfile(created.id)).toBeUndefined();
  });

  it("persists reusable business-domain records and binds a profile to selected records", async () => {
    const storage = await createStorage();
    const loginRecord = storage.createParameterDataRecord({
      appId: "cn.eeo.classin",
      platform: "android",
      domainKey: "login_credentials",
      name: "教师账号 A",
      values: {
        phone: { type: "string", value: "18743085313" },
        password: { type: "string", value: "eeo123", sensitive: true }
      }
    });
    const classroomRecord = storage.createParameterDataRecord({
      appId: "cn.eeo.classin",
      platform: "android",
      domainKey: "classroom_draft",
      name: "课堂草稿 A",
      values: { lessonName: { type: "string", value: "自动化课堂" } }
    });
    const profile = storage.createParameterProfile({
      appId: "cn.eeo.classin",
      platform: "android",
      name: "教师 A 执行组合",
      values: {},
      bindings: [
        { domainKey: "login_credentials", recordId: loginRecord.id },
        { domainKey: "classroom_draft", recordId: classroomRecord.id }
      ]
    });

    expect(storage.listParameterDataRecords({ appId: "cn.eeo.classin", platform: "android", domainKey: "login_credentials" }))
      .toEqual([expect.objectContaining({ id: loginRecord.id, name: "教师账号 A" })]);
    expect(storage.getParameterProfile(profile.id)).toEqual(expect.objectContaining({
      bindings: [
        { domainKey: "login_credentials", recordId: loginRecord.id },
        { domainKey: "classroom_draft", recordId: classroomRecord.id }
      ]
    }));
  });

  it("persists meta functions with ordered asset-reference steps", async () => {
    const storage = await createStorage();
    const created = storage.createMetaFunction({
      appId: "cn.eeo.classin",
      platform: "android",
      name: "进入指定班级",
      parameters: [{ key: "className", type: "string", required: true }],
      steps: [
        { id: "step-capability", order: 9, kind: "invoke_capability", sourcePageModelId: "page-home", pageElementId: "class-grid", targetPageModelId: "page-detail", enabled: true },
        { id: "step-reach", order: 3, kind: "reach_page", targetPageModelId: "page-home", enabled: true }
      ]
    });

    expect(created.steps.map((step: { id: string; order: number }) => [step.id, step.order])).toEqual([
      ["step-reach", 1],
      ["step-capability", 2]
    ]);
    expect(storage.getMetaFunction(created.id)).toEqual(expect.objectContaining({ name: "进入指定班级", version: 1 }));
    const updated = storage.updateMetaFunction(created.id, { ...created, description: "从任意页面进入指定班级" });
    expect(updated.version).toBe(2);
    expect(storage.deleteMetaFunction(created.id)).toBe(true);
  });

  it("persists composite cases with ordered meta-function references", async () => {
    const storage = await createStorage();
    const profile = storage.createParameterProfile({
      appId: "cn.eeo.classin",
      platform: "android",
      name: "默认参数",
      values: {}
    });
    const created = storage.createAssetCompositeCase({
      appId: "cn.eeo.classin",
      platform: "android",
      name: "指定班级创建课堂",
      parameterProfileId: profile.id,
      runMode: "once",
      repeatCount: 1,
      stopOnFailure: true,
      steps: [
        { id: "case-create", order: 8, metaFunctionId: "meta-create", enabled: true },
        { id: "case-enter", order: 2, metaFunctionId: "meta-enter", enabled: true }
      ]
    });

    expect(created.steps.map((step: { id: string; order: number }) => [step.id, step.order])).toEqual([
      ["case-enter", 1],
      ["case-create", 2]
    ]);
    expect(storage.listAssetCompositeCases({ appId: "cn.eeo.classin", platform: "android" })).toHaveLength(1);
    const updated = storage.updateAssetCompositeCase(created.id, { ...created, runMode: "repeat_n", repeatCount: 2 });
    expect(updated).toEqual(expect.objectContaining({ version: 2, runMode: "repeat_n", repeatCount: 2 }));
    expect(storage.deleteAssetCompositeCase(created.id)).toBe(true);
  });
});

async function createStorage(): Promise<any> {
  cleanupRoot = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-asset-composition-"));
  process.env.DATA_DIR = cleanupRoot;
  vi.resetModules();
  const { Storage } = await import("./storage.js");
  const storage = new Storage();
  closeStorage = () => storage.close();
  return storage;
}
