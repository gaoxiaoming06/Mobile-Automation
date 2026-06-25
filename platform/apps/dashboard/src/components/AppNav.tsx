import {
  ClipboardList,
  DatabaseZap,
  FileText,
  FolderOpen,
  GitBranch,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PlayCircle,
  Settings,
  Smartphone
} from "lucide-react";

export type AppNavItemId = "devices" | "caseLibrary" | "recording" | "assetRecording" | "pageAssets" | "runs" | "graphs" | "packages" | "reports" | "settings";

type AppNavProps = {
  activeNavItem: AppNavItemId;
  navCollapsed: boolean;
  setNavCollapsed: (updater: (value: boolean) => boolean) => void;
  openDevices: () => void;
  openRecording: () => void;
  openCaseLibrary: () => void;
  openAssetRecording: () => void;
  openPageAssets: () => void;
  openRuns: () => void;
  openGraphs: () => void;
};

export function AppNav({
  activeNavItem,
  navCollapsed,
  setNavCollapsed,
  openDevices,
  openRecording,
  openCaseLibrary,
  openAssetRecording,
  openPageAssets,
  openRuns,
  openGraphs
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
        <button className={navButtonClass(activeNavItem, "recording")} onClick={openRecording} title="用例录制" type="button">
          <ClipboardList size={18} />
          <span>用例录制</span>
        </button>
        <button className={navButtonClass(activeNavItem, "caseLibrary")} onClick={openCaseLibrary} title="用例库" type="button">
          <FolderOpen size={18} />
          <span>用例库</span>
        </button>
        <button className={navButtonClass(activeNavItem, "assetRecording")} onClick={openAssetRecording} title="资产录制" type="button">
          <DatabaseZap size={18} />
          <span>资产录制</span>
        </button>
        <button className={navButtonClass(activeNavItem, "pageAssets")} onClick={openPageAssets} title="页面资产库" type="button">
          <FileText size={18} />
          <span>页面资产库</span>
        </button>
        <button className={navButtonClass(activeNavItem, "runs")} onClick={openRuns} title="执行结果" type="button">
          <PlayCircle size={18} />
          <span>执行结果</span>
        </button>
        <button
          className={`${navButtonClass(activeNavItem, "graphs")} experimental`}
          onClick={openGraphs}
          title="业务图谱上层能力已冻结，仅作为实验入口保留"
          type="button"
        >
          <GitBranch size={18} />
          <span>实验能力</span>
        </button>
        <button className="nav-item planned" disabled title="包管理按产品规划接入" type="button">
          <Package size={18} />
          <span>包管理</span>
        </button>
        <button className="nav-item planned" disabled title="报告中心按产品规划接入" type="button">
          <FileText size={18} />
          <span>报告</span>
        </button>
        <button className="nav-item planned" disabled title="设置按产品规划接入" type="button">
          <Settings size={18} />
          <span>设置</span>
        </button>
      </nav>
    </aside>
  );
}

function navButtonClass(activeNavItem: AppNavItemId, item: AppNavItemId): string {
  return activeNavItem === item ? "nav-item active" : "nav-item";
}
