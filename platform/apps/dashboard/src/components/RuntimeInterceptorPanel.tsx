import { ShieldAlert, Trash2 } from "lucide-react";
import type { DeviceInfo } from "@mobile-automation/shared";

export type RuntimeInterceptorRule = {
  id: string;
  name: string;
  enabled?: boolean;
  text?: string;
  platformScope?: "android" | "ios" | "harmony" | "mobile-both";
  appPackageName?: string;
  iosBundleId?: string;
  matchers?: Array<{
    type: "text" | "resource_id" | "content_desc" | "activity" | "package";
    value: string;
    mode?: "contains" | "equals";
  }>;
  action:
    | {
        type: "tap_text";
        text: string;
        mode?: "contains" | "equals";
      }
    | {
        type: "tap_element";
        resourceId?: string;
        text?: string;
        contentDesc?: string;
        mode?: "contains" | "equals";
      }
    | {
        type: "back";
      };
};

type RuntimeInterceptorPanelProps = {
  selectedSerial: string;
  selectedDevice?: DeviceInfo;
  rules: RuntimeInterceptorRule[];
  onMarkCurrentPage: () => Promise<void>;
  onDeleteRule: (ruleId: string) => Promise<void>;
};

export function RuntimeInterceptorPanel({ selectedSerial, selectedDevice, rules, onMarkCurrentPage, onDeleteRule }: RuntimeInterceptorPanelProps) {
  return (
    <section className="runtime-interceptor-panel">
      <div className="runtime-interceptor-head">
        <div>
          <strong>临时阻断页</strong>
          <span>{rules.length ? `${rules.length} 条规则` : "遇到弹窗或临时页时自动处理后继续原步骤"}</span>
        </div>
        <button className="icon-button compact-text" type="button" onClick={() => void onMarkCurrentPage()} disabled={!selectedSerial || !selectedDevice}>
          <ShieldAlert size={16} />
          标记当前页
        </button>
      </div>
      {rules.length > 0 && (
        <div className="runtime-interceptor-list">
          {rules.slice(0, 3).map((rule) => (
            <div className="runtime-interceptor-rule" key={rule.id}>
              <div>
                <strong>{rule.name}</strong>
                <span>{formatRuntimeInterceptorRule(rule)}</span>
              </div>
              <button className="icon-only danger" type="button" onClick={() => void onDeleteRule(rule.id)} title="删除阻断规则">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatRuntimeInterceptorRule(rule: RuntimeInterceptorRule): string {
  const matcher = rule.matchers?.[0]?.value ?? rule.text ?? "未配置触发条件";
  const action =
    rule.action.type === "back"
      ? "返回"
      : rule.action.type === "tap_text"
        ? `点击文字 ${rule.action.text}`
        : `点击元素 ${rule.action.resourceId ?? rule.action.text ?? rule.action.contentDesc ?? "-"}`;
  const scope = rule.appPackageName ?? rule.iosBundleId ?? rule.platformScope ?? "全局";
  return `${scope} · 看到 ${matcher} -> ${action}`;
}
