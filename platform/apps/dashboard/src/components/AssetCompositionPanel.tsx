import { ArrowDown, ArrowUp, Play, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AssetCompositeCase,
  AssetCompositeCaseStep,
  AssetParameterValue,
  MetaFunction,
  MetaFunctionParameter,
  MetaFunctionStep,
  ParameterDataRecord,
  ParameterProfileBinding,
  ParameterProfile
} from "@mobile-automation/shared";
import { apiFetchJson } from "../api";

type CompositionCatalog = {
  graphVersionId: string;
  pages: Array<{
    id: string;
    name: string;
    elements: Array<{ id: string; label: string }>;
    transitions: Array<{ id: string; elementId?: string; targetPageModelId?: string; targetPageName?: string }>;
    tasks: Array<{ id: string; name: string; status?: string }>;
  }>;
};

type ParameterManifest = {
  appId: string;
  platform: "android" | "ios";
  graphVersionId: string;
  definitions: Array<{
    key: string;
    label: string;
    type: AssetParameterValue["type"];
    sensitive: boolean;
    scenarioKey: string;
    scenarioLabel: string;
    usages: Array<{
      pageModelId: string;
      pageModelName: string;
      stepLabel?: string;
    }>;
  }>;
  groups: Array<{
    key: string;
    label: string;
    parameterKeys: string[];
  }>;
};

type CompositePlan = {
  status: "ready" | "needs_parameters" | "blocked";
  steps: Array<{ id: string; metaFunctionName: string; kind: string; targetPageModelId: string; pageElementId?: string; pageTaskId?: string }>;
  issues: Array<{ code: string; message: string; assetId?: string }>;
};

type CompositeExecution = {
  id: string;
  status: "running" | "passed" | "failed" | "stopped";
  totalItems: number;
  completedItems: number;
  failedItems: number;
  currentItem?: { metaFunctionName: string; kind: string };
  items: Array<{ id: string; metaFunctionName: string; kind: string; status: string; error?: string }>;
};

export type AssetCompositionInitialData = {
  catalog: CompositionCatalog;
  dataRecords: ParameterDataRecord[];
  profiles: ParameterProfile[];
  metaFunctions: MetaFunction[];
  cases: AssetCompositeCase[];
  parameterManifest?: ParameterManifest;
};

type AssetCompositionPanelProps = {
  selectedSerial: string;
  selectedDeviceBusy: boolean;
  defaultAppId: string;
  setMessage: (message: string) => void;
  initialData?: AssetCompositionInitialData;
  mode?: "all" | "parameters";
};

type CompositionTab = "records" | "profiles" | "meta" | "cases";

