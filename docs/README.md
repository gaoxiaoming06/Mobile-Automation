---
title: 自动化测试平台文档
doc_type: index
status: draft
owner: TODO(confirm): owner team unknown
created_at: 2026-06-04
updated_at: 2026-06-06
related_repos: ["Mobile-Automation"]
related_modules: []
platform_scope: mobile-both
related_platforms: ["Android", "iOS", "Web Dashboard"]
---

# 自动化测试平台文档

本目录用于维护自动化测试平台的产品规划、需求、设计、任务、验收和追踪文档。

## Features

| Feature | Status | Platform | Spec |
|---|---|---|---|
| 自动化测试平台 | draft | Android + iOS + Web Dashboard | [docs/product/mobile-automation-platform](product/mobile-automation-platform/README.md) |

## Structure

| Directory | Purpose |
|---|---|
| [product/](product/) | 产品级 Spec，描述整个平台的总体需求、设计、任务、验收和追踪 |
| [changes/](changes/) | 大功能变更的轻量 Delta 工作区，完成后合并回主 Spec |
| [features/](features/) | 子功能级 Spec，后续拆分设备发现、录制、报告等功能时使用 |
| [adr/](adr/) | 架构决策记录，沉淀关键技术选型和取舍 |
| [guides/](guides/) | 开发、调试、部署、运维指南 |
| [test/](test/) | 测试计划、测试报告、截图证据、测试脚本和 fixtures |
| [reference/](reference/) | 外部资料、竞品/方案参考、协议和工具链背景 |
| [changelog/](changelog/) | 跨功能的重要结构调整、评审结论和阶段性变更记录 |

## AI 推荐阅读顺序

1. [产品 README](product/mobile-automation-platform/README.md)
2. [AI development workflow](guides/ai-development-workflow.md)
3. [product-plan.md](product/mobile-automation-platform/spec/product-plan.md)
4. [requirements.md](product/mobile-automation-platform/spec/requirements.md)
5. [design.md](product/mobile-automation-platform/spec/design.md)
6. [tasks.md](product/mobile-automation-platform/spec/tasks.md)
7. [acceptance.md](product/mobile-automation-platform/spec/acceptance.md)
8. [traceability.md](product/mobile-automation-platform/spec/traceability.md)
9. [changelog.md](product/mobile-automation-platform/spec/changelog.md)
10. [adr/](adr/)
