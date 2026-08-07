import {
  AGENT_PROTOCOL_VERSION,
  type AgentCommandEnvelope,
  type AgentCommandName,
  type AgentCommandResultEnvelope,
  type AgentDeviceInfo,
  type AgentDeviceVisibility,
  type AgentSession,
  type DeviceCapabilities,
  type DeviceLease,
  type DeviceLeaseType,
  type DeviceSession,
  type DeviceStatus,
  type Platform,
  type ToolStatus
} from "@mobile-automation/shared";

export type ServerAgentDeviceRegistration = {
  serial?: unknown;
  platform?: unknown;
  name?: unknown;
  model?: unknown;
  manufacturer?: unknown;
  osVersion?: unknown;
  resolution?: unknown;
  orientation?: unknown;
  status?: unknown;
  capabilities?: unknown;
  shared?: unknown;
};

export type ServerAgentRegistrationInput = {
  agentId?: unknown;
  version?: unknown;
  shared?: unknown;
  toolStatus?: unknown;
  maxConcurrentRuns?: unknown;
  currentRunCount?: unknown;
  devices?: unknown;
  pairingCode?: unknown;
};

export type ServerAgentHeartbeatInput = Omit<ServerAgentRegistrationInput, "agentId" | "version" | "pairingCode"> & {
  version?: unknown;
};

export type PairingCode = {
  code: string;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  paired: boolean;
  pairedAgentId?: string;
};

export type ServerAgentRegistryOptions = {
  now?: () => string;
  requestIdGenerator?: () => string;
  leaseIdGenerator?: () => string;
  pairingCodeGenerator?: () => string;
  commandTimeoutMs?: number;
};

type PendingCommand = {
  agentId: string;
  deviceKey: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: AgentCommandResultEnvelope) => void;
  reject: (error: Error) => void;
};

type AgentCommandSubscriber = () => void;

type RegisteredDeviceLease = DeviceLease & {
  deviceKey: string;
};

export type AcquireDeviceLeaseInput = {
  deviceKey?: unknown;
  type?: unknown;
  ownerId?: unknown;
  ttlMs?: unknown;
  runId?: unknown;
};

export type ReleaseDeviceLeaseInput = {
  deviceKey?: unknown;
  leaseId?: unknown;
  ownerId?: unknown;
};

export class ServerAgentRegistry {
  private readonly agents = new Map<string, AgentSession>();
  private readonly devices = new Map<string, DeviceSession>();
  private readonly commandQueues = new Map<string, Map<string, AgentCommandEnvelope[]>>();
  private readonly pendingCommands = new Map<string, PendingCommand>();
  private readonly commandSubscribers = new Map<string, Set<AgentCommandSubscriber>>();
  private readonly pairingCodes = new Map<string, PairingCode>();
  private readonly deviceLeases = new Map<string, RegisteredDeviceLease>();

  constructor(private readonly options: ServerAgentRegistryOptions = {}) {}

  registerAgent(input: ServerAgentRegistrationInput): { agent: AgentSession; devices: DeviceSession[] } {
    const now = this.now();
    const agentId = requiredTrimmedString(input.agentId, "agentId");
    const previous = this.agents.get(agentId);
    const pairingCode = optionalTrimmedString(input.pairingCode);
    const pairedSessionId = pairingCode
      ? this.consumePairingCode(pairingCode, agentId)
      : previous?.pairedSessionId;
    const agent: AgentSession = {
      agentId,
      ...(optionalTrimmedString(input.version) ? { version: optionalTrimmedString(input.version) } : previous?.version ? { version: previous.version } : {}),
      status: "online",
      connectedAt: previous?.connectedAt ?? now,
      lastHeartbeatAt: now,
      shared: booleanValue(input.shared, previous?.shared ?? false),
      toolStatus: toolStatusList(input.toolStatus, previous?.toolStatus ?? []),
      maxConcurrentRuns: positiveInteger(input.maxConcurrentRuns, previous?.maxConcurrentRuns ?? 1),
      currentRunCount: nonNegativeInteger(input.currentRunCount, previous?.currentRunCount ?? 0),
      ...(pairedSessionId ? { pairedSessionId } : {})
    };
    this.agents.set(agentId, agent);
    const devices = this.replaceDeviceSnapshot(agent, deviceRegistrations(input.devices));
    return { agent, devices };
  }

