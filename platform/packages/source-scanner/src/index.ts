import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { ActionPolicy, GraphAssetSource, GraphTargetApp, PlatformScope, StateMatcher } from "@mobile-automation/graph-core";
import type { ActionStep, Platform } from "@mobile-automation/shared";
import { nowIso } from "@mobile-automation/shared";

export type SourceScanInput = {
  appId: string;
  targetApp?: GraphTargetApp;
  repoPath: string;
  platform: Platform;
  includePatterns?: string[];
  excludePatterns?: string[];
  maxFiles?: number;
};

export const defaultSourceScanMaxFiles = 20000;
export const maxSourceScanMaxFiles = 100000;

export type CandidateNode = {
  id: string;
  key: string;
  name: string;
  nodeType: "root" | "page" | "business_state" | "terminal";
  status: "draft";
  platformScope: PlatformScope;
  matchers: StateMatcher[];
  source: GraphAssetSource;
  confidence: number;
  metadata: Record<string, unknown>;
};

export type CandidateEdge = {
  id: string;
  key: string;
  name: string;
  intent: string;
  fromNodeKey?: string;
  toNodeKey?: string;
  status: "draft";
  platformScope: PlatformScope;
  source: GraphAssetSource;
  confidence: number;
  actionPolicies: ActionPolicy[];
  metadata: Record<string, unknown>;
};

export type SourceScanWarning = {
  code: "UNSUPPORTED_PLATFORM" | "REPO_NOT_FOUND" | "FILE_LIMIT_REACHED" | "PARSE_WARNING";
  message: string;
  filePath?: string;
  line?: number;
};

export type SourceScanResult = {
  appId: string;
  targetApp?: GraphTargetApp;
  platform: Platform;
  repoPath: string;
  scannedAt: string;
  summary: {
    scannedFiles: number;
    manifestFiles: number;
    navigationFiles: number;
    layoutFiles: number;
    stringFiles: number;
    sourceFiles: number;
  };
  nodes: CandidateNode[];
  edges: CandidateEdge[];
  warnings: SourceScanWarning[];
};

type ScanFile = {
  absolutePath: string;
  relativePath: string;
  kind: "manifest" | "navigation" | "layout" | "strings" | "source" | "other";
};

type MutableScanResult = Omit<SourceScanResult, "nodes" | "edges"> & {
  nodes: Map<string, CandidateNode>;
  edges: Map<string, CandidateEdge>;
};

export class AndroidSourceScanner {
  async scan(input: SourceScanInput): Promise<SourceScanResult> {
    if (input.platform !== "android") {
      return {
        appId: input.appId,
        targetApp: input.targetApp,
        platform: input.platform,
        repoPath: input.repoPath,
        scannedAt: nowIso(),
        summary: emptySummary(),
        nodes: [],
        edges: [],
        warnings: [
          {
            code: "UNSUPPORTED_PLATFORM",
            message: "Source scanner PoC currently supports Android only."
          }
        ]
      };
    }

    const repoPath = path.resolve(input.repoPath);
    const repoExists = await stat(repoPath)
      .then((item) => item.isDirectory())
      .catch(() => false);
    if (!repoExists) {
      return {
        appId: input.appId,
        targetApp: input.targetApp,
        platform: input.platform,
        repoPath,
        scannedAt: nowIso(),
        summary: emptySummary(),
        nodes: [],
        edges: [],
        warnings: [
          {
            code: "REPO_NOT_FOUND",
            message: `Repository path does not exist: ${repoPath}`
          }
        ]
      };
    }

    const maxFiles = normalizeMaxFiles(input.maxFiles);
    const files = await collectAndroidFiles(repoPath, { ...input, maxFiles });
    const result: MutableScanResult = {
      appId: input.appId,
      targetApp: input.targetApp,
      platform: "android",
      repoPath,
      scannedAt: nowIso(),
      summary: summarizeFiles(files),
      nodes: new Map(),
      edges: new Map(),
      warnings: []
    };

    if (files.length >= maxFiles) {
      result.warnings.push({
        code: "FILE_LIMIT_REACHED",
        message: `Stopped after scanning ${files.length} files because maxFiles=${maxFiles}.`
      });
    }

    const strings = await collectStringResources(files);
    for (const file of files) {
      const content = await readFile(file.absolutePath, "utf8").catch((error: unknown) => {
        result.warnings.push({
          code: "PARSE_WARNING",
          message: error instanceof Error ? error.message : String(error),
          filePath: file.relativePath
        });
        return "";
      });
      if (!content) {
        continue;
      }
      if (file.kind === "manifest") {
        scanManifest(file, content, strings, result);
      } else if (file.kind === "navigation") {
        scanNavigation(file, content, strings, result);
      } else if (file.kind === "layout") {
        scanLayout(file, content, strings, result);
      } else if (file.kind === "source") {
        scanSource(file, content, strings, result);
      }
    }

    return {
      ...result,
      nodes: Array.from(result.nodes.values()).sort((left, right) => right.confidence - left.confidence || left.key.localeCompare(right.key)),
      edges: Array.from(result.edges.values()).sort((left, right) => right.confidence - left.confidence || left.key.localeCompare(right.key))
    };
  }
}

