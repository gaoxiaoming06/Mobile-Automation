/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("dashboard styles", () => {
  it("keeps asset recording cards inside normal document flow", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");
    const panelIndex = css.indexOf(".panel {");
    const assetOverrideIndex = css.indexOf(".asset-page-card.panel");
    const detailSectionIndex = css.indexOf(".asset-detail-section");

    expect(assetOverrideIndex).toBeGreaterThan(panelIndex);
    expect(css).toContain(".asset-page-card.panel {\n  overflow: hidden;\n}");
    expect(css).toContain(".asset-page-card-shell");
    expect(css.slice(assetOverrideIndex, assetOverrideIndex + 260)).not.toContain("min-height: max-content");
    expect(detailSectionIndex).toBeGreaterThan(panelIndex);
    expect(css.slice(detailSectionIndex, detailSectionIndex + 220)).toContain("overflow: visible");
    expect(css).not.toContain(".asset-elements-card.panel");
  });

  it("keeps the asset save bar outside the scrollable detail area", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");
    const editorRule = css.slice(css.indexOf(".asset-editor-column {"), css.indexOf(".asset-recording-actions"));
    const saveBarRule = css.slice(css.indexOf(".asset-floating-actions {"), css.indexOf(".asset-floating-actions > div"));
    const scrollRule = css.slice(css.indexOf(".asset-editor-scroll {"), css.indexOf(".asset-editor-scroll {") + 220);
    const detailScrollRule = css.slice(css.indexOf(".asset-detail-scroll {"), css.indexOf(".asset-detail-scroll {") + 220);

    expect(editorRule).toContain("overflow: hidden");
    expect(css).toContain(".asset-editor-scroll");
    expect(scrollRule).toContain("padding: 0");
    expect(detailScrollRule).toContain("overflow: auto");
    expect(detailScrollRule).toContain("padding: 0 2px 0 0");
    expect(saveBarRule).toContain("position: static");
    expect(saveBarRule).not.toContain("position: sticky");
    expect(saveBarRule).not.toContain("position: absolute");
    expect(saveBarRule).not.toContain("z-index");
    expect(saveBarRule).not.toContain("backdrop-filter");
  });

  it("keeps every use case center pane in the mobile document flow", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");
    const mobileRule = css.slice(css.lastIndexOf("@media (max-width: 900px)"));
    const headerRule = mobileRule.slice(mobileRule.indexOf(".case-center-header {"), mobileRule.indexOf(".case-center-toolbar {"));
    const workbenchRule = mobileRule.slice(mobileRule.indexOf(".case-center-layout {"), mobileRule.indexOf(".case-list {"));
    const inspectorRule = mobileRule.slice(mobileRule.indexOf(".case-run-panel {"), mobileRule.indexOf(".case-run-panel {") + 180);

    expect(headerRule).toContain("flex: none");
    expect(workbenchRule).toContain("flex: none");
    expect(workbenchRule).toContain("overflow: visible");
    expect(inspectorRule).toContain("flex: none");
    expect(inspectorRule).toContain("overflow: visible");
  });
});