  heartbeat(agentIdValue: unknown, input: ServerAgentHeartbeatInput = {}): { agent: AgentSession; devices: DeviceSession[] } {
    const agentId = requiredTrimmedString(agentIdValue, "agentId");
    const previous = this.agents.get(agentId);
    if (!previous) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    const agent: AgentSession = {
      ...previous,
      ...(optionalTrimmedString(input.version) ? { version: optionalTrimmedString(input.version) } : {}),
      status: "online",
      lastHeartbeatAt: this.now(),
      shared: booleanValue(input.shared, previous.shared),
      toolStatus: toolStatusList(input.toolStatus, previous.toolStatus),
      maxConcurrentRuns: positiveInteger(input.maxConcurrentRuns, previous.maxConcurrentRuns),
      currentRunCount: nonNegativeInteger(input.currentRunCount, previous.currentRunCount)
    };
    this.agents.set(agentId, agent);
    const devices = Array.isArray(input.devices)
      ? this.replaceDeviceSnapshot(agent, deviceRegistrations(input.devices))
      : this.listDeviceSessions({ agentId });
    return { agent, devices };
  }

  listAgents(): AgentSession[] {
    return Array.from(this.agents.values(), (agent) => ({ ...agent, toolStatus: agent.toolStatus.map((tool) => ({ ...tool })) }));
  }

  listDeviceSessions(filter: { agentId?: string; includeOffline?: boolean } = {}): DeviceSession[] {
    this.cleanupExpiredLeases();
    return Array.from(this.devices.values())
      .filter((device) => !filter.agentId || device.agentId === filter.agentId)
      .filter((device) => filter.includeOffline || this.effectiveDeviceStatus(device) !== "offline")
      .map((device) => this.cloneDeviceSession(device));
  }

  listVisibleDevices(options: { sessionId?: string; includeOffline?: boolean } = {}): AgentDeviceInfo[] {
    this.cleanupExpiredLeases();
    const sessionId = options.sessionId?.trim();
    return Array.from(this.devices.values()).flatMap((device) => {
      const status = this.effectiveDeviceStatus(device);
      if (!options.includeOffline && status === "offline") {
        return [];
      }
      const visibility = visibleAs(device, sessionId);
      if (!visibility) {
        return [];
      }
      return [this.toDeviceInfo({ ...device, status }, visibility)];
    });
  }

  getDeviceSession(deviceKey: string): DeviceSession | undefined {
    this.cleanupExpiredLeases();
    const device = this.devices.get(deviceKey);
    return device ? this.cloneDeviceSession(device) : undefined;
  }

  hasDevice(deviceKey: string): boolean {
    return this.devices.has(deviceKey);
  }

  markAgentOffline(agentIdValue: unknown): AgentSession | undefined {
    const agentId = requiredTrimmedString(agentIdValue, "agentId");
    const agent = this.agents.get(agentId);
    if (!agent) {
      return undefined;
    }
    const offline = { ...agent, status: "offline" as const, lastHeartbeatAt: this.now() };
    this.agents.set(agentId, offline);
    for (const [deviceKey, device] of this.devices) {
      if (device.agentId === agentId) {
        this.devices.set(deviceKey, { ...device, status: "offline", lastSeenAt: this.now() });
        this.clearLeasesForDevice(deviceKey);
      }
    }
    this.commandQueues.delete(agentId);
    this.rejectPendingCommandsForAgent(agentId, `Agent went offline: ${agentId}`);
    return offline;
  }