export async function scanAndroidSource(input: SourceScanInput): Promise<SourceScanResult> {
  return new AndroidSourceScanner().scan(input);
}

async function collectAndroidFiles(root: string, input: SourceScanInput): Promise<ScanFile[]> {
  const files: ScanFile[] = [];
  const maxFiles = normalizeMaxFiles(input.maxFiles);
  const stack = [root];
  while (stack.length && files.length < maxFiles) {
    const dir = stack.pop();
    if (!dir) {
      continue;
    }
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = toPosix(path.relative(root, absolutePath));
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name, relativePath)) {
          stack.push(absolutePath);
        }
        continue;
      }
      if (!entry.isFile() || !isIncluded(relativePath, input)) {
        continue;
      }
      const kind = classifyFile(relativePath, entry.name);
      if (kind !== "other") {
        files.push({ absolutePath, relativePath, kind });
      }
      if (files.length >= maxFiles) {
        break;
      }
    }
  }
  return files;
}

function normalizeMaxFiles(value: number | undefined): number {
  return Math.min(Math.max(value ?? defaultSourceScanMaxFiles, 1), maxSourceScanMaxFiles);
}

async function collectStringResources(files: ScanFile[]): Promise<Map<string, string>> {
  const strings = new Map<string, string>();
  for (const file of files.filter((item) => item.kind === "strings")) {
    const content = await readFile(file.absolutePath, "utf8").catch(() => "");
    for (const match of content.matchAll(/<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) {
      const name = match[1]?.trim();
      const value = stripXmlTags(match[2] ?? "").trim();
      if (name && value) {
        strings.set(name, decodeXml(value));
      }
    }
  }
  return strings;
}

function scanManifest(file: ScanFile, content: string, strings: Map<string, string>, result: MutableScanResult): void {
  const packageName = content.match(/\bpackage="([^"]+)"/)?.[1];
  const activityPattern = /<activity\b([^>]*?)(?:\/>|>([\s\S]*?)<\/activity>)/g;
  for (const match of content.matchAll(activityPattern)) {
    const raw = match[0] ?? "";
    const attrs = parseXmlAttributes(match[1] ?? "");
    const body = match[2] ?? "";
    const rawName = attrs["android:name"] ?? attrs.name;
    if (!rawName) {
      continue;
    }
    const activityName = qualifyClassName(rawName, packageName);
    const launcher = body.includes("android.intent.action.MAIN") && body.includes("android.intent.category.LAUNCHER");
    const label = resolveAndroidValue(attrs["android:label"], strings);
    const line = lineNumber(content, match.index ?? 0);
    upsertNode(result.nodes, {
      id: stableId("node", `activity:${activityName}`),
      key: `activity:${activityName}`,
      name: label ?? shortClassName(activityName),
      nodeType: launcher ? "root" : "page",
      status: "draft",
      platformScope: "android",
      matchers: [
        packageName ? matcher("package", packageName, 2, file, line, 0.8) : undefined,
        matcher("activity", activityName, launcher ? 4 : 3, file, line, launcher ? 0.95 : 0.85),
        label ? matcher("text", label, 1, file, line, 0.55) : undefined
      ].filter(isDefined),
      source: source(file, line, launcher ? 0.95 : 0.85),
      confidence: launcher ? 0.95 : 0.82,
      metadata: {
        sourceType: "manifest_activity",
        launcher,
        packageName,
        activityName
      }
    });

    for (const deepLink of raw.matchAll(/<data\b([^>]+)>/g)) {
      const dataAttrs = parseXmlAttributes(deepLink[1] ?? "");
      const uri = buildDeepLink(dataAttrs);
      if (!uri) {
        continue;
      }
      upsertEdge(result.edges, edgeCandidate({
        key: `deeplink:${uri}->${activityName}`,
        name: `打开 ${uri}`,
        intent: `Open deeplink ${uri}`,
        toNodeKey: `activity:${activityName}`,
        sourceFile: file,
        line,
        confidence: 0.7,
        metadata: {
          sourceType: "manifest_deeplink",
          uri,
          activityName
        }
      }));
    }
  }
}