export function AssetCompositionPanel({ selectedSerial, selectedDeviceBusy, defaultAppId, setMessage, initialData, mode = "all" }: AssetCompositionPanelProps) {
  const parameterMode = mode === "parameters";
  const [appId, setAppId] = useState(defaultAppId);
  const [tab, setTab] = useState<CompositionTab>(parameterMode ? "records" : "meta");
  const [data, setData] = useState<AssetCompositionInitialData>(initialData ?? emptyData());
  const [busy, setBusy] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState(initialData?.dataRecords[0]?.id ?? "");
  const [selectedProfileId, setSelectedProfileId] = useState(initialData?.profiles[0]?.id ?? "");
  const [selectedMetaFunctionId, setSelectedMetaFunctionId] = useState(initialData?.metaFunctions[0]?.id ?? "");
  const [selectedCaseId, setSelectedCaseId] = useState(initialData?.cases[0]?.id ?? "");
  const [recordDraft, setRecordDraft] = useState(() => dataRecordDraftFrom(initialData?.dataRecords[0], defaultAppId));
  const [profileDraft, setProfileDraft] = useState(() => profileDraftFrom(initialData?.profiles[0], defaultAppId));
  const [metaDraft, setMetaDraft] = useState(() => metaDraftFrom(initialData?.metaFunctions[0], defaultAppId));
  const [caseDraft, setCaseDraft] = useState(() => caseDraftFrom(initialData?.cases[0], defaultAppId));
  const [plan, setPlan] = useState<CompositePlan>();
  const [execution, setExecution] = useState<CompositeExecution>();

  useEffect(() => {
    if (!initialData) {
      void refresh();
    }
  }, []);

  useEffect(() => {
    if (!execution || execution.status !== "running") {
      return;
    }
    const timer = window.setInterval(() => {
      void apiFetchJson<{ execution: CompositeExecution }>(`/api/asset-composition/executions/${encodeURIComponent(execution.id)}`)
        .then((response) => setExecution(response.execution))
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [execution?.id, execution?.status]);

  const selectedProfile = data.profiles.find((item) => item.id === selectedProfileId);
  const selectedMetaFunction = data.metaFunctions.find((item) => item.id === selectedMetaFunctionId);
  const selectedCase = data.cases.find((item) => item.id === selectedCaseId);

  async function refresh() {
    if (!appId.trim()) {
      setMessage("请输入 App 包名");
      return;
    }
    setBusy(true);
    try {
      const query = `appId=${encodeURIComponent(appId.trim())}&platform=android`;
      const [catalogResponse, recordResponse, profileResponse, metaResponse, caseResponse, parameterManifestResponse] = await Promise.all([
        apiFetchJson<{ catalog: CompositionCatalog }>(`/api/asset-composition/catalog?appId=${encodeURIComponent(appId.trim())}`),
        apiFetchJson<{ records: ParameterDataRecord[] }>(`/api/parameter-center/data-records?${query}`),
        apiFetchJson<{ profiles: ParameterProfile[] }>(`/api/asset-composition/parameter-profiles?${query}`),
        apiFetchJson<{ metaFunctions: MetaFunction[] }>(`/api/asset-composition/meta-functions?${query}`),
        apiFetchJson<{ cases: AssetCompositeCase[] }>(`/api/asset-composition/cases?${query}`),
        apiFetchJson<{ manifest: ParameterManifest }>(`/api/parameter-center/manifest?${query}`).catch(() => ({ manifest: undefined }))
      ]);
      const next = {
        catalog: catalogResponse.catalog,
        dataRecords: recordResponse.records,
        profiles: profileResponse.profiles,
        metaFunctions: metaResponse.metaFunctions,
        cases: caseResponse.cases,
        parameterManifest: parameterManifestResponse.manifest
      };
      setData(next);
      selectFirstAssets(next);
      setMessage(`已加载 ${next.catalog.pages.length} 个页面资产及组合测试数据`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function selectFirstAssets(next: AssetCompositionInitialData) {
    const record = next.dataRecords[0];
    const profile = next.profiles[0];
    const metaFunction = next.metaFunctions[0];
    const compositeCase = next.cases[0];
    setSelectedRecordId(record?.id ?? "");
    setRecordDraft(dataRecordDraftFrom(record, appId));
    setSelectedProfileId(profile?.id ?? "");
    setProfileDraft(profileDraftFrom(profile, appId));
    setSelectedMetaFunctionId(metaFunction?.id ?? "");
    setMetaDraft(metaDraftFrom(metaFunction, appId));
    setSelectedCaseId(compositeCase?.id ?? "");
    setCaseDraft(caseDraftFrom(compositeCase, appId));
  }

  async function saveProfile() {
    if (!profileDraft.name.trim()) {
      setMessage("请填写执行组合名称");
      return;
    }
    await saveAsset(`/api/asset-composition/parameter-profiles${profileDraft.id ? `/${encodeURIComponent(profileDraft.id)}` : ""}`, profileDraft.id ? "PUT" : "POST", {
      appId: appId.trim(), platform: "android", name: profileDraft.name.trim(), environment: profileDraft.environment.trim() || undefined,
      bindings: profileDraft.bindings, values: profileDraft.values, status: "active"
    }, "执行组合已保存");
  }

  async function saveDataRecord() {
    if (!recordDraft.name.trim() || !recordDraft.domainKey) {
      setMessage("请选择业务领域并填写数据记录名称");
      return;
    }
    await saveAsset(`/api/parameter-center/data-records${recordDraft.id ? `/${encodeURIComponent(recordDraft.id)}` : ""}`, recordDraft.id ? "PUT" : "POST", {
      appId: appId.trim(), platform: "android", domainKey: recordDraft.domainKey, name: recordDraft.name.trim(),
      description: recordDraft.description.trim() || undefined, environment: recordDraft.environment.trim() || undefined,
      values: recordDraft.values, status: "active"
    }, "数据记录已保存");
  }

  async function saveMetaFunction() {
    if (!metaDraft.name.trim() || !metaDraft.steps.length) {
      setMessage("元功能需要名称和至少一个资产步骤");
      return;
    }
    await saveAsset(`/api/asset-composition/meta-functions${metaDraft.id ? `/${encodeURIComponent(metaDraft.id)}` : ""}`, metaDraft.id ? "PUT" : "POST", {
      appId: appId.trim(), platform: "android", name: metaDraft.name.trim(), description: metaDraft.description.trim() || undefined,
      parameters: metaFunctionParametersFromText(metaDraft.parametersText), steps: metaDraft.steps, status: metaDraft.status
    }, "元功能已保存");
  }

  async function saveCompositeCase() {
    if (!caseDraft.name.trim() || !caseDraft.steps.length) {
      setMessage("组合用例需要名称和至少一个元功能");
      return;
    }
    await saveAsset(`/api/asset-composition/cases${caseDraft.id ? `/${encodeURIComponent(caseDraft.id)}` : ""}`, caseDraft.id ? "PUT" : "POST", {
      appId: appId.trim(), platform: "android", name: caseDraft.name.trim(), description: caseDraft.description.trim() || undefined,
      parameterProfileId: caseDraft.parameterProfileId || undefined, runMode: caseDraft.runMode, repeatCount: caseDraft.repeatCount,
      stopOnFailure: caseDraft.stopOnFailure, steps: caseDraft.steps, status: caseDraft.status
    }, "组合用例已保存");
  }

  async function saveAsset(url: string, method: "POST" | "PUT", body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    try {
      await apiFetchJson(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setMessage(successMessage);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAsset(kind: "parameter-profiles" | "meta-functions" | "cases", id: string) {
    if (!id) return;
    setBusy(true);
    try {
      await apiFetchJson(`/api/asset-composition/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteDataRecord(id: string) {
    if (!id) return;
    setBusy(true);
    try {
      await apiFetchJson(`/api/parameter-center/data-records/${encodeURIComponent(id)}`, { method: "DELETE" });
      setMessage("数据记录已删除");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function updateProfileBinding(domainKey: string, recordId: string) {
    setProfileDraft((current) => ({
      ...current,
      bindings: recordId
        ? [...current.bindings.filter((binding) => binding.domainKey !== domainKey), { domainKey, recordId }]
        : current.bindings.filter((binding) => binding.domainKey !== domainKey)
    }));
  }

  async function previewCase() {
    if (!caseDraft.id) {
      setMessage("请先保存组合用例");
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetchJson<{ plan: CompositePlan }>(`/api/asset-composition/cases/${encodeURIComponent(caseDraft.id)}/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parameterProfileId: caseDraft.parameterProfileId || undefined })
      });
      setPlan(response.plan);
      setMessage(messageForCompositionPlan(response.plan, "组合用例"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function executeCase() {
    if (!caseDraft.id || !selectedSerial) {
      setMessage(!selectedSerial ? "请先选择执行设备" : "请先保存组合用例");
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetchJson<{ execution: CompositeExecution; plan: CompositePlan }>(`/api/asset-composition/cases/${encodeURIComponent(caseDraft.id)}/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceSerial: selectedSerial, parameterProfileId: caseDraft.parameterProfileId || undefined })
      });
      setPlan(response.plan);
      setExecution(response.execution);
      setMessage(`已启动组合用例：${response.execution.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-page asset-composition-module">
      <div className="module-header asset-composition-header">
        <div className="asset-composition-title">
          <h2>{parameterMode ? "参数中心" : "资产用例"}</h2>
          <p>{parameterMode ? "按业务领域维护可复用的运行数据，再组合成一次执行配置。" : "把页面资产编排成可复用的元功能，再组合成端到端测试用例。"}</p>
        </div>
        <div className="asset-composition-app-picker">
          <input value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="App 包名" />
          <button className="icon-button" type="button" onClick={() => void refresh()} disabled={busy} title={parameterMode ? "刷新参数中心" : "刷新资产用例"}><RefreshCw size={16} /></button>
        </div>
      </div>

      <div className="asset-composition-summary">
        {parameterMode ? <>
          <Summary label="数据记录" count={data.dataRecords.length} example={data.dataRecords[0]?.name} />
          <Summary label="执行组合" count={data.profiles.length} example={data.profiles[0]?.name} />
          <Summary label="数据领域" count={data.parameterManifest?.groups.length ?? 0} example={data.parameterManifest?.groups[0]?.label} />
        </> : <>
          <Summary label="元功能" count={data.metaFunctions.length} example={data.metaFunctions[0]?.name} />
          <Summary label="组合用例" count={data.cases.length} example={data.cases[0]?.name} />
          <Summary label="执行组合" count={data.profiles.length} example="在参数中心维护" />
        </>}
        <Summary label="页面资产" count={data.catalog.pages.length} example={data.catalog.pages[0]?.name} />
      </div>

      <div className="segmented asset-composition-tabs">
        {parameterMode ? <>
          <button type="button" className={tab === "records" ? "active" : ""} onClick={() => setTab("records")}>数据记录</button>
          <button type="button" className={tab === "profiles" ? "active" : ""} onClick={() => setTab("profiles")}>执行组合</button>
        </> : <>
          <button type="button" className={tab === "meta" ? "active" : ""} onClick={() => setTab("meta")}>元功能</button>
          <button type="button" className={tab === "cases" ? "active" : ""} onClick={() => setTab("cases")}>组合用例</button>
        </>}
      </div>

      {tab === "records" ? (
        <EditorLayout
          title="数据记录"
          items={data.dataRecords.map((item) => ({ id: item.id, name: item.name, detail: `${domainLabel(item.domainKey, data.parameterManifest)} · ${Object.keys(item.values).length} 个字段 · v${item.version}` }))}
          selectedId={selectedRecordId}
          onSelect={(id) => { const item = data.dataRecords.find((record) => record.id === id); setSelectedRecordId(id); setRecordDraft(dataRecordDraftFrom(item, appId)); }}
          onAdd={() => { setSelectedRecordId(""); setRecordDraft(dataRecordDraftFrom(undefined, appId)); }}
        >
          {!recordDraft.domainKey ? (
            <DataRecordDomainChooser
              groups={data.parameterManifest?.groups ?? []}
              onSelect={(domainKey) => setRecordDraft({ ...recordDraft, domainKey })}
            />
          ) : (
            <>
              <div className="data-record-editor-header">
                <div>
                  <span>数据领域</span>
                  <strong>{domainLabel(recordDraft.domainKey, data.parameterManifest)}</strong>
                  <small>字段按关联页面分区。执行组合会把不同领域的数据记录拼成一次运行数据。</small>
                </div>
                <label>
                  切换领域
                  <select value={recordDraft.domainKey} onChange={(event) => setRecordDraft({ ...recordDraft, domainKey: event.target.value })}>
                    {(data.parameterManifest?.groups ?? []).map((group) => <option key={group.key} value={group.key}>{group.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="form-grid two-columns">
                <label>数据名称<input value={recordDraft.name} onChange={(event) => setRecordDraft({ ...recordDraft, name: event.target.value })} placeholder="例如：教师账号 A" /></label>
                <label>环境<input value={recordDraft.environment} onChange={(event) => setRecordDraft({ ...recordDraft, environment: event.target.value })} placeholder="test / staging" /></label>
              </div>
              <label>说明<input value={recordDraft.description} onChange={(event) => setRecordDraft({ ...recordDraft, description: event.target.value })} placeholder="描述这一条测试数据适用的账号或业务状态" /></label>
              <ParameterProfileFields manifest={data.parameterManifest} domainKey={recordDraft.domainKey} values={recordDraft.values} onChange={(key, value) => setRecordDraft({ ...recordDraft, values: { ...recordDraft.values, [key]: value } })} showIntro={false} />
              <EditorActions busy={busy} onSave={() => void saveDataRecord()} onDelete={recordDraft.id ? () => void deleteDataRecord(recordDraft.id) : undefined} />
            </>
          )}
        </EditorLayout>
      ) : null}

      {tab === "profiles" ? (
        <EditorLayout
          title="执行组合"
          items={data.profiles.map((item) => ({ id: item.id, name: item.name, detail: `${item.bindings?.length ?? 0} 个数据领域 · v${item.version}` }))}
          selectedId={selectedProfileId}
          onSelect={(id) => { const item = data.profiles.find((profile) => profile.id === id); setSelectedProfileId(id); setProfileDraft(profileDraftFrom(item, appId)); }}
          onAdd={() => { setSelectedProfileId(""); setProfileDraft(profileDraftFrom(undefined, appId)); }}
        >
          <div className="form-grid two-columns"><label>执行组合名称<input value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} placeholder="例如：教师课堂巡检" /></label><label>环境<input value={profileDraft.environment} onChange={(event) => setProfileDraft({ ...profileDraft, environment: event.target.value })} placeholder="test / staging" /></label></div>
          <div className="parameter-center-intro"><strong>选择本次运行使用的数据</strong><span>一个执行组合在每个业务领域最多绑定一条数据记录；巡检、元功能和组合用例都引用同一份运行快照。</span></div>
          <div className="parameter-profile-bindings">{(data.parameterManifest?.groups ?? []).map((group) => { const records = data.dataRecords.filter((record) => record.domainKey === group.key && record.status === "active"); const selectedBinding = profileDraft.bindings.find((binding) => binding.domainKey === group.key); return <label className="parameter-profile-binding" key={group.key}><span><strong>{group.label}</strong><small>{group.parameterKeys.join("、")}</small></span><select value={selectedBinding?.recordId ?? ""} onChange={(event) => updateProfileBinding(group.key, event.target.value)}><option value="">本次不使用此领域</option>{records.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>; })}</div>
          <details className="parameter-profile-overrides"><summary>高级：直接覆盖参数（兼容旧配置）</summary><ParameterProfileFields manifest={data.parameterManifest} values={profileDraft.values} onChange={(key, value) => setProfileDraft({ ...profileDraft, values: { ...profileDraft.values, [key]: value } })} /></details>
          <EditorActions busy={busy} onSave={() => void saveProfile()} onDelete={profileDraft.id ? () => void deleteAsset("parameter-profiles", profileDraft.id) : undefined} />
        </EditorLayout>
      ) : null}

      {tab === "meta" ? (
        <EditorLayout
          title="元功能"
          items={data.metaFunctions.map((item) => ({ id: item.id, name: item.name, detail: `${item.steps.length} 步 · ${item.status} · v${item.version}` }))}
          selectedId={selectedMetaFunctionId}
          onSelect={(id) => { const item = data.metaFunctions.find((meta) => meta.id === id); setSelectedMetaFunctionId(id); setMetaDraft(metaDraftFrom(item, appId)); }}
          onAdd={() => { setSelectedMetaFunctionId(""); setMetaDraft(metaDraftFrom(undefined, appId)); }}
        >
          <div className="form-grid two-columns"><label>名称<input value={metaDraft.name} onChange={(event) => setMetaDraft({ ...metaDraft, name: event.target.value })} placeholder="例如：创建课堂但不发布" /></label><label>状态<select value={metaDraft.status} onChange={(event) => setMetaDraft({ ...metaDraft, status: event.target.value as MetaFunction["status"] })}><option value="draft">草稿</option><option value="active">启用</option><option value="deprecated">废弃</option></select></label></div>
          <label>说明<input value={metaDraft.description} onChange={(event) => setMetaDraft({ ...metaDraft, description: event.target.value })} /></label>
          <MetaFunctionParameterEditor value={metaDraft.parametersText} onChange={(parametersText) => setMetaDraft({ ...metaDraft, parametersText })} />
          <StepToolbar onAdd={(kind) => setMetaDraft({ ...metaDraft, steps: [...metaDraft.steps, newMetaStep(kind, metaDraft.steps.length + 1, data.catalog)] })} />
          <div className="composition-step-list">{metaDraft.steps.map((step, index) => <MetaStepEditor key={step.id} step={step} index={index} catalog={data.catalog} onChange={(next) => setMetaDraft({ ...metaDraft, steps: replaceOrdered(metaDraft.steps, index, next) })} onMove={(direction) => setMetaDraft({ ...metaDraft, steps: moveOrdered(metaDraft.steps, index, direction) })} onDelete={() => setMetaDraft({ ...metaDraft, steps: removeOrdered(metaDraft.steps, index) })} />)}</div>
          <EditorActions busy={busy} onSave={() => void saveMetaFunction()} onDelete={metaDraft.id ? () => void deleteAsset("meta-functions", metaDraft.id) : undefined} />
        </EditorLayout>
      ) : null}

      {tab === "cases" ? (
        <EditorLayout
          title="组合用例"
          items={data.cases.map((item) => ({ id: item.id, name: item.name, detail: `${item.steps.length} 个元功能 · ${item.runMode} · v${item.version}` }))}
          selectedId={selectedCaseId}
          onSelect={(id) => { const item = data.cases.find((testCase) => testCase.id === id); setSelectedCaseId(id); setCaseDraft(caseDraftFrom(item, appId)); setPlan(undefined); setExecution(undefined); }}
          onAdd={() => { setSelectedCaseId(""); setCaseDraft(caseDraftFrom(undefined, appId)); setPlan(undefined); setExecution(undefined); }}
        >
          <div className="form-grid two-columns"><label>名称<input value={caseDraft.name} onChange={(event) => setCaseDraft({ ...caseDraft, name: event.target.value })} /></label><label>执行组合<select value={caseDraft.parameterProfileId} onChange={(event) => setCaseDraft({ ...caseDraft, parameterProfileId: event.target.value })}><option value="">不使用执行组合</option>{data.profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
          <div className="form-grid three-columns"><label>执行模式<select value={caseDraft.runMode} onChange={(event) => setCaseDraft({ ...caseDraft, runMode: event.target.value as AssetCompositeCase["runMode"] })}><option value="once">单次</option><option value="repeat_n">N 次</option><option value="loop_until_stop">循环</option></select></label><label>次数<input type="number" min={1} value={caseDraft.repeatCount} onChange={(event) => setCaseDraft({ ...caseDraft, repeatCount: Math.max(1, Number(event.target.value) || 1) })} /></label><label className="checkbox-field"><input type="checkbox" checked={caseDraft.stopOnFailure} onChange={(event) => setCaseDraft({ ...caseDraft, stopOnFailure: event.target.checked })} />失败后停止</label></div>
          <button className="secondary-button" type="button" disabled={!data.metaFunctions.length} onClick={() => setCaseDraft({ ...caseDraft, steps: [...caseDraft.steps, newCaseStep(data.metaFunctions[0]!.id, caseDraft.steps.length + 1)] })}><Plus size={15} />添加元功能</button>
          <div className="composition-step-list">{caseDraft.steps.map((step, index) => <CaseStepEditor key={step.id} step={step} index={index} metaFunctions={data.metaFunctions} onChange={(next) => setCaseDraft({ ...caseDraft, steps: replaceOrdered(caseDraft.steps, index, next) })} onMove={(direction) => setCaseDraft({ ...caseDraft, steps: moveOrdered(caseDraft.steps, index, direction) })} onDelete={() => setCaseDraft({ ...caseDraft, steps: removeOrdered(caseDraft.steps, index) })} />)}</div>
          <EditorActions busy={busy} onSave={() => void saveCompositeCase()} onDelete={caseDraft.id ? () => void deleteAsset("cases", caseDraft.id) : undefined} />
          <div className="composition-run-actions"><button className="secondary-button" type="button" disabled={!caseDraft.id || busy} onClick={() => void previewCase()}>预检</button><button className="primary-button" type="button" disabled={!caseDraft.id || !selectedSerial || selectedDeviceBusy || busy || execution?.status === "running"} onClick={() => void executeCase()}><Play size={16} />执行组合用例</button></div>
          {plan ? <PlanView plan={plan} /> : null}
          {execution ? <ExecutionView execution={execution} /> : null}
        </EditorLayout>
      ) : null}
    </section>
  );
}

function Summary({ label, count, example }: { label: string; count: number; example?: string }) { return <div><span>{label}</span><strong>{count}</strong><small>{example ?? "暂无"}</small></div>; }

function ParameterProfileFields({ manifest, values, onChange, domainKey, showIntro = true }: { manifest?: ParameterManifest; values: Record<string, AssetParameterValue>; onChange: (key: string, value: AssetParameterValue) => void; domainKey?: string; showIntro?: boolean }) {
  const definitionByKey = new Map((manifest?.definitions ?? []).map((definition) => [definition.key, definition]));
  const groups = (manifest?.groups ?? [])
    .map((group) => ({ ...group, definitions: group.parameterKeys.map((key) => definitionByKey.get(key)).filter((definition): definition is ParameterManifest["definitions"][number] => Boolean(definition)) }))
    .filter((group) => group.definitions.length > 0 && (!domainKey || group.key === domainKey));
  const legacyDefinitions = Object.entries(values)
    .filter(([key]) => !definitionByKey.has(key) && !domainKey)
    .map(([key, value]) => ({
      key,
      label: key,
      type: value.type,
      sensitive: Boolean(value.sensitive),
      scenarioKey: "legacy",
      scenarioLabel: "未归类参数",
      usages: []
    }));
  const pageGroups = domainKey ? groupDefinitionsByPage(groups.flatMap((group) => group.definitions)) : [];

  return (
    <div className="parameter-center-fields">
      {showIntro ? <div className="parameter-center-intro"><strong>高级直接覆盖</strong><span>只在需要临时覆盖数据记录时填写；日常数据请在“参数中心 - 数据记录”中维护。</span></div> : null}
      {!groups.length ? <div className="empty">{domainKey ? "当前业务领域还没有提取到参数定义。" : "当前资产还没有提取到动态参数。先在页面能力或页面任务中绑定参数后再刷新。"}</div> : null}
      {domainKey ? (
        <div className="parameter-page-sections">
          {pageGroups.map((pageGroup) => (
            <section className="parameter-page-section" key={pageGroup.id}>
              <header><strong>{pageGroup.name}</strong><span>{pageGroup.definitions.length} 个参数</span></header>
              <div className="parameter-center-field-grid">
                {pageGroup.definitions.map((definition) => <ParameterProfileField key={definition.key} definition={definition} value={values[definition.key]} onChange={(value) => onChange(definition.key, value)} />)}
              </div>
            </section>
          ))}
        </div>
      ) : groups.map((group) => (
        <section className="parameter-center-group" key={group.key}>
          <header><strong>{group.label}</strong><span>{group.definitions.length} 个参数</span></header>
          <div className="parameter-center-field-grid">
            {group.definitions.map((definition) => <ParameterProfileField key={definition.key} definition={definition} value={values[definition.key]} onChange={(value) => onChange(definition.key, value)} />)}
          </div>
        </section>
      ))}
      {legacyDefinitions.length ? (
        <details className="parameter-center-legacy">
          <summary>未归类历史参数（{legacyDefinitions.length}）</summary>
          <div className="parameter-center-field-grid">
            {legacyDefinitions.map((definition) => <ParameterProfileField key={definition.key} definition={definition} value={values[definition.key]} onChange={(value) => onChange(definition.key, value)} />)}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function DataRecordDomainChooser({ groups, onSelect }: { groups: ParameterManifest["groups"]; onSelect: (domainKey: string) => void }) {
  return <div className="data-record-domain-chooser">
    <div>
      <h4>新建测试数据</h4>
      <p>先选择业务领域，再按关联页面填写本次运行需要的数据。</p>
    </div>
    {!groups.length ? <div className="empty">当前资产还没有提取可配置的数据领域。</div> : <div className="data-domain-option-grid">
      {groups.map((group) => <button className="data-domain-option" type="button" key={group.key} onClick={() => onSelect(group.key)}>
        <strong>{group.label}</strong>
        <span>{group.parameterKeys.length} 个参数</span>
        <small>按关联页面维护</small>
      </button>)}
    </div>}
  </div>;
}

function MetaFunctionParameterEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const parameters = metaFunctionParametersFromText(value);
  const update = (next: MetaFunctionParameter[]) => onChange(metaFunctionParametersToText(next));
  const updateParameter = (index: number, next: Partial<MetaFunctionParameter>) => update(parameters.map((parameter, parameterIndex) => parameterIndex === index ? { ...parameter, ...next } : parameter));
  return <section className="meta-parameter-editor">
    <header>
      <div><h4>输入变量</h4><p>这些变量由测试数据在执行时注入。</p></div>
      <button className="secondary-button" type="button" onClick={() => update([...parameters, { key: `变量${parameters.length + 1}`, type: "string", required: false }])}><Plus size={15} />添加变量</button>
    </header>
    {parameters.length ? <div className="meta-parameter-list">
      {parameters.map((parameter, index) => <div className="meta-parameter-row" key={`${parameter.key}-${index}`}>
        <label>变量名<input value={parameter.key} onChange={(event) => updateParameter(index, { key: event.target.value })} /></label>
        <label>类型<select value={parameter.type} onChange={(event) => updateParameter(index, { type: event.target.value as MetaFunctionParameter["type"] })}><option value="string">文本</option><option value="number">数字</option><option value="boolean">开关</option><option value="template">模板</option></select></label>
        <label className="checkbox-field"><input type="checkbox" checked={parameter.required} onChange={(event) => updateParameter(index, { required: event.target.checked })} />必填</label>
        <button className="icon-button" type="button" title="删除变量" aria-label="删除变量" onClick={() => update(parameters.filter((_, parameterIndex) => parameterIndex !== index))}><Trash2 size={15} /></button>
      </div>)}
    </div> : <div className="empty">暂未声明输入变量；没有输入的元功能可以保持为空。</div>}
  </section>;
}

function groupDefinitionsByPage(definitions: ParameterManifest["definitions"]): Array<{ id: string; name: string; definitions: ParameterManifest["definitions"] }> {
  const grouped = new Map<string, { id: string; name: string; definitions: ParameterManifest["definitions"] }>();
  for (const definition of definitions) {
    const usage = definition.usages[0];
    const id = usage?.pageModelId ?? `scenario-${definition.scenarioKey}`;
    const name = usage?.pageModelName ?? definition.scenarioLabel;
    const group = grouped.get(id) ?? { id, name, definitions: [] };
    group.definitions.push(definition);
    grouped.set(id, group);
  }
  return [...grouped.values()];
}

function ParameterProfileField({ definition, value, onChange }: { definition: ParameterManifest["definitions"][number]; value?: AssetParameterValue; onChange: (value: AssetParameterValue) => void }) {
  const current = value?.value ?? "";
  const save = (next: string | number | boolean) => onChange({ type: definition.type, value: next, ...(definition.sensitive ? { sensitive: true } : {}) });
  const usage = definition.usages[0];
  const help = usage ? `${usage.pageModelName}${usage.stepLabel ? ` / ${usage.stepLabel}` : ""}` : definition.key;

  return (
    <label className="parameter-center-field">
      <span className="parameter-center-field-title">{definition.label}{definition.sensitive ? <em>敏感</em> : null}</span>
      <small>{help}</small>
      {definition.type === "boolean" ? (
        <select value={current === "" ? "" : String(current)} onChange={(event) => save(event.target.value === "" ? "" : event.target.value === "true")}>
          <option value="">未设置</option><option value="true">是</option><option value="false">否</option>
        </select>
      ) : (
        <input
          type={definition.type === "number" ? "number" : definition.sensitive ? "password" : "text"}
          value={String(current)}
          onChange={(event) => save(definition.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)}
          placeholder={definition.type === "template" ? "例如：课堂-{{timestamp}}" : `填写${definition.label}`}
        />
      )}
      <code>{definition.key}</code>
    </label>
  );
}

function EditorLayout({ title, items, selectedId, onSelect, onAdd, children }: { title: string; items: Array<{ id: string; name: string; detail: string }>; selectedId: string; onSelect: (id: string) => void; onAdd: () => void; children: React.ReactNode }) {
  return <div className="asset-composition-editor"><aside><div className="panel-head"><h3>{title}</h3><button className="icon-button" type="button" onClick={onAdd} title={`新增${title}`}><Plus size={16} /></button></div><div className="composition-asset-list">{items.map((item) => <button type="button" className={item.id === selectedId ? "selected" : ""} key={item.id} onClick={() => onSelect(item.id)}><strong>{item.name}</strong><span>{item.detail}</span></button>)}{!items.length ? <div className="empty">暂无{title}</div> : null}</div></aside><div className="composition-editor-form">{children}</div></div>;
}

function EditorActions({ busy, onSave, onDelete }: { busy: boolean; onSave: () => void; onDelete?: () => void }) { return <div className="editor-actions">{onDelete ? <button className="danger-button" type="button" onClick={onDelete} disabled={busy}><Trash2 size={15} />删除</button> : <span /> }<button className="primary-button" type="button" onClick={onSave} disabled={busy}><Save size={15} />保存</button></div>; }

type EditableMetaFunctionStepKind = Exclude<MetaFunctionStep["kind"], "system_action">;

function StepToolbar({ onAdd }: { onAdd: (kind: EditableMetaFunctionStepKind) => void }) {
  return <div className="composition-step-toolbar">
    <div><strong>资产步骤</strong><span>每一步复用已录入的页面资产，按顺序组成一个元功能。</span></div>
    <div className="step-toolbar-actions">
      <button type="button" onClick={() => onAdd("reach_page")}>到达页面</button>
      <button type="button" onClick={() => onAdd("invoke_capability")}>执行页面能力</button>
      <button type="button" onClick={() => onAdd("run_page_task")}>执行页面任务</button>
      <button type="button" onClick={() => onAdd("verify_page")}>验证页面</button>
    </div>
  </div>;
}

function MetaStepEditor({ step, index, catalog, onChange, onMove, onDelete }: { step: MetaFunctionStep; index: number; catalog: CompositionCatalog; onChange: (step: MetaFunctionStep) => void; onMove: (direction: -1 | 1) => void; onDelete: () => void }) {
  const pageId = step.kind === "reach_page"
    ? step.targetPageModelId
    : step.kind === "invoke_capability"
      ? step.sourcePageModelId
      : step.kind === "system_action"
        ? undefined
        : step.pageModelId;
  const page = catalog.pages.find((item) => item.id === pageId) ?? catalog.pages[0];
  return <article className="composition-step-card">
    <header>
      <div className="composition-step-heading"><span className="step-order">{index + 1}</span><div><strong>{metaStepKindLabel(step.kind)}</strong><small>{metaStepKindHint(step.kind)}</small></div></div>
      <StepButtons index={index} onMove={onMove} onDelete={onDelete} />
    </header>
    <div className="step-card-fields">
      <label>步骤类型<select aria-label={`第 ${index + 1} 步类型`} value={step.kind} onChange={(event) => onChange(newMetaStep(event.target.value as MetaFunctionStep["kind"], index + 1, catalog))}><option value="reach_page">到达页面</option><option value="invoke_capability">执行页面能力</option><option value="run_page_task">执行页面任务</option><option value="verify_page">验证页面</option>{step.kind === "system_action" ? <option value="system_action">系统步骤</option> : null}</select></label>
      {step.kind === "reach_page" ? <label>目标页面<PageSelect value={step.targetPageModelId} catalog={catalog} onChange={(value) => onChange({ ...step, targetPageModelId: value })} /></label> : null}
      {step.kind === "verify_page" ? <label>要验证的页面<PageSelect value={step.pageModelId} catalog={catalog} onChange={(value) => onChange({ ...step, pageModelId: value })} /></label> : null}
      {step.kind === "invoke_capability" ? <>
        <label>所在页面<PageSelect value={step.sourcePageModelId} catalog={catalog} onChange={(value) => { const nextPage = catalog.pages.find((item) => item.id === value); const element = nextPage?.elements[0]; const transition = nextPage?.transitions.find((item) => item.elementId === element?.id); onChange({ ...step, sourcePageModelId: value, pageElementId: element?.id ?? "", targetPageModelId: transition?.targetPageModelId }); }} /></label>
        <label>页面能力<select value={step.pageElementId} onChange={(event) => { const transition = page?.transitions.find((item) => item.elementId === event.target.value); onChange({ ...step, pageElementId: event.target.value, targetPageModelId: transition?.targetPageModelId }); }}>{page?.elements.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>预期到达页面<PageSelect value={step.targetPageModelId ?? ""} catalog={catalog} onChange={(value) => onChange({ ...step, targetPageModelId: value })} /></label>
      </> : null}
      {step.kind === "run_page_task" ? <>
        <label>所在页面<PageSelect value={step.pageModelId} catalog={catalog} onChange={(value) => { const nextPage = catalog.pages.find((item) => item.id === value); onChange({ ...step, pageModelId: value, pageTaskId: nextPage?.tasks[0]?.id ?? "" }); }} /></label>
        <label>页面任务<select value={step.pageTaskId} onChange={(event) => onChange({ ...step, pageTaskId: event.target.value })}>{page?.tasks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </> : null}
    </div>
  </article>;
}

function CaseStepEditor({ step, index, metaFunctions, onChange, onMove, onDelete }: { step: AssetCompositeCaseStep; index: number; metaFunctions: MetaFunction[]; onChange: (step: AssetCompositeCaseStep) => void; onMove: (direction: -1 | 1) => void; onDelete: () => void }) {
  const metaFunction = metaFunctions.find((item) => item.id === step.metaFunctionId);
  return <article className="composition-step-card">
    <header>
      <div className="composition-step-heading"><span className="step-order">{index + 1}</span><div><strong>执行元功能</strong><small>把可复用流程编排进这个组合用例。</small></div></div>
      <StepButtons index={index} onMove={onMove} onDelete={onDelete} />
    </header>
    <div className="step-card-fields"><label>选择元功能<select value={step.metaFunctionId} onChange={(event) => onChange({ ...step, metaFunctionId: event.target.value })}>{metaFunctions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div>
    <p className="case-step-summary">{metaFunction ? `${metaFunction.steps.length} 个资产步骤${metaFunction.parameters.length ? `，需要 ${metaFunction.parameters.length} 个输入变量` : ""}` : "请选择要执行的元功能。"}</p>
  </article>;
}

function StepButtons({ index, onMove, onDelete }: { index: number; onMove: (direction: -1 | 1) => void; onDelete: () => void }) { return <div className="step-icon-actions"><button type="button" onClick={() => onMove(-1)} disabled={index === 0} title="上移"><ArrowUp size={14} /></button><button type="button" onClick={() => onMove(1)} title="下移"><ArrowDown size={14} /></button><button type="button" onClick={onDelete} title="删除"><Trash2 size={14} /></button></div>; }

function metaStepKindLabel(kind: MetaFunctionStep["kind"]): string {
  if (kind === "reach_page") return "到达页面";
  if (kind === "invoke_capability") return "执行页面能力";
  if (kind === "run_page_task") return "执行页面任务";
  if (kind === "system_action") return "系统步骤";
  return "验证页面";
}

function metaStepKindHint(kind: MetaFunctionStep["kind"]): string {
  if (kind === "reach_page") return "规划路径并进入指定页面。";
  if (kind === "invoke_capability") return "定位页面元素，执行点击、输入或切换。";
  if (kind === "run_page_task") return "执行已录入的页面任务。";
  if (kind === "system_action") return "执行启动 App 等设备级动作。";
  return "确认当前状态与目标页面资产一致。";
}

function PageSelect({ value, catalog, onChange }: { value: string; catalog: CompositionCatalog; onChange: (value: string) => void }) { return <select value={value} onChange={(event) => onChange(event.target.value)}>{catalog.pages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>; }

function PlanView({ plan }: { plan: CompositePlan }) {
  const missingPrompt = missingParameterPrompt(plan);
  return <div className={`composition-plan ${plan.status}`}>
    <strong>{plan.status === "ready" ? `预检通过 · ${plan.steps.length} 个资产步骤` : plan.status === "needs_parameters" ? "需要补充参数" : "预检未通过"}</strong>
    {missingPrompt ? <span>{missingPrompt}</span> : null}
    {plan.status !== "needs_parameters" ? plan.issues.map((item) => <span key={`${item.code}-${item.message}`}>{item.code} · {item.message}</span>) : null}
  </div>;
}

function messageForCompositionPlan(plan: CompositePlan, label: string): string {
  if (plan.status === "ready") {
    return `${label}预检通过`;
  }
  return missingParameterPrompt(plan) ?? plan.issues[0]?.message ?? `${label}预检失败`;
}

function missingParameterPrompt(plan: CompositePlan): string | undefined {
  if (plan.status !== "needs_parameters") {
    return undefined;
  }
  const missing = [...new Set(plan.issues
    .filter((issue) => issue.code === "MISSING_REQUIRED_PARAMETER")
    .map((issue) => issue.assetId?.trim() ?? "")
    .filter(Boolean))]
    .sort();
  return missing.length ? `需要补充参数：${missing.join("、")}` : "需要补充参数";
}

function ExecutionView({ execution }: { execution: CompositeExecution }) { return <div className="composition-execution"><div className="panel-head"><strong>{execution.status} · {execution.completedItems}/{execution.totalItems}</strong><a href={`/api/asset-composition/executions/${encodeURIComponent(execution.id)}/report`} target="_blank" rel="noreferrer">打开报告</a></div>{execution.currentItem ? <p>当前：{execution.currentItem.metaFunctionName} · {execution.currentItem.kind}</p> : null}<div className="composition-execution-list">{execution.items.map((item) => <div key={item.id} className={item.status}><strong>{item.metaFunctionName}</strong><span>{item.kind} · {item.status}{item.error ? ` · ${item.error}` : ""}</span></div>)}</div></div>; }

function emptyData(): AssetCompositionInitialData { return { catalog: { graphVersionId: "", pages: [] }, dataRecords: [], profiles: [], metaFunctions: [], cases: [] }; }

function dataRecordDraftFrom(record: ParameterDataRecord | undefined, appId: string) { return { id: record?.id ?? "", appId, domainKey: record?.domainKey ?? "", name: record?.name ?? "", description: record?.description ?? "", environment: record?.environment ?? "", values: { ...(record?.values ?? {}) } }; }
function profileDraftFrom(profile: ParameterProfile | undefined, appId: string) { return { id: profile?.id ?? "", appId, name: profile?.name ?? "", environment: profile?.environment ?? "", bindings: [...(profile?.bindings ?? [])] as ParameterProfileBinding[], values: { ...(profile?.values ?? {}) } }; }
function domainLabel(domainKey: string, manifest?: ParameterManifest): string { return manifest?.groups.find((group) => group.key === domainKey)?.label ?? domainKey; }
function metaDraftFrom(meta: MetaFunction | undefined, appId: string) { return { id: meta?.id ?? "", appId, name: meta?.name ?? "", description: meta?.description ?? "", status: meta?.status ?? "draft" as MetaFunction["status"], parametersText: metaFunctionParametersToText(meta?.parameters ?? []), steps: meta?.steps ?? [] }; }
function caseDraftFrom(testCase: AssetCompositeCase | undefined, appId: string) { return { id: testCase?.id ?? "", appId, name: testCase?.name ?? "", description: testCase?.description ?? "", parameterProfileId: testCase?.parameterProfileId ?? "", runMode: testCase?.runMode ?? "once" as AssetCompositeCase["runMode"], repeatCount: testCase?.repeatCount ?? 1, stopOnFailure: testCase?.stopOnFailure ?? true, status: testCase?.status ?? "draft" as AssetCompositeCase["status"], steps: testCase?.steps ?? [] }; }

function newMetaStep(kind: MetaFunctionStep["kind"], order: number, catalog: CompositionCatalog): MetaFunctionStep { const page = catalog.pages[0]; const base = { id: `meta-step-${Date.now()}-${order}`, order, enabled: true }; if (kind === "system_action") return { ...base, kind, actionType: "launch_app" }; if (kind === "reach_page") return { ...base, kind, targetPageModelId: page?.id ?? "" }; if (kind === "verify_page") return { ...base, kind, pageModelId: page?.id ?? "" }; if (kind === "run_page_task") { const taskPage = catalog.pages.find((item) => item.tasks.length) ?? page; return { ...base, kind, pageModelId: taskPage?.id ?? "", pageTaskId: taskPage?.tasks[0]?.id ?? "" }; } const capabilityPage = catalog.pages.find((item) => item.elements.length) ?? page; const element = capabilityPage?.elements[0]; const transition = capabilityPage?.transitions.find((item) => item.elementId === element?.id); return { ...base, kind, sourcePageModelId: capabilityPage?.id ?? "", pageElementId: element?.id ?? "", targetPageModelId: transition?.targetPageModelId }; }
function newCaseStep(metaFunctionId: string, order: number): AssetCompositeCaseStep { return { id: `case-step-${Date.now()}-${order}`, order, metaFunctionId, enabled: true }; }

function replaceOrdered<T extends { order: number }>(items: T[], index: number, next: T): T[] { return items.map((item, itemIndex) => ({ ...(itemIndex === index ? next : item), order: itemIndex + 1 })); }
function removeOrdered<T extends { order: number }>(items: T[], index: number): T[] { return items.filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({ ...item, order: itemIndex + 1 })); }
function moveOrdered<T extends { order: number }>(items: T[], index: number, direction: -1 | 1): T[] { const target = index + direction; if (target < 0 || target >= items.length) return items; const next = [...items]; [next[index], next[target]] = [next[target]!, next[index]!]; return next.map((item, itemIndex) => ({ ...item, order: itemIndex + 1 })); }

export function parameterProfileValuesFromText(value: string): Record<string, AssetParameterValue> { const result: Record<string, AssetParameterValue> = {}; for (const rawLine of value.split(/\r?\n/)) { const line = rawLine.trim(); if (!line) continue; const separator = line.indexOf("="); if (separator < 1) continue; const descriptor = line.slice(0, separator).trim(); const rawValue = line.slice(separator + 1).trim(); const [key, rawType = "string"] = descriptor.split(":"); if (!key) continue; const type = rawType === "number" || rawType === "boolean" || rawType === "template" ? rawType : "string"; const parsedValue = type === "number" ? Number(rawValue) : type === "boolean" ? rawValue === "true" : rawValue; result[key.trim()] = { type, value: Number.isNaN(parsedValue) ? rawValue : parsedValue }; } return result; }
export function parameterProfileValuesToText(values: Record<string, AssetParameterValue>): string { return Object.entries(values).map(([key, entry]) => `${key}:${entry.type}=${String(entry.value)}`).join("\n"); }
function metaFunctionParametersFromText(value: string): MetaFunctionParameter[] { return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => { const [key, rawType = "string", required] = line.split(":"); const type = rawType === "number" || rawType === "boolean" || rawType === "template" ? rawType : "string"; return { key: key!.trim(), type, required: required === "required" }; }); }
function metaFunctionParametersToText(values: MetaFunctionParameter[]): string { return values.map((item) => `${item.key}:${item.type}${item.required ? ":required" : ""}`).join("\n"); }