  createPairingCode(input: { sessionId?: unknown; ttlMs?: unknown }): PairingCode {
    const now = this.now();
    const ttlMs = positiveInteger(input.ttlMs, 5 * 60_000);
    const code = this.nextPairingCode();
    const pairing: PairingCode = {
      code,
      sessionId: requiredTrimmedString(input.sessionId, "sessionId"),
      createdAt: now,
      expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
      paired: false
    };
    this.pairingCodes.set(code, pairing);
    return { ...pairing };
  }

  listPairingCodes(): PairingCode[] {
    return Array.from(this.pairingCodes.values(), (pairing) => ({ ...pairing }));
  }

  acquireDeviceLease(input: AcquireDeviceLeaseInput): DeviceLease {
    this.cleanupExpiredLeases();
    const deviceKey = requiredTrimmedString(input.deviceKey, "deviceKey");
    const device = this.devices.get(deviceKey);
    if (!device) {
      throw new Error(`Agent device not found: ${deviceKey}`);
    }
    if (this.effectiveDeviceStatus(device) === "offline") {
      throw new Error(`Agent device is offline: ${deviceKey}`);
    }
    const type = deviceLeaseType(input.type);
    const ownerId = requiredTrimmedString(input.ownerId, "ownerId");
    const conflicting = type === "readonly_preview" ? undefined : this.currentRegisteredWriteLeaseForDevice(deviceKey);
    const now = this.now();
    const ttlMs = positiveInteger(input.ttlMs, 5 * 60_000);
    if (conflicting && conflicting.ownerId === ownerId && conflicting.type === type) {
      const renewed: RegisteredDeviceLease = {
        ...conflicting,
        renewedAt: now,
        expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
        ...(optionalTrimmedString(input.runId) ? { runId: optionalTrimmedString(input.runId) } : conflicting.runId ? { runId: conflicting.runId } : {})
      };
      this.deviceLeases.set(renewed.id, renewed);
      this.devices.set(deviceKey, { ...device, currentLease: cloneLease(renewed) });
      return cloneLease(renewed);
    }
    if (conflicting) {
      throw new Error(`Device ${deviceKey} is already leased by ${conflicting.ownerId}`);
    }
    const lease: RegisteredDeviceLease = {
      id: this.nextLeaseId(),
      deviceKey,
      type,
      ownerId,
      acquiredAt: now,
      renewedAt: now,
      expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
      ...(optionalTrimmedString(input.runId) ? { runId: optionalTrimmedString(input.runId) } : {})
    };
    this.deviceLeases.set(lease.id, lease);
    if (type !== "readonly_preview") {
      this.devices.set(deviceKey, { ...device, currentLease: cloneLease(lease) });
    }
    return cloneLease(lease);
  }

  releaseDeviceLease(input: ReleaseDeviceLeaseInput): boolean {
    this.cleanupExpiredLeases();
    const deviceKey = requiredTrimmedString(input.deviceKey, "deviceKey");
    const leaseId = requiredTrimmedString(input.leaseId, "leaseId");
    const ownerId = requiredTrimmedString(input.ownerId, "ownerId");
    const lease = this.deviceLeases.get(leaseId);
    if (!lease || lease.deviceKey !== deviceKey || lease.ownerId !== ownerId) {
      return false;
    }
    this.removeLease(leaseId);
    return true;
  }

  listDeviceLeases(deviceKeyValue?: unknown): DeviceLease[] {
    this.cleanupExpiredLeases();
    const deviceKey = optionalTrimmedString(deviceKeyValue);
    return [...this.deviceLeases.values()]
      .filter((lease) => !deviceKey || lease.deviceKey === deviceKey)
      .map(cloneLease);
  }