function scanNavigation(file: ScanFile, content: string, strings: Map<string, string>, result: MutableScanResult): void {
  const destinationPattern = /<(fragment|activity|composable|dialog)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  for (const match of content.matchAll(destinationPattern)) {
    const tag = match[1] ?? "fragment";
    const attrs = parseXmlAttributes(match[2] ?? "");
    const body = match[3] ?? "";
    const id = normalizeAndroidId(attrs["android:id"] ?? attrs.id);
    const className = attrs["android:name"] ?? attrs.name;
    const route = attrs["app:route"] ?? attrs.route;
    const label = resolveAndroidValue(attrs["android:label"], strings);
    const nodeKey = route ? `route:${route}` : className ? `${tag}:${className}` : id ? `navigation:${id}` : undefined;
    if (!nodeKey) {
      continue;
    }
    const line = lineNumber(content, match.index ?? 0);
    upsertNode(result.nodes, {
      id: stableId("node", nodeKey),
      key: nodeKey,
      name: label ?? route ?? shortClassName(className ?? id ?? nodeKey),
      nodeType: tag === "dialog" ? "business_state" : "page",
      status: "draft",
      platformScope: "android",
      matchers: [
        route ? matcher("route", route, 3, file, line, 0.8) : undefined,
        className ? matcher(tag === "activity" ? "activity" : "fragment", className, 3, file, line, 0.78) : undefined,
        id ? matcher("resource_id", id, 1, file, line, 0.55) : undefined,
        label ? matcher("text", label, 1, file, line, 0.55) : undefined
      ].filter(isDefined),
      source: source(file, line, 0.82),
      confidence: 0.82,
      metadata: {
        sourceType: "navigation_destination",
        tag,
        id,
        route,
        className
      }
    });

    for (const action of body.matchAll(/<action\b([^>]+)>/g)) {
      const actionAttrs = parseXmlAttributes(action[1] ?? "");
      const actionId = normalizeAndroidId(actionAttrs["android:id"] ?? actionAttrs.id) ?? actionAttrs["app:route"];
      const destination = normalizeAndroidId(actionAttrs["app:destination"] ?? actionAttrs.destination) ?? actionAttrs["app:route"];
      if (!destination) {
        continue;
      }
      upsertEdge(result.edges, edgeCandidate({
        key: `nav:${nodeKey}->${destination}:${actionId ?? "action"}`,
        name: actionId ? readableName(actionId) : `跳转到 ${destination}`,
        intent: `Navigate from ${nodeKey} to ${destination}`,
        fromNodeKey: nodeKey,
        toNodeKey: `navigation:${destination}`,
        sourceFile: file,
        line: lineNumber(content, action.index ?? match.index ?? 0),
        confidence: 0.78,
        metadata: {
          sourceType: "navigation_action",
          actionId,
          destination
        }
      }));
    }
  }
}

