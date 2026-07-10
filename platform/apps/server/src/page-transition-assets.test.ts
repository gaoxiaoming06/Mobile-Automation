import { describe, expect, it } from "vitest";
import { planRoute, type BusinessGraphVersion, type BusinessNode, type OperationEdge } from "@mobile-automation/graph-core";
import { withPageAbilityEdges } from "./page-ability-edges.js";
import { deleteManualPageElementAsset, deleteManualPageTransitionAsset, persistManualPageElementAsset, persistManualPageTransitionAsset, persistPageTaskNavigationTransitionAsset } from "./page-transition-assets.js";

describe("persistManualPageTransitionAsset", () => {
  it("persists a manual page element without creating a page transition", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    storage.nodes.push(source);

    const result = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      actionKind: "tap",
      locator: "image-region:12.5,8.25,20,6",
      elementLabel: "搜索按钮",
      availability: "visible",
      platformScope: "android",
      outcomeType: "navigate",
      outcomeLabel: "进入搜索页"
    });

    expect(result.status).toBe("saved");
    expect(storage.edges).toHaveLength(0);
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([
      {
        id: expect.stringMatching(/^manual_element_/),
        label: "搜索按钮",
        locator: "image-region:12.5,8.25,20,6",
        action: "tap",
        actionKind: "tap",
        availability: "visible",
        region: { x: 12.5, y: 8.25, width: 20, height: 6 },
        semanticArea: "top",
        coordinateSpace: "screen",
        platformScope: "android",
        outcomeType: "navigate",
        outcomeLabel: "进入搜索页"
      }
    ]);
  });

  it("rejects legacy grid candidate page abilities without an OCR target", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-class-detail", key: "classin.class.detail", name: "班级详情" });
    storage.nodes.push(source, target);

    const result = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      abilityType: "grid_candidate",
      actionKind: "tap",
      locator: "image-region:3,32,91,56",
      elementLabel: "打开班级详情",
      availability: "visible",
      platformScope: "android",
      outcomeType: "navigate",
      targetLabel: "班级详情",
      scrollProfile: {
        containerKind: "grid_list",
        direction: "vertical",
        columns: 2,
        targetKind: "nth_item",
        afterFoundAction: "tap_item",
        candidateItemHeightPercent: 24.5,
        clickSafePoint: { xPercent: 50, yPercent: 28 },
        scrollStepPercent: 65,
        failureStrategy: "try_next_candidate"
      }
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "grid_candidate_target_required"
    });
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toBeUndefined();
  });

  it("persists structural locator evidence and dynamic masks for non-text profile entries", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-settings", key: "classin.settings", name: "设置" });
    storage.nodes.push(source);

    const result = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      actionKind: "tap",
      locator: "image-region:6,15,88.77,8.78",
      elementLabel: "个人信息",
      availability: "visible",
      platformScope: "android",
      outcomeType: "navigate",
      locatorKind: "structural_locator",
      structuralLocator: {
        kind: "top_profile_entry",
        role: "list_item",
        indexHint: { semanticArea: "content", order: 0 },
        stableAnchors: [
          { kind: "right_chevron", region: { x: 86, y: 17, width: 5, height: 4 } }
        ],
        excludedDynamicEvidence: ["avatar", "display_name"]
      },
      dynamicMasks: [
        { kind: "avatar", label: "头像", region: { x: 7, y: 15.5, width: 11, height: 7.5 } },
        { kind: "text", label: "昵称", region: { x: 21, y: 16, width: 25, height: 7 } }
      ]
    });

    expect(result.status).toBe("saved");
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([
      expect.objectContaining({
        label: "个人信息",
        locatorKind: "structural_locator",
        structuralLocator: expect.objectContaining({
          kind: "top_profile_entry",
          role: "list_item",
          excludedDynamicEvidence: ["avatar", "display_name"]
        }),
        dynamicMasks: [
          { kind: "avatar", label: "头像", region: { x: 7, y: 15.5, width: 11, height: 7.5 } },
          { kind: "text", label: "昵称", region: { x: 21, y: 16, width: 25, height: 7 } }
        ]
      })
    ]);
  });

  it("persists dynamic regions, item templates, and parameterized transition metadata for lists", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-class-detail", key: "classin.class.detail", name: "班级详情" });
    storage.nodes.push(source, target);

    const result = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      abilityType: "grid_candidate",
      actionKind: "tap",
      locator: "image-region:3,32,91,56",
      elementLabel: "打开班级详情",
      availability: "visible",
      platformScope: "android",
      outcomeType: "navigate",
      targetLabel: "班级详情",
      locatorKind: "collection_item_locator",
      transitionKind: "parameterized",
      parameterMapping: {
        className: "dynamicRegion.item.titleText"
      },
      dynamicRegion: {
        id: "dynamic_region_class_list",
        label: "班级列表",
        kind: "grid",
        region: { x: 3, y: 32, width: 91, height: 56 },
        itemTemplateId: "item_template_class_card",
        dynamicFieldRules: [
          { name: "className", source: "ocr_text", role: "title" },
          { name: "lastMessage", source: "ocr_text", role: "secondary" }
        ]
      },
      itemTemplate: {
        id: "item_template_class_card",
        label: "班级卡片",
        region: { x: 3, y: 32, width: 43, height: 24.5 },
        actionArea: { x: 3, y: 32, width: 43, height: 24.5 },
        dynamicFields: [
          { name: "className", role: "title" },
          { name: "lastMessage", role: "secondary" }
        ],
        stableStructure: {
          columns: 2,
          clickSafePoint: { xPercent: 50, yPercent: 28 }
        }
      },
      scrollProfile: {
        containerKind: "grid_list",
        direction: "vertical",
        columns: 2,
        targetKind: "item_text",
        targetQuery: "{{className}}",
        afterFoundAction: "tap_item",
        candidateItemHeightPercent: 24.5,
        clickSafePoint: { xPercent: 50, yPercent: 28 },
        failureStrategy: "try_next_candidate"
      }
    });

    expect(result.status).toBe("saved");
    const sourceMetadata = storage.nodes.find((node) => node.id === source.id)?.metadata;
    expect(sourceMetadata?.assetRecordingDynamicRegions).toEqual([
      expect.objectContaining({
        id: "dynamic_region_class_list",
        label: "班级列表",
        kind: "grid",
        itemTemplateId: "item_template_class_card"
      })
    ]);
    expect(sourceMetadata?.assetRecordingItemTemplates).toEqual([
      expect.objectContaining({
        id: "item_template_class_card",
        label: "班级卡片",
        dynamicFields: [
          { name: "className", role: "title" },
          { name: "lastMessage", role: "secondary" }
        ]
      })
    ]);
    expect(sourceMetadata?.assetRecordingManualElements).toEqual([
      expect.objectContaining({
        label: "打开班级详情",
        locatorKind: "collection_item_locator",
        dynamicRegionId: "dynamic_region_class_list",
        itemTemplateId: "item_template_class_card"
      })
    ]);
    expect(storage.edges[0]?.actionPolicies[0]?.action.params).toEqual(
      expect.objectContaining({
        transitionKind: "parameterized",
        dynamicRegionId: "dynamic_region_class_list",
        itemTemplateId: "item_template_class_card",
        parameterMapping: {
          className: "dynamicRegion.item.titleText"
        }
      })
    );
    expect(storage.edges[0]?.actionPolicies[0]?.action.params).not.toEqual(expect.objectContaining({
      candidateIndex: expect.any(Number),
      maxCandidateAttempts: expect.any(Number),
      tapPointPercent: expect.any(Object)
    }));
  });

  it("persists a manual input element with a separate tap point inside the visual region", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-login", key: "classin.login", name: "登录" });
    storage.nodes.push(source);

    const result = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      actionKind: "input",
      locator: "image-region:6,31,88,6",
      elementLabel: "密码输入框",
      availability: "visible",
      platformScope: "android",
      outcomeType: "no_visible_change",
      tapPointPercent: { x: 20, y: 70 }
    });

    expect(result.status).toBe("saved");
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([
      expect.objectContaining({
        label: "密码输入框",
        locator: "image-region:6,31,88,6",
        actionKind: "input",
        region: { x: 6, y: 31, width: 88, height: 6 },
        tapPointPercent: { x: 20, y: 70 }
      })
    ]);
  });

  it("persists page element quality evidence for recording-time review and repair", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-login", key: "classin.login", name: "登录" });
    storage.nodes.push(source);

    const result = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      actionKind: "input",
      locator: "image-region:6,31,88,6",
      elementLabel: "密码输入框",
      targetText: "请输入密码",
      availability: "visible",
      platformScope: "android",
      outcomeType: "no_visible_change",
      quality: {
        status: "pass",
        score: 0.88,
        warnings: [],
        candidates: [
          {
            source: "ocr_text",
            text: "请输入密码",
            label: "请输入密码",
            score: 0.96,
            semanticArea: "content",
            insideMarkedRegion: true
          }
        ],
        evidence: {
          targetText: "请输入密码",
          semanticArea: "content",
          uniqueCandidate: true,
          candidateCount: 1
        }
      },
      visualLocator: {
        version: 1,
        strategy: "recorded_crop_template",
        template: {
          hash: "crop-hash",
          width: 2,
          height: 2,
          pixels: [0, 255, 255, 0],
          region: { x: 6, y: 31, width: 88, height: 6 }
        }
      }
    });

    expect(result.status).toBe("saved");
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([
      expect.objectContaining({
        label: "密码输入框",
        quality: expect.objectContaining({
          status: "pass",
          score: 0.88,
          evidence: expect.objectContaining({
            uniqueCandidate: true
          })
        }),
        visualLocator: expect.objectContaining({
          strategy: "recorded_crop_template",
          template: expect.objectContaining({
            hash: "crop-hash"
          })
        })
      })
    ]);
  });

  it("replaces an overlapping manual page element with the same label and action when the edited request omits elementId", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = {
      ...pageNode({
        id: "node-settings",
        key: "classin.settings",
        name: "设置"
      }),
      metadata: {
        assetRecordingManualElements: [
          {
            id: "manual_element_qr_old",
            label: "我的二维码",
            locator: "image-region:6,43,88,8",
            action: "tap",
            actionKind: "tap",
            availability: "visible",
            region: { x: 6, y: 43, width: 88, height: 8 },
            platformScope: "android",
            outcomeType: "navigate"
          }
        ]
      }
    };
    storage.nodes.push(source);

    const result = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      actionKind: "tap",
      locator: "image-region:3.96,47.36,91.57,6.16",
      elementLabel: "我的二维码",
      availability: "visible",
      platformScope: "android",
      outcomeType: "no_visible_change"
    });

    expect(result.status).toBe("saved");
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([
      expect.objectContaining({
        id: "manual_element_tap.image.region.3.96.47.36.91.57.6.16.undefined",
        label: "我的二维码",
        locator: "image-region:3.96,47.36,91.57,6.16",
        region: { x: 3.96, y: 47.36, width: 91.57, height: 6.16 }
      })
    ]);
  });

  it("keeps same-label manual page elements when their regions do not overlap", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = {
      ...pageNode({
        id: "node-list",
        key: "classin.list",
        name: "列表页"
      }),
      metadata: {
        assetRecordingManualElements: [
          {
            id: "manual_element_first",
            label: "详情",
            locator: "image-region:6,20,88,6",
            action: "tap",
            actionKind: "tap",
            availability: "visible",
            region: { x: 6, y: 20, width: 88, height: 6 },
            platformScope: "android",
            outcomeType: "navigate"
          }
        ]
      }
    };
    storage.nodes.push(source);

    const result = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      actionKind: "tap",
      locator: "image-region:6,60,88,6",
      elementLabel: "详情",
      availability: "visible",
      platformScope: "android",
      outcomeType: "navigate"
    });

    expect(result.status).toBe("saved");
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([
      expect.objectContaining({
        id: "manual_element_first",
        label: "详情",
        locator: "image-region:6,20,88,6"
      }),
      expect.objectContaining({
        label: "详情",
        locator: "image-region:6,60,88,6"
      })
    ]);
  });

  it("creates a plannable transition when a manual page element has a navigate target", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-create-public", key: "classin.public.create", name: "新建公开课" });
    storage.nodes.push(source, target);

    const result = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      actionKind: "tap",
      locator: "image-region:53.85,15.84,38.63,7.33",
      elementLabel: "创建公开课",
      availability: "after_scroll",
      platformScope: "android",
      outcomeType: "navigate",
      targetLabel: "新建公开课"
    });

    expect(result.status).toBe("saved");
    expect(storage.edges).toHaveLength(1);
    expect(storage.edges[0]).toEqual(
      expect.objectContaining({
        fromNodeId: source.id,
        toNodeId: target.id,
        name: "主页 -> 新建公开课",
        intent: "点击：创建公开课",
        status: "active",
        source: "manual_edit"
      })
    );
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([
      expect.objectContaining({
        label: "创建公开课",
        locator: "image-region:53.85,15.84,38.63,7.33",
        actionKind: "tap",
        outcomeType: "navigate",
        targetNodeId: target.id
      })
    ]);

    const route = planRoute({
      graphVersion: graph([source, target], storage.edges),
      appId: "classin-android",
      targetApp: { androidPackageName: "cn.eeo.classin" },
      startNodeId: source.id,
      targetNodeId: target.id,
      platform: "android",
      now: "2026-06-20T12:00:00.000Z",
      idFactory: (prefix) => `${prefix}-fixed`
    });

    expect(route.edges.map((edge) => edge.edge.id)).toEqual([storage.edges[0].id]);
    expect(route.unresolvedIssues).toEqual([]);
  });

  it("creates a source page task navigation transition without duplicating raw element locators into the edge", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-login", key: "classin.login", name: "登录" });
    const target = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    source.metadata = {
      ...source.metadata,
      assetRecordingPageTasks: [
        {
          id: "login-task-account-password",
          name: "账号密码登录",
          status: "active",
          steps: [
            { id: "phone", order: 1, elementId: "login-phone-input", fieldType: "text_input", valueParamKey: "phone" },
            { id: "password", order: 2, elementId: "login-password-input", fieldType: "text_input", valueParamKey: "password" },
            { id: "agreement", order: 3, elementId: "login-agreement-toggle", fieldType: "tap" },
            { id: "submit", order: 4, elementId: "login-submit-button", fieldType: "submit" }
          ],
          createdAt: "2026-06-25T00:00:00.000Z",
          updatedAt: "2026-06-25T00:00:00.000Z"
        }
      ]
    };
    storage.nodes.push(source, target);

    const result = persistPageTaskNavigationTransitionAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      taskId: "login-task-account-password",
      platformScope: "android"
    });

    expect(result.status).toBe("created");
    expect(result.edge).toEqual(
      expect.objectContaining({
        fromNodeId: source.id,
        toNodeId: target.id,
        key: "task.classin.login.classin.home.login.task.account.password",
        name: "登录 -> 主页",
        intent: "执行页面任务：账号密码登录",
        status: "active",
        reliabilityScore: 0.86
      })
    );
    expect(result.edge?.actionPolicies[0]?.action).toEqual(
      expect.objectContaining({
        type: "wait",
        title: "执行页面任务：账号密码登录",
        params: {
          taskId: "login-task-account-password",
          taskMode: "source_page_navigation",
          pageTaskName: "账号密码登录"
        }
      })
    );
    expect(result.edge?.actionPolicies[0]?.action.params).not.toHaveProperty("locator");

    const route = planRoute({
      graphVersion: graph([source, target], storage.edges),
      appId: "classin-android",
      targetApp: { androidPackageName: "cn.eeo.classin" },
      startNodeId: source.id,
      targetNodeId: target.id,
      platform: "android",
      now: "2026-06-25T12:00:00.000Z",
      idFactory: (prefix) => `${prefix}-fixed`
    });

    expect(route.edges.map((edge) => edge.edge.id)).toEqual([result.edge?.id]);
    expect(route.unresolvedIssues).toEqual([]);
  });

  it("persists compound navigation micro steps for menu based transitions", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-add-friend", key: "classin.friend.add", name: "添加好友" });
    storage.nodes.push(source, target);

    const result = persistManualPageTransitionAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      actionKind: "tap",
      locator: "image-region:89,5,8,6",
      elementLabel: "右上角更多",
      availability: "visible",
      platformScope: "android",
      outcomeType: "compound_navigation",
      targetLabel: "添加好友",
      compoundSteps: [
        {
          actionKind: "wait",
          locator: "text:添加好友",
          elementLabel: "等待添加好友菜单出现"
        },
        {
          actionKind: "tap",
          locator: "text:添加好友",
          elementLabel: "添加好友"
        }
      ]
    });

    expect(result.status).toBe("created");
    expect(storage.edges[0]).toEqual(
      expect.objectContaining({
        fromNodeId: source.id,
        toNodeId: target.id,
        status: "active",
        source: "manual_edit"
      })
    );
    expect(storage.edges[0].actionPolicies[0].action).toEqual(
      expect.objectContaining({
        type: "tap_on_image",
        params: expect.objectContaining({
          outcomeType: "compound_navigation",
          compoundSteps: [
            expect.objectContaining({
              type: "wait_until_state",
              title: "等待添加好友菜单出现",
              params: expect.objectContaining({ text: "添加好友" })
            }),
            expect.objectContaining({
              type: "tap_on_text",
              title: "添加好友",
              params: expect.objectContaining({ text: "添加好友" })
            })
          ]
        })
      })
    );
  });

  it("keeps multiple compound menu transitions from the same trigger when menu choices differ", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const addFriend = pageNode({ id: "node-add-friend", key: "classin.friend.add", name: "添加好友" });
    const joinClass = pageNode({ id: "node-join-class", key: "classin.class.join", name: "加入班级" });
    storage.nodes.push(source, addFriend, joinClass);

    const first = persistManualPageTransitionAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: addFriend.id,
      actionKind: "tap",
      locator: "image-region:89,5,8,6",
      elementLabel: "右上角更多",
      availability: "visible",
      platformScope: "android",
      outcomeType: "compound_navigation",
      targetLabel: "添加好友",
      compoundSteps: [
        { actionKind: "wait", locator: "text:添加好友", elementLabel: "添加好友" },
        { actionKind: "tap", locator: "text:添加好友", elementLabel: "添加好友" }
      ]
    });
    const second = persistManualPageTransitionAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: joinClass.id,
      actionKind: "tap",
      locator: "image-region:89,5,8,6",
      elementLabel: "右上角更多",
      availability: "visible",
      platformScope: "android",
      outcomeType: "compound_navigation",
      targetLabel: "加入班级",
      compoundSteps: [
        { actionKind: "wait", locator: "text:加入班级", elementLabel: "加入班级" },
        { actionKind: "tap", locator: "text:加入班级", elementLabel: "加入班级" }
      ]
    });

    expect(first.status).toBe("created");
    expect(second.status).toBe("created");
    expect(storage.edges).toHaveLength(2);
    expect(storage.edges.map((edge) => ({ toNodeId: edge.toNodeId, status: edge.status }))).toEqual([
      { toNodeId: addFriend.id, status: "active" },
      { toNodeId: joinClass.id, status: "active" }
    ]);
    expect(new Set(storage.edges.map((edge) => edge.key)).size).toBe(2);

    const routeToAddFriend = planRoute({
      graphVersion: graph([source, addFriend, joinClass], storage.edges),
      appId: "classin-android",
      targetApp: { androidPackageName: "cn.eeo.classin" },
      startNodeId: source.id,
      targetNodeId: addFriend.id,
      platform: "android",
      now: "2026-06-20T12:00:00.000Z",
      idFactory: (prefix) => `${prefix}-fixed-add`
    });
    const routeToJoinClass = planRoute({
      graphVersion: graph([source, addFriend, joinClass], storage.edges),
      appId: "classin-android",
      targetApp: { androidPackageName: "cn.eeo.classin" },
      startNodeId: source.id,
      targetNodeId: joinClass.id,
      platform: "android",
      now: "2026-06-20T12:00:00.000Z",
      idFactory: (prefix) => `${prefix}-fixed-class`
    });

    expect(routeToAddFriend.edges.map((edge) => edge.edge.toNodeId)).toEqual([addFriend.id]);
    expect(routeToJoinClass.edges.map((edge) => edge.edge.toNodeId)).toEqual([joinClass.id]);
    expect(routeToAddFriend.unresolvedIssues).toEqual([]);
    expect(routeToJoinClass.unresolvedIssues).toEqual([]);
  });

  it("updates an existing manual page element by locator and action kind", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    storage.nodes.push(source);

    persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      actionKind: "tap",
      locator: "image-region:12.5,8.25,20,6",
      elementLabel: "搜索按钮",
      availability: "visible"
    });
    persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      actionKind: "tap",
      locator: "image-region:12.5,8.25,20,6",
      elementLabel: "右上搜索",
      availability: "conditional"
    });

    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([
      expect.objectContaining({
        label: "右上搜索",
        locator: "image-region:12.5,8.25,20,6",
        actionKind: "tap",
        availability: "conditional"
      })
    ]);
  });

  it("rejects a stale active edge when the same manual element is rebound to another target page", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-class-detail", key: "classin.class.detail", name: "班级详情页" });
    const oldTarget = pageNode({ id: "node-create-lesson", key: "classin.lesson.create", name: "新建课堂" });
    const newTarget = pageNode({ id: "node-publish-activity", key: "classin.activity.publish", name: "发布活动" });
    storage.nodes.push(source, oldTarget, newTarget);

    const first = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: oldTarget.id,
      actionKind: "tap",
      locator: "image-region:80.38,79.55,14.2,6.28",
      elementLabel: "点击区域",
      availability: "visible",
      platformScope: "android",
      outcomeType: "navigate",
      targetLabel: "新建课堂"
    });
    const second = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: newTarget.id,
      actionKind: "tap",
      locator: "image-region:80.38,79.55,14.2,6.28",
      elementLabel: "点击区域",
      availability: "visible",
      platformScope: "android",
      outcomeType: "navigate",
      targetLabel: "发布活动"
    });

    expect(first.status).toBe("saved");
    expect(second.status).toBe("saved");
    expect(storage.edges).toEqual([
      expect.objectContaining({
        toNodeId: oldTarget.id,
        name: "班级详情页 -> 新建课堂",
        status: "rejected"
      }),
      expect.objectContaining({
        toNodeId: newTarget.id,
        name: "班级详情页 -> 发布活动",
        status: "active"
      })
    ]);
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([
      expect.objectContaining({
        locator: "image-region:80.38,79.55,14.2,6.28",
        actionKind: "tap",
        targetNodeId: newTarget.id,
        targetLabel: "发布活动"
      })
    ]);

    const routeToOldTarget = planRoute({
      graphVersion: graph([source, oldTarget, newTarget], storage.edges),
      appId: "classin-android",
      targetApp: { androidPackageName: "cn.eeo.classin" },
      startNodeId: source.id,
      targetNodeId: oldTarget.id,
      platform: "android",
      now: "2026-06-20T12:00:00.000Z",
      idFactory: (prefix) => `${prefix}-fixed`
    });
    expect(routeToOldTarget.edges).toEqual([]);
    expect(routeToOldTarget.unresolvedIssues).toEqual([
      expect.objectContaining({
        code: "TARGET_NODE_UNREACHABLE"
      })
    ]);
  });

  it("deletes a manual page element without requiring a transition edge", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    storage.nodes.push(source);
    const saved = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      actionKind: "tap",
      locator: "image-region:12.5,8.25,20,6",
      elementLabel: "搜索按钮",
      availability: "visible"
    });

    const result = deleteManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      elementId: saved.element!.id as string
    });

    expect(result.status).toBe("deleted");
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([]);
  });

  it("deletes a navigational manual page element and rejects its derived transition edge", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-search", key: "classin.search", name: "搜索页" });
    storage.nodes.push(source, target);
    const saved = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      actionKind: "tap",
      locator: "text: 搜索",
      elementLabel: "搜索",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "搜索页"
    });

    expect(storage.edges).toEqual([
      expect.objectContaining({
        fromNodeId: source.id,
        toNodeId: target.id,
        status: "active"
      })
    ]);

    const result = deleteManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      elementId: saved.element!.id as string
    });

    expect(result.status).toBe("deleted");
    expect(storage.edges).toEqual([
      expect.objectContaining({
        fromNodeId: source.id,
        toNodeId: target.id,
        status: "rejected"
      })
    ]);
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([]);

    const route = planRoute({
      graphVersion: graph([source, target], storage.edges),
      appId: "classin-android",
      targetApp: { androidPackageName: "cn.eeo.classin" },
      startNodeId: source.id,
      targetNodeId: target.id,
      platform: "android",
      now: "2026-06-18T12:00:00.000Z",
      idFactory: (prefix) => `${prefix}-fixed`
    });
    expect(route.edges).toEqual([]);
  });

  it("deletes a v2 page element and removes transitions derived from that element", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-search", key: "classin.search", name: "搜索页" });
    source.metadata = {
      ...source.metadata,
      assetRecordingPageElements: [
        {
          id: "element-search",
          label: "搜索",
          locator: "text: 搜索",
          elementKind: "button",
          actions: ["tap"],
          platformScope: "android"
        }
      ],
      assetRecordingPageTransitions: [
        {
          id: "transition-search",
          elementId: "element-search",
          action: "tap",
          outcomeType: "navigate",
          targetNodeId: target.id,
          targetLabel: "搜索页",
          platformScope: "android"
        }
      ]
    };
    storage.nodes.push(source, target);

    expect(withPageAbilityEdges(graph(storage.nodes, storage.edges)).edges).toHaveLength(1);

    const result = deleteManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      elementId: "element-search"
    });

    expect(result.status).toBe("deleted");
    const updatedSource = storage.nodes.find((node) => node.id === source.id);
    expect(updatedSource?.metadata?.assetRecordingPageElements).toEqual([]);
    expect(updatedSource?.metadata?.assetRecordingPageTransitions).toEqual([]);
    expect(withPageAbilityEdges(graph(storage.nodes, storage.edges)).edges).toHaveLength(0);
  });

  it("creates an active manual transition between confirmed page assets that can be planned", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-create-public", key: "classin.public.create", name: "新建公开课" });
    storage.nodes.push(source, target);

    const result = persistManualPageTransitionAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      actionKind: "tap",
      locator: "text: 创建公开课",
      elementLabel: "创建公开课",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "新建公开课"
    });

    expect(result.status).toBe("created");
    expect(result.edge).toEqual(
      expect.objectContaining({
        fromNodeId: source.id,
        toNodeId: target.id,
        name: "主页 -> 新建公开课",
        intent: "点击：创建公开课",
        status: "active",
        source: "manual_edit",
        platformScope: "android",
        reliabilityScore: 0.82
      })
    );
    expect(result.edge?.actionPolicies[0]?.action).toEqual(
      expect.objectContaining({
        type: "tap_on_text",
        title: "点击：创建公开课",
        params: expect.objectContaining({
          text: "创建公开课",
          locator: "text: 创建公开课",
          availability: "visible",
          outcomeType: "navigate",
          targetLabel: "新建公开课"
        })
      })
    );
    expect(result.edge?.expectations[0]).toEqual(
      expect.objectContaining({
        type: "state_is",
        title: "预期状态：新建公开课",
        params: expect.objectContaining({
          nodeId: target.id,
          nodeKey: target.key,
          outcomeType: "navigate"
        })
      })
    );

    const route = planRoute({
      graphVersion: graph([source, target], storage.edges),
      appId: "classin-android",
      targetApp: { androidPackageName: "cn.eeo.classin" },
      startNodeId: source.id,
      targetNodeId: target.id,
      platform: "android",
      now: "2026-06-18T12:00:00.000Z",
      idFactory: (prefix) => `${prefix}-fixed`
    });

    expect(route.edges.map((edge) => edge.edge.id)).toEqual([result.edge?.id]);
    expect(route.unresolvedIssues).toEqual([]);
  });

  it("refuses to create a transition when source or target is not a confirmed page asset", () => {
    const storage = new MemoryPageTransitionStorage();
    storage.nodes.push(pageNode({ id: "node-home", key: "classin.home", name: "主页" }));

    const result = persistManualPageTransitionAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: "node-home",
      targetNodeId: "node-missing",
      actionKind: "tap",
      locator: "text: 创建公开课",
      elementLabel: "创建公开课",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "新建公开课"
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "source_or_target_page_asset_missing"
    });
    expect(storage.edges).toHaveLength(0);
  });

  it("keeps non-navigation outcomes as draft so they do not enter path planning yet", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    storage.nodes.push(source);

    const result = persistManualPageTransitionAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: source.id,
      actionKind: "tap",
      locator: "text: 更多",
      elementLabel: "更多",
      availability: "visible",
      outcomeType: "local_state_change",
      targetLabel: "出现更多操作菜单"
    });

    expect(result.status).toBe("created");
    expect(result.edge).toEqual(
      expect.objectContaining({
        status: "draft",
        fromNodeId: source.id,
        toNodeId: source.id
      })
    );
    expect(result.edge?.actionPolicies[0]?.action.params).toEqual(
      expect.objectContaining({
        outcomeType: "local_state_change",
        targetLabel: "出现更多操作菜单"
      })
    );
  });

  it("persists scroll container profile on manual scroll transitions", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-class-detail", key: "classin.class.detail", name: "班级详情" });
    storage.nodes.push(source, target);

    const result = persistManualPageTransitionAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      actionKind: "scroll",
      locator: "resource-id: cn.eeo.classin:id/class_list",
      elementLabel: "班级列表",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "班级详情",
      scrollProfile: {
        containerKind: "grid_list",
        direction: "vertical",
        columns: 2,
        targetKind: "item_text",
        targetQuery: "班级四十一号",
        afterFoundAction: "tap_item"
      }
    });

    expect(result.status).toBe("created");
    expect(result.edge?.status).toBe("active");
    expect(result.edge?.actionPolicies[0]?.action).toEqual(
      expect.objectContaining({
        type: "scroll_until_visible",
        params: expect.objectContaining({
          resourceId: "cn.eeo.classin:id/class_list",
          scrollProfile: {
            containerKind: "grid_list",
            direction: "vertical",
            columns: 2,
            targetKind: "item_text",
            targetQuery: "班级四十一号",
            afterFoundAction: "tap_item"
          }
        })
      })
    );
  });

  it("persists manually marked image regions on operation transitions", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-search", key: "classin.search", name: "搜索页" });
    storage.nodes.push(source, target);

    const result = persistManualPageTransitionAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      actionKind: "tap",
      locator: "image-region:12.5,8.25,20,6",
      elementLabel: "搜索按钮",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "搜索页"
    });

    expect(result.status).toBe("created");
    expect(result.edge?.actionPolicies[0]?.action).toEqual(
      expect.objectContaining({
        type: "tap_on_image",
        params: expect.objectContaining({
          locator: "image-region:12.5,8.25,20,6",
          region: { x: 12.5, y: 8.25, width: 20, height: 6 },
          targetMode: "image_region"
        })
      })
    );
  });

  it("preserves manually confirmed semantic region metadata when a page element creates a transition", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-search", key: "classin.search", name: "搜索页" });
    storage.nodes.push(source, target);

    const result = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      actionKind: "tap",
      locator: "image-region:12.5,8.25,20,6",
      semanticArea: "content",
      coordinateSpace: "app_viewport",
      elementLabel: "搜索按钮",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "搜索页"
    });

    expect(result.status).toBe("saved");
    expect(storage.edges[0]?.actionPolicies[0]?.action.params).toEqual(
      expect.objectContaining({
        locator: "image-region:12.5,8.25,20,6",
        semanticArea: "content",
        coordinateSpace: "app_viewport"
      })
    );
    expect(storage.edges[0]?.actionPolicies[0]?.action.params).not.toHaveProperty("targetText");
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([
      expect.objectContaining({
        locator: "image-region:12.5,8.25,20,6",
        semanticArea: "content",
        coordinateSpace: "app_viewport"
      })
    ]);
  });

  it("keeps display label separate from runtime OCR target text", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-class-detail", key: "classin.class.detail", name: "班级详情" });
    const target = pageNode({ id: "node-learning-plan", key: "classin.learning.plan", name: "学习方案" });
    storage.nodes.push(source, target);

    const result = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      actionKind: "tap",
      locator: "image-region:6,47.8,88,8.8",
      semanticArea: "content",
      coordinateSpace: "screen",
      elementLabel: "创建学习方案",
      targetText: "学习方案",
      availability: "visible",
      platformScope: "android",
      outcomeType: "navigate",
      targetLabel: "学习方案"
    });

    expect(result.status).toBe("saved");
    expect(storage.edges[0]?.actionPolicies[0]?.action.params).toEqual(
      expect.objectContaining({
        elementLabel: "创建学习方案",
        targetText: "学习方案"
      })
    );
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([
      expect.objectContaining({
        label: "创建学习方案",
        targetText: "学习方案",
        targetLabel: "学习方案"
      })
    ]);
  });

  it("rejects legacy grid candidate transitions without an OCR target", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-class-detail", key: "classin.class.detail", name: "班级详情" });
    storage.nodes.push(source, target);

    const result = persistManualPageTransitionAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      abilityType: "grid_candidate",
      actionKind: "tap",
      locator: "image-region:3.06,30.44,93.99,59.13",
      elementLabel: "打开班级详情",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "班级详情",
      scrollProfile: {
        containerKind: "grid_list",
        direction: "vertical",
        columns: 2,
        targetKind: "nth_item",
        afterFoundAction: "tap_item",
        candidateItemHeightPercent: 24.5,
        clickSafePoint: { xPercent: 50, yPercent: 28 },
        scrollStepPercent: 65,
        failureStrategy: "try_next_candidate"
      }
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "grid_candidate_target_required"
    });
    expect(storage.edges).toEqual([]);
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toBeUndefined();
  });

  it("rejects legacy grid candidate scroll transitions without an OCR target", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-class-detail", key: "classin.class.detail", name: "班级详情" });
    storage.nodes.push(source, target);

    const result = persistManualPageTransitionAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      abilityType: "grid_candidate",
      actionKind: "scroll",
      locator: "image-region:3.06,30.44,93.99,59.13",
      elementLabel: "班级列表",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "班级详情",
      scrollProfile: {
        containerKind: "grid_list",
        direction: "vertical",
        columns: 2,
        targetKind: "nth_item",
        afterFoundAction: "tap_item",
        candidateItemHeightPercent: 24.5,
        clickSafePoint: { xPercent: 50, yPercent: 28 },
        failureStrategy: "try_next_candidate"
      }
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "grid_candidate_target_required"
    });
    expect(storage.edges).toEqual([]);
  });

  it("adds manually marked operation regions back to the source page asset", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-search", key: "classin.search", name: "搜索页" });
    storage.nodes.push(source, target);

    const result = persistManualPageTransitionAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      actionKind: "tap",
      locator: "image-region:12.5,8.25,20,6",
      elementLabel: "搜索按钮",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "搜索页"
    });

    expect(result.status).toBe("created");
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([
      {
        id: expect.stringMatching(/^manual_element_/),
        label: "搜索按钮",
        locator: "image-region:12.5,8.25,20,6",
        action: "tap",
        actionKind: "tap",
        availability: "visible",
        region: { x: 12.5, y: 8.25, width: 20, height: 6 },
        semanticArea: "top",
        coordinateSpace: "screen",
        targetNodeId: target.id,
        targetLabel: "搜索页",
        outcomeType: "navigate",
        platformScope: "android"
      }
    ]);
  });

  it("updates an existing manually marked operation region by element id", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    source.metadata = {
      ...source.metadata,
      assetRecordingManualElements: [
        {
          id: "manual_element_search",
          label: "旧搜索按钮",
          locator: "image-region:12.5,8.25,20,6",
          action: "tap",
          actionKind: "tap",
          availability: "visible",
          region: { x: 12.5, y: 8.25, width: 20, height: 6 },
          platformScope: "android"
        }
      ]
    };
    storage.nodes.push(source);

    const result = persistManualPageElementAsset({
      graphVersionId: "version-1",
      storage,
      elementId: "manual_element_search",
      sourceNodeId: source.id,
      actionKind: "tap",
      locator: "image-region:30,12,18,5",
      elementLabel: "搜索按钮",
      availability: "visible",
      outcomeType: "navigate",
      targetNodeId: "node-search",
      targetLabel: "搜索页",
      outcomeLabel: "进入搜索页"
    });

    expect(result.status).toBe("saved");
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([
      {
        id: "manual_element_search",
        label: "搜索按钮",
        locator: "image-region:30,12,18,5",
        action: "tap",
        actionKind: "tap",
        availability: "visible",
        region: { x: 30, y: 12, width: 18, height: 5 },
        semanticArea: "content",
        coordinateSpace: "screen",
        targetNodeId: "node-search",
        targetLabel: "搜索页",
        outcomeType: "navigate",
        outcomeLabel: "进入搜索页",
        platformScope: "android"
      }
    ]);
  });

  it("deletes a saved manual transition and removes its manual operation region from the source page asset", () => {
    const storage = new MemoryPageTransitionStorage();
    const source = pageNode({ id: "node-home", key: "classin.home", name: "主页" });
    const target = pageNode({ id: "node-search", key: "classin.search", name: "搜索页" });
    storage.nodes.push(source, target);
    const created = persistManualPageTransitionAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      actionKind: "tap",
      locator: "image-region:12.5,8.25,20,6",
      elementLabel: "搜索按钮",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "搜索页"
    });

    const result = deleteManualPageTransitionAsset({
      graphVersion: graph([source, target], storage.edges),
      storage,
      edgeId: created.edge!.id
    });

    expect(result.status).toBe("deleted");
    expect(storage.edges.find((edge) => edge.id === created.edge!.id)?.status).toBe("rejected");
    expect(storage.nodes.find((node) => node.id === source.id)?.metadata?.assetRecordingManualElements).toEqual([]);
  });
});