  sendCommand(deviceKey: string, command: AgentCommandName, payload?: Record<string, unknown>): Promise<AgentCommandResultEnvelope> {
    const device = this.devices.get(deviceKey);
    if (!device) {
      return Promise.reject(new Error(`Agent device not found: ${deviceKey}`));
    }
    const agent = this.agents.get(device.agentId);
    if (!agent || agent.status === "offline") {
      return Promise.reject(new Error(`Agent is offline: ${device.agentId}`));
    }
    if (this.effectiveDeviceStatus(device) === "offline") {
      return Promise.reject(new Error(`Agent device is offline: ${deviceKey}`));
    }

    const requestId = this.nextRequestId();
    const envelope: AgentCommandEnvelope = {
      type: "command",
      protocolVersion: AGENT_PROTOCOL_VERSION,
      requestId,
      agentId: device.agentId,
      deviceKey,
      platform: device.platform,
      timestamp: this.now(),
      command,
      ...(payload && Object.keys(payload).length > 0 ? { payload } : {})
    };
    return new Promise<AgentCommandResultEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`Agent command timed out: ${requestId}`));
      }, this.options.commandTimeoutMs ?? 30_000);
      this.pendingCommands.set(requestId, { agentId: device.agentId, deviceKey, timer, resolve, reject });
      this.enqueueCommand(envelope);
    });
  }

  subscribeAgentCommands(agentIdValue: unknown, subscriber: AgentCommandSubscriber): () => void {
    const agentId = requiredTrimmedString(agentIdValue, "agentId");
    const subscribers = this.commandSubscribers.get(agentId) ?? new Set<AgentCommandSubscriber>();
    subscribers.add(subscriber);
    this.commandSubscribers.set(agentId, subscribers);
    return () => {
      subscribers.delete(subscriber);
      if (!subscribers.size) {
        this.commandSubscribers.delete(agentId);
      }
    };
  }

  takePendingCommands(agentIdValue: unknown, limitValue: unknown = 20): AgentCommandEnvelope[] {
    const agentId = requiredTrimmedString(agentIdValue, "agentId");
    const limit = positiveInteger(limitValue, 20);
    const deviceQueues = this.commandQueues.get(agentId);
    if (!deviceQueues) {
      return [];
    }
    for (const queue of deviceQueues.values()) {
      queue.sort((left, right) => agentCommandPriority(right) - agentCommandPriority(left));
    }
    const commands: AgentCommandEnvelope[] = [];
    while (commands.length < limit && deviceQueues.size > 0) {
      let tookCommand = false;
      for (const [deviceKey, queue] of [...deviceQueues]) {
        const command = queue.shift();
        if (!command) {
          deviceQueues.delete(deviceKey);
          continue;
        }
        commands.push(command);
        tookCommand = true;
        if (!queue.length) {
          deviceQueues.delete(deviceKey);
        }
        if (commands.length >= limit) {
          break;
        }
      }
      if (!tookCommand) {
        break;
      }
    }
    if (!deviceQueues.size) {
      this.commandQueues.delete(agentId);
    }
    return commands;
  }

  completeCommand(agentIdValue: unknown, requestIdValue: unknown, input: AgentCommandResultEnvelope): AgentCommandResultEnvelope {
    const agentId = requiredTrimmedString(agentIdValue, "agentId");
    const requestId = requiredTrimmedString(requestIdValue, "requestId");
    const pending = this.pendingCommands.get(requestId);
    if (!pending) {
      throw new Error(`Pending command not found: ${requestId}`);
    }
    if (pending.agentId !== agentId) {
      throw new Error(`Pending command ${requestId} does not belong to agent ${agentId}`);
    }
    this.pendingCommands.delete(requestId);
    clearTimeout(pending.timer);
    const device = this.devices.get(pending.deviceKey);
    const result: AgentCommandResultEnvelope = {
      ...input,
      type: "command_result",
      protocolVersion: AGENT_PROTOCOL_VERSION,
      requestId,
      agentId,
      deviceKey: pending.deviceKey,
      platform: device?.platform,
      timestamp: this.now()
    };
    if (result.ok) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(result.error || `Agent command failed: ${requestId}`));
    }
    return result;
  }

  deviceInfoForKey(deviceKey: string, visibility: AgentDeviceVisibility = "public"): AgentDeviceInfo | undefined {
    const device = this.devices.get(deviceKey);
    return device ? this.toDeviceInfo({ ...device, status: this.effectiveDeviceStatus(device) }, visibility) : undefined;
  }

  private replaceDeviceSnapshot(agent: AgentSession, devices: ServerAgentDeviceRegistration[]): DeviceSession[] {
    this.cleanupExpiredLeases();
    const now = this.now();
    const seen = new Set<string>();
    const updated = devices.map((input) => {
      const device = normalizeDeviceRegistration(agent, input, now);
      const activeLease = this.currentWriteLeaseForDevice(device.deviceKey);
      const nextDevice = activeLease ? { ...device, currentLease: activeLease } : device;
      this.devices.set(device.deviceKey, nextDevice);
      seen.add(device.deviceKey);
      return nextDevice;
    });
    for (const [deviceKey, previous] of this.devices) {
      if (previous.agentId === agent.agentId && !seen.has(deviceKey)) {
        this.devices.set(deviceKey, { ...previous, status: "offline", lastSeenAt: now });
        this.clearLeasesForDevice(deviceKey);
      }
    }
    return updated.map((device) => this.cloneDeviceSession(device));
  }

  private enqueueCommand(command: AgentCommandEnvelope): void {
    const agentQueues = this.commandQueues.get(command.agentId) ?? new Map<string, AgentCommandEnvelope[]>();
    const deviceQueue = agentQueues.get(command.deviceKey) ?? [];
    deviceQueue.push(command);
    agentQueues.set(command.deviceKey, deviceQueue);
    this.commandQueues.set(command.agentId, agentQueues);
    this.notifyAgentCommandSubscribers(command.agentId);
  }

  private notifyAgentCommandSubscribers(agentId: string): void {
    for (const subscriber of this.commandSubscribers.get(agentId) ?? []) {
      subscriber();
    }
  }

  private rejectPendingCommandsForAgent(agentId: string, message: string): void {
    for (const [requestId, pending] of [...this.pendingCommands]) {
      if (pending.agentId !== agentId) {
        continue;
      }
      this.pendingCommands.delete(requestId);
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
  }

  private currentWriteLeaseForDevice(deviceKey: string): DeviceLease | undefined {
    const lease = this.currentRegisteredWriteLeaseForDevice(deviceKey);
    return lease ? cloneLease(lease) : undefined;
  }

  private currentRegisteredWriteLeaseForDevice(deviceKey: string): RegisteredDeviceLease | undefined {
    return [...this.deviceLeases.values()].find((item) => item.deviceKey === deviceKey && item.type !== "readonly_preview");
  }

  private cleanupExpiredLeases(): void {
    const nowMs = Date.parse(this.now());
    for (const lease of [...this.deviceLeases.values()]) {
      if (Date.parse(lease.expiresAt) <= nowMs) {
        this.removeLease(lease.id);
      }
    }
  }

  private clearLeasesForDevice(deviceKey: string): void {
    for (const lease of [...this.deviceLeases.values()]) {
      if (lease.deviceKey === deviceKey) {
        this.removeLease(lease.id);
      }
    }
  }

  private removeLease(leaseId: string): void {
    const lease = this.deviceLeases.get(leaseId);
    if (!lease) {
      return;
    }
    this.deviceLeases.delete(leaseId);
    const device = this.devices.get(lease.deviceKey);
    if (device?.currentLease?.id === leaseId) {
      const nextLease = this.currentWriteLeaseForDevice(lease.deviceKey);
      const { currentLease: _currentLease, ...deviceWithoutLease } = device;
      this.devices.set(lease.deviceKey, nextLease ? { ...deviceWithoutLease, currentLease: nextLease } : deviceWithoutLease);
    }
  }

  private consumePairingCode(code: string, agentId: string): string {
    const pairing = this.pairingCodes.get(code);
    if (!pairing || Date.parse(pairing.expiresAt) <= Date.parse(this.now())) {
      throw new Error("Pairing code is invalid or expired");
    }
    if (pairing.pairedAgentId && pairing.pairedAgentId !== agentId) {
      throw new Error("Pairing code is already used");
    }
    const paired = { ...pairing, paired: true, pairedAgentId: agentId };
    this.pairingCodes.set(code, paired);
    return paired.sessionId;
  }

  private effectiveDeviceStatus(device: DeviceSession): DeviceStatus {
    const agent = this.agents.get(device.agentId);
    if (!agent || agent.status === "offline") {
      return "offline";
    }
    return device.status;
  }

  private toDeviceInfo(device: DeviceSession, visibility: AgentDeviceVisibility): AgentDeviceInfo {
    return {
      id: device.deviceKey,
      serial: device.deviceKey,
      platform: device.platform,
      ...(device.name ? { name: device.name } : {}),
      ...(device.model ? { model: device.model } : {}),
      ...(device.manufacturer ? { manufacturer: device.manufacturer } : {}),
      ...(device.osVersion ? { osVersion: device.osVersion } : {}),
      ...(device.resolution ? { resolution: { ...device.resolution } } : {}),
      ...(device.orientation ? { orientation: device.orientation } : {}),
      status: device.status,
      capabilities: cloneCapabilities(device.capabilities),
      lastSeenAt: device.lastSeenAt,
      ...(device.currentLease ? { currentLease: cloneLease(device.currentLease) } : {}),
      agent: {
        agentId: device.agentId,
        deviceKey: device.deviceKey,
        serial: device.serial,
        shared: device.shared,
        visibility
      }
    };
  }

  private cloneDeviceSession(device: DeviceSession): DeviceSession {
    return {
      ...device,
      ...(device.resolution ? { resolution: { ...device.resolution } } : {}),
      capabilities: cloneCapabilities(device.capabilities),
      ...(device.currentLease ? { currentLease: { ...device.currentLease } } : {})
    };
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  private nextRequestId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const requestId = this.options.requestIdGenerator?.() ?? `agent_request_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      if (!this.pendingCommands.has(requestId)) {
        return requestId;
      }
    }
    throw new Error("Unable to generate a unique agent requestId");
  }

  private nextLeaseId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const leaseId = this.options.leaseIdGenerator?.() ?? `lease_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      if (!this.deviceLeases.has(leaseId)) {
        return leaseId;
      }
    }
    throw new Error("Unable to generate a unique lease id");
  }

  private nextPairingCode(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = this.options.pairingCodeGenerator?.() ?? randomPairingCode();
      if (!this.pairingCodes.has(code)) {
        return code;
      }
    }
    throw new Error("Unable to generate a unique pairing code");
  }
}