function scanLayout(file: ScanFile, content: string, strings: Map<string, string>, result: MutableScanResult): void {
  const screenName = layoutName(file.relativePath);
  const line = 1;
  const layoutNodeKey = `layout:${screenName}`;
  const texts = new Set<string>();
  const ids = new Set<string>();
  const elementPattern = /<([A-Za-z0-9_.]+)\b([^>]*?)(?:\/>|>)/g;
  for (const match of content.matchAll(elementPattern)) {
    const attrs = parseXmlAttributes(match[2] ?? "");
    const resourceId = normalizeAndroidId(attrs["android:id"] ?? attrs.id);
    const text = resolveAndroidValue(attrs["android:text"] ?? attrs.text, strings);
    const contentDescription = resolveAndroidValue(attrs["android:contentDescription"] ?? attrs.contentDescription, strings);
    if (resourceId) {
      ids.add(resourceId);
    }
    if (text) {
      texts.add(text);
    }
    if (contentDescription) {
      texts.add(contentDescription);
    }
    if (resourceId && isClickable(attrs, match[1] ?? "")) {
      upsertEdge(result.edges, edgeCandidate({
        key: `layout-click:${screenName}:${resourceId}`,
        name: text ?? contentDescription ?? readableName(resourceId),
        intent: `Click ${text ?? contentDescription ?? resourceId}`,
        fromNodeKey: layoutNodeKey,
        sourceFile: file,
        line: lineNumber(content, match.index ?? 0),
        confidence: 0.48,
        actionPolicies: [
          actionPolicy({
            id: stableId("action", `tap_on_element:${resourceId}`),
            type: "tap_on_element",
            params: {
              locator: {
                strategy: "android_uiautomator",
                resourceId
              }
            },
            sourceFile: file,
            line: lineNumber(content, match.index ?? 0),
            confidence: 0.6
          })
        ],
        metadata: {
          sourceType: "layout_clickable",
          resourceId,
          text,
          contentDescription
        }
      }));
    }
  }
  if (!ids.size && !texts.size) {
    return;
  }
  upsertNode(result.nodes, {
    id: stableId("node", layoutNodeKey),
    key: layoutNodeKey,
    name: readableName(screenName),
    nodeType: "page",
    status: "draft",
    platformScope: "android",
    matchers: [
      ...Array.from(ids)
        .slice(0, 8)
        .map((id) => matcher("resource_id", id, 1.5, file, line, 0.62)),
      ...Array.from(texts)
        .slice(0, 8)
        .map((text) => matcher("text", text, 1, file, line, 0.52))
    ],
    source: source(file, line, 0.58),
    confidence: 0.58,
    metadata: {
      sourceType: "layout_screen",
      layoutName: screenName,
      resourceIdCount: ids.size,
      textCount: texts.size
    }
  });
}

function scanSource(file: ScanFile, content: string, _strings: Map<string, string>, result: MutableScanResult): void {
  const className = findClassName(content);
  const packageName = content.match(/^\s*package\s+([A-Za-z0-9_.]+)/m)?.[1];
  const qualifiedClass = className && packageName ? `${packageName}.${className}` : className;
  if (qualifiedClass && /(Activity|Fragment|ViewController|Screen|Page)$/.test(className ?? "")) {
    const line = lineNumber(content, content.indexOf(className ?? ""));
    upsertNode(result.nodes, {
      id: stableId("node", `source:${qualifiedClass}`),
      key: `source:${qualifiedClass}`,
      name: readableName(className ?? qualifiedClass),
      nodeType: className?.endsWith("Activity") ? "page" : "business_state",
      status: "draft",
      platformScope: "android",
      matchers: [
        className?.endsWith("Activity") ? matcher("activity", qualifiedClass, 2.5, file, line, 0.72) : undefined,
        className?.endsWith("Fragment") ? matcher("fragment", qualifiedClass, 2.5, file, line, 0.7) : undefined
      ].filter(isDefined),
      source: source(file, line, 0.7),
      confidence: 0.7,
      metadata: {
        sourceType: "source_screen_class",
        className: qualifiedClass
      }
    });
  }

  scanSourceNavigations(file, content, result, qualifiedClass ? `source:${qualifiedClass}` : undefined);
}

