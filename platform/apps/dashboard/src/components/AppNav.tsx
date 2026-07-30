import {
  DatabaseZap,
  FileText,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PlayCircle,
  Radar,
  Settings,
  Sparkles,
  Smartphone,
  Workflow
} from "lucide-react";

export type AppNavItemId = "devices" | "assetRecording" | "pageAssets" | "scriptFlows" | "aiScriptFlows" | "stability" | "runs" | "settings";

type AppNavProps = {
  activeNavItem: AppNavItemId;
  navCollapsed: boolean;
  setNavCollapsed: (updater: (value: boolean) => boolean) => void;
  openDevices: () => void;
  openAssetRecording: () => void;
  openPageAssets: () => void;
  openScriptFlows: () => void;
  openAiScriptFlows: () => void;
  openStability: () => void;
  openRuns: () => void;
  openSettings: () => void;
};

export function AppNav({
  activeNavItem,
  navCollapsed,
  setNavCollapsed,
  openDevices,
  openAssetRecording,
  openPageAssets,
  openScriptFlows,
  openAiScriptFlows,
  openStability,
  openRuns,
  openSettings
}: AppNavProps) {
  return (
    <aside className="app-nav" aria-label="主导航">
      <button className="nav-toggle" onClick={() => setNavCollapsed((value) => !value)} title={navCollapsed ? "展开导航" : "收起导航"} type="button">
        {navCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        <span>导航</span>
      </button>
      <nav className="nav-items">
        <button className={navButtonClass(activeNavItem, "devices")} onClick={openDevices} title="设备管理" type="button">
          <Smartphone size={18} />
          <span>设备管理</span>
        </button>
        <button className={navButtonClass(activeNavItem, "assetRecording")} onClick={openAssetRecording} title="资产录制" type="button">
          <DatabaseZap size={18} />
          <span>资产录制</span>
        </button>
        <button className={navButtonClass(activeNavItem, "pageAssets")} onClick={openPageAssets} title="页面资产库" type="button">
          <FileText size={18} />
          <span>页面资产库</span>
        </button>
        <button className={navButtonClass(activeNavItem, "scriptFlows")} onClick={openScriptFlows} title="用例中心" type="button">
          <Workflow size={18} />
          <span>用例中心</span>
        </button>
        <button className={navButtonClass(activeNavItem, "aiScriptFlows")} onClick={openAiScriptFlows} title="AI 生成测试" type="button">
          <Sparkles size={18} />
          <span>AI 生成测试</span>
        </button>
        <button className={navButtonClass(activeNavItem, "stability")} onClick={openStability} title="稳定性探索" type="button">
          <Radar size={18} />
          <span>稳定性探索</span>
        </button>
        <button className={navButtonClass(activeNavItem, "runs")} onClick={openRuns} title="执行结果" type="button">
          <PlayCircle size={18} />
          <span>执行结果</span>
        </button>
        <button className="nav-item planned" disabled title="包管理按产品规划接入" type="button">
          <Package size={18} />
          <span>包管理</span>
        </button>
        <button className="nav-item planned" disabled title="报告中心按产品规划接入" type="button">
          <FileText size={18} />
          <span>报告</span>
        </button>
        <button className={navButtonClass(activeNavItem, "settings")} onClick={openSettings} title="系统设置" type="button">
          <Settings size={18} />
          <span>系统设置</span>
        </button>
      </nav>
    </aside>
  );
}

function navButtonClass(activeNavItem: AppNavItemId, item: AppNavItemId): string {
  return activeNavItem === item ? "nav-item active" : "nav-item";
}