function normalizeDeviceRegistration(agent: AgentSession, input: ServerAgentDeviceRegistration, now: string): DeviceSession {
  const serial = requiredTrimmedString(input.serial, "device.serial");
  const platform = platformValue(input.platform);
  const shared = booleanValue(input.shared, agent.shared);
  return {
    deviceKey: `${agent.agentId}:${platform}:${serial}`,
    agentId: agent.agentId,
    serial,
    platform,
    ...(optionalTrimmedString(input.name) ? { name: optionalTrimmedString(input.name) } : {}),
    ...(optionalTrimmedString(input.model) ? { model: optionalTrimmedString(input.model) } : {}),
    ...(optionalTrimmedString(input.manufacturer) ? { manufacturer: optionalTrimmedString(input.manufacturer) } : {}),
    ...(optionalTrimmedString(input.osVersion) ? { osVersion: optionalTrimmedString(input.osVersion) } : {}),
    ...(resolutionValue(input.resolution) ? { resolution: resolutionValue(input.resolution) } : {}),
    ...(orientationValue(input.orientation) ? { orientation: orientationValue(input.orientation) } : {}),
    status: deviceStatusValue(input.status),
    capabilities: capabilitiesValue(input.capabilities),
    shared,
    ...(agent.pairedSessionId && !shared ? { pairedSessionId: agent.pairedSessionId } : {}),
    lastSeenAt: now
  };
}