function scanSourceNavigations(file: ScanFile, content: string, result: MutableScanResult, fromNodeKey: string | undefined): void {
  const patterns: Array<{ sourceType: string; regex: RegExp; toNode: (match: RegExpMatchArray) => string | undefined; name: (match: RegExpMatchArray) => string }> = [
    {
      sourceType: "source_start_activity",
      regex: /startActivity\s*\([^)]*Intent\s*\([^)]*([A-Z][A-Za-z0-9_]+Activity)::class\.java/g,
      toNode: (match) => `source:${match[1]}`,
      name: (match) => `打开 ${match[1]}`
    },
    {
      sourceType: "source_nav_controller",
      regex: /\.navigate\s*\(\s*["']([^"']+)["']/g,
      toNode: (match) => `route:${match[1]}`,
      name: (match) => `跳转到 ${match[1]}`
    },
    {
      sourceType: "source_nav_resource",
      regex: /\.navigate\s*\(\s*R\.id\.([A-Za-z0-9_]+)/g,
      toNode: (match) => `navigation:${match[1]}`,
      name: (match) => `跳转到 ${readableName(match[1] ?? "")}`
    }
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern.regex)) {
      const toNodeKey = pattern.toNode(match);
      if (!toNodeKey) {
        continue;
      }
      const line = lineNumber(content, match.index ?? 0);
      upsertEdge(result.edges, edgeCandidate({
        key: `${pattern.sourceType}:${fromNodeKey ?? file.relativePath}->${toNodeKey}:${line}`,
        name: pattern.name(match),
        intent: pattern.name(match),
        fromNodeKey,
        toNodeKey,
        sourceFile: file,
        line,
        confidence: 0.66,
        metadata: {
          sourceType: pattern.sourceType,
          expression: match[0]
        }
      }));
    }
  }

  for (const match of content.matchAll(/setOnClickListener|onClick\s*[={\(]/g)) {
    const line = lineNumber(content, match.index ?? 0);
    upsertEdge(result.edges, edgeCandidate({
      key: `source-click:${fromNodeKey ?? file.relativePath}:${line}`,
      name: "点击事件",
      intent: "Click handler",
      fromNodeKey,
      sourceFile: file,
      line,
      confidence: 0.42,
      metadata: {
        sourceType: "source_click_handler",
        expression: match[0]
      }
    }));
  }
}

function edgeCandidate(input: {
  key: string;
  name: string;
  intent: string;
  fromNodeKey?: string;
  toNodeKey?: string;
  sourceFile: ScanFile;
  line: number;
  confidence: number;
  actionPolicies?: ActionPolicy[];
  metadata: Record<string, unknown>;
}): CandidateEdge {
  return {
    id: stableId("edge", input.key),
    key: input.key,
    name: input.name,
    intent: input.intent,
    fromNodeKey: input.fromNodeKey,
    toNodeKey: input.toNodeKey,
    status: "draft",
    platformScope: "android",
    source: source(input.sourceFile, input.line, input.confidence),
    confidence: input.confidence,
    actionPolicies: input.actionPolicies ?? [],
    metadata: input.metadata
  };
}

function actionPolicy(input: {
  id: string;
  type: ActionStep["type"];
  params: Record<string, unknown>;
  sourceFile: ScanFile;
  line: number;
  confidence: number;
}): ActionPolicy {
  return {
    id: input.id,
    priority: 1,
    fallback: false,
    reliabilityHint: "medium",
    source: source(input.sourceFile, input.line, input.confidence),
    action: {
      id: input.id,
      order: 1,
      type: input.type,
      enabled: true,
      params: input.params,
      createdAt: nowIso()
    }
  };
}

function upsertNode(nodes: Map<string, CandidateNode>, next: CandidateNode): void {
  const existing = nodes.get(next.key);
  if (!existing) {
    nodes.set(next.key, next);
    return;
  }
  nodes.set(next.key, {
    ...existing,
    confidence: Math.max(existing.confidence, next.confidence),
    matchers: mergeMatchers(existing.matchers, next.matchers),
    metadata: {
      ...existing.metadata,
      ...next.metadata
    }
  });
}

function upsertEdge(edges: Map<string, CandidateEdge>, edge: CandidateEdge): void {
  const existing = edges.get(edge.key);
  if (!existing || edge.confidence > existing.confidence) {
    edges.set(edge.key, edge);
  }
}

function mergeMatchers(left: StateMatcher[], right: StateMatcher[]): StateMatcher[] {
  const merged = new Map<string, StateMatcher>();
  for (const matcher of [...left, ...right]) {
    const key = `${matcher.type}:${matcher.value}`;
    const existing = merged.get(key);
    if (!existing || matcher.weight > existing.weight) {
      merged.set(key, matcher);
    }
  }
  return Array.from(merged.values());
}

function matcher(type: StateMatcher["type"], value: string, weight: number, file: ScanFile, line: number, confidence: number): StateMatcher {
  return {
    id: stableId("matcher", `${type}:${value}`),
    type,
    value,
    weight,
    source: source(file, line, confidence)
  };
}

function source(file: ScanFile, line: number, confidence: number): GraphAssetSource {
  return {
    sourceType: "source_scan",
    filePath: file.relativePath,
    line,
    confidence
  };
}

function classifyFile(relativePath: string, fileName: string): ScanFile["kind"] {
  if (fileName === "AndroidManifest.xml") {
    return "manifest";
  }
  if (/res\/navigation\/.*\.xml$/.test(relativePath)) {
    return "navigation";
  }
  if (/res\/layout.*\/.*\.xml$/.test(relativePath)) {
    return "layout";
  }
  if (/res\/values.*\/strings.*\.xml$/.test(relativePath)) {
    return "strings";
  }
  if (/\.(kt|java)$/.test(relativePath)) {
    return "source";
  }
  return "other";
}

function summarizeFiles(files: ScanFile[]): SourceScanResult["summary"] {
  return {
    scannedFiles: files.length,
    manifestFiles: files.filter((file) => file.kind === "manifest").length,
    navigationFiles: files.filter((file) => file.kind === "navigation").length,
    layoutFiles: files.filter((file) => file.kind === "layout").length,
    stringFiles: files.filter((file) => file.kind === "strings").length,
    sourceFiles: files.filter((file) => file.kind === "source").length
  };
}

function emptySummary(): SourceScanResult["summary"] {
  return {
    scannedFiles: 0,
    manifestFiles: 0,
    navigationFiles: 0,
    layoutFiles: 0,
    stringFiles: 0,
    sourceFiles: 0
  };
}

function shouldSkipDirectory(name: string, relativePath: string): boolean {
  return (
    name === ".git" ||
    name === ".gradle" ||
    name === "build" ||
    name === "node_modules" ||
    relativePath.includes("/build/") ||
    relativePath.includes("/.gradle/")
  );
}

function isIncluded(relativePath: string, input: SourceScanInput): boolean {
  if (input.excludePatterns?.some((pattern) => globLikeMatch(relativePath, pattern))) {
    return false;
  }
  if (!input.includePatterns?.length) {
    return true;
  }
  return input.includePatterns.some((pattern) => globLikeMatch(relativePath, pattern));
}

function globLikeMatch(value: string, pattern: string): boolean {
  const normalized = toPosix(pattern);
  if (normalized === value) {
    return true;
  }
  if (normalized.endsWith("/**")) {
    return value.startsWith(normalized.slice(0, -3));
  }
  if (normalized.startsWith("**/")) {
    return value.endsWith(normalized.slice(3));
  }
  if (normalized.includes("*")) {
    const regex = new RegExp(`^${normalized.split("*").map(escapeRegExp).join(".*")}$`);
    return regex.test(value);
  }
  return value.includes(normalized);
}

function parseXmlAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([A-Za-z0-9_:.:-]+)="([^"]*)"/g)) {
    if (match[1]) {
      attrs[match[1]] = decodeXml(match[2] ?? "");
    }
  }
  return attrs;
}