class MemoryPageTransitionStorage {
  nodes: BusinessNode[] = [];
  edges: OperationEdge[] = [];

  findBusinessNodeById(_graphVersionId: string, nodeId: string): BusinessNode | undefined {
    return this.nodes.find((node) => node.id === nodeId);
  }

  findOperationEdgeByKey(_graphVersionId: string, key: string): OperationEdge | undefined {
    return this.edges.find((edge) => edge.key === key);
  }

  listOperationEdges(_graphVersionId: string): OperationEdge[] {
    return this.edges;
  }

  createOperationEdge(input: Omit<OperationEdge, "id"> & { id?: string }): OperationEdge {
    const edge = { ...input, id: input.id ?? `edge-${this.edges.length + 1}` };
    this.edges.push(edge);
    return edge;
  }

  updateBusinessNodeDetails(
    nodeId: string,
    input: {
      metadata?: Record<string, unknown>;
    }
  ): BusinessNode | undefined {
    const index = this.nodes.findIndex((node) => node.id === nodeId);
    if (index < 0) {
      return undefined;
    }
    this.nodes[index] = {
      ...this.nodes[index],
      metadata: input.metadata ?? this.nodes[index].metadata
    };
    return this.nodes[index];
  }

  updateOperationEdgeStatus(edgeId: string, status: OperationEdge["status"]): OperationEdge | undefined {
    const index = this.edges.findIndex((edge) => edge.id === edgeId);
    if (index < 0) {
      return undefined;
    }
    this.edges[index] = {
      ...this.edges[index],
      status
    };
    return this.edges[index];
  }
}

function pageNode(input: { id: string; key: string; name: string; confirmed?: boolean }): BusinessNode {
  return {
    id: input.id,
    graphVersionId: "version-1",
    key: input.key,
    name: input.name,
    nodeType: "page",
    tags: input.confirmed === false ? [] : ["page-asset", "asset-recording"],
    status: "active",
    matchers: [{ id: `matcher-${input.id}`, type: "text", value: input.name, weight: 2, critical: true }],
    defaultExpectations: [],
    platformScope: "android",
    metadata: input.confirmed === false ? {} : { assetRecordingConfirmed: true }
  };
}

function graph(nodes: BusinessNode[], edges: OperationEdge[]): BusinessGraphVersion {
  return {
    id: "version-1",
    graphId: "graph-1",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes,
    edges,
    createdAt: "2026-06-18T12:00:00.000Z"
  };
}