function visibleAs(device: DeviceSession, sessionId: string | undefined): AgentDeviceVisibility | undefined {
  if (device.shared) {
    return "public";
  }
  return sessionId && device.pairedSessionId === sessionId ? "paired" : undefined;
}

function cloneLease(lease: DeviceLease): DeviceLease {
  return { ...lease };
}

function deviceLeaseType(value: unknown): DeviceLeaseType {
  if (value === "readonly_preview" || value === "manual_control" || value === "automation_run" || value === "maintenance") {
    return value;
  }
  throw new Error("lease type must be readonly_preview, manual_control, automation_run, or maintenance");
}

function deviceRegistrations(value: unknown): ServerAgentDeviceRegistration[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("devices must be an array");
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error("devices must contain objects");
    }
    return item as ServerAgentDeviceRegistration;
  });
}

function toolStatusList(value: unknown, fallback: ToolStatus[]): ToolStatus[] {
  if (value === undefined) {
    return fallback.map((tool) => ({ ...tool }));
  }
  if (!Array.isArray(value)) {
    throw new Error("toolStatus must be an array");
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const name = optionalTrimmedString(item.name);
    if (!name) {
      return [];
    }
    return [{
      name,
      available: item.available === true,
      ...(optionalTrimmedString(item.version) ? { version: optionalTrimmedString(item.version) } : {}),
      ...(optionalTrimmedString(item.path) ? { path: optionalTrimmedString(item.path) } : {})
    }];
  });
}