function resolveAndroidValue(value: string | undefined, strings: Map<string, string>): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.startsWith("@string/")) {
    return strings.get(value.slice("@string/".length));
  }
  if (value.startsWith("@")) {
    return undefined;
  }
  return decodeXml(value);
}

function normalizeAndroidId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.replace(/^@\+?id\//, "").replace(/^@android:id\//, "android:");
}

function qualifyClassName(value: string, packageName: string | undefined): string {
  if (value.startsWith(".") && packageName) {
    return `${packageName}${value}`;
  }
  if (!value.includes(".") && packageName) {
    return `${packageName}.${value}`;
  }
  return value;
}

function buildDeepLink(attrs: Record<string, string>): string | undefined {
  const scheme = attrs["android:scheme"];
  const host = attrs["android:host"];
  const pathValue = attrs["android:path"] ?? attrs["android:pathPrefix"] ?? attrs["android:pathPattern"];
  if (!scheme) {
    return undefined;
  }
  return `${scheme}://${host ?? ""}${pathValue ?? ""}`;
}

function isClickable(attrs: Record<string, string>, tag: string): boolean {
  return attrs["android:onClick"] !== undefined || attrs["android:clickable"] === "true" || /(Button|TextView|ImageView|ImageButton|MaterialButton)$/.test(tag);
}

function findClassName(content: string): string | undefined {
  return content.match(/\bclass\s+([A-Za-z0-9_]+)/)?.[1] ?? content.match(/\bobject\s+([A-Za-z0-9_]+)/)?.[1];
}

function layoutName(relativePath: string): string {
  return path.basename(relativePath, ".xml");
}

function shortClassName(value: string): string {
  const normalized = value.split(".").filter(Boolean).at(-1) ?? value;
  return readableName(normalized);
}

function readableName(value: string): string {
  return value
    .replace(/^android:/, "")
    .replace(/^id\//, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
}

function stripXmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function lineNumber(content: string, index: number): number {
  return content.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function stableId(prefix: string, key: string): string {
  return `${prefix}_${sanitizeId(key)}_${createHash("sha1").update(key).digest("hex").slice(0, 8)}`;
}

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