function capabilitiesValue(value: unknown): DeviceCapabilities {
  if (!isRecord(value)) {
    throw new Error("device.capabilities is required");
  }
  return cloneCapabilities(value as DeviceCapabilities);
}

function cloneCapabilities(capabilities: DeviceCapabilities): DeviceCapabilities {
  return {
    preview: capabilities.preview === true,
    tap: capabilities.tap === true,
    longPress: capabilities.longPress === true,
    swipe: capabilities.swipe === true,
    back: capabilities.back === true,
    home: capabilities.home === true,
    recentApps: capabilities.recentApps === true,
    textInput: capabilities.textInput === true,
    screenshot: capabilities.screenshot === true,
    harmonyScreenStream: capabilities.harmonyScreenStream === true,
    launchApp: capabilities.launchApp === true,
    closeApp: capabilities.closeApp === true,
    recordVideo: capabilities.recordVideo === true,
    metrics: {
      cpu: capabilities.metrics?.cpu === true,
      memory: capabilities.metrics?.memory === true,
      fps: capabilities.metrics?.fps === true,
      network: capabilities.metrics?.network === true,
      battery: capabilities.metrics?.battery === true,
      temperature: capabilities.metrics?.temperature === true
    },
    events: {
      crash: capabilities.events?.crash === true,
      anr: capabilities.events?.anr === true,
      logs: capabilities.events?.logs === true
    }
  };
}

function resolutionValue(value: unknown): { width: number; height: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const width = Number(value.width);
  const height = Number(value.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : undefined;
}

function platformValue(value: unknown): Platform {
  if (value === "android" || value === "ios" || value === "harmony") {
    return value;
  }
  throw new Error("device.platform must be android, ios, or harmony");
}

function orientationValue(value: unknown): "portrait" | "landscape" | undefined {
  return value === "portrait" || value === "landscape" ? value : undefined;
}

function deviceStatusValue(value: unknown): DeviceStatus {
  return value === "offline" || value === "locked" || value === "running" || value === "error" ? value : "online";
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function requiredTrimmedString(value: unknown, name: string): string {
  const text = optionalTrimmedString(value);
  if (!text) {
    throw new Error(`${name} is required`);
  }
  return text;
}

function optionalTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function randomPairingCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function agentCommandPriority(command: AgentCommandEnvelope): number {
  if (command.command === "performAction" || command.command === "performSemanticAction") {
    return 100;
  }
  if (command.command === "startScrcpyStream" || command.command === "startHarmonyStream") {
    return 90;
  }
  if (command.command === "screenshot") {
    return 0;
  }
  return 50;
}
