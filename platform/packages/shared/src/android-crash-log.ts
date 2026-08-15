export type AndroidCrashLogType = "java_crash" | "native_crash" | "anr";

export function extractAndroidCrashLog(
  logcat: string,
  type: AndroidCrashLogType,
  processName?: string
): string | undefined {
  const lines = logcat
    .split(/\r?\n/)
    .map((line) => normalizeAndroidLogLine(line.trimEnd()))
    .filter(Boolean);
  const startIndexes = lines.flatMap((line, index) => isCrashStartLine(line, type) ? [index] : []);

  for (const startIndex of startIndexes.reverse()) {
    const block: string[] = [];
    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index];
      if (index > startIndex && !isCrashDetailLine(line, type)) {
        break;
      }
      block.push(line);
    }
    if (block.length >= 2 && (!processName || block.some((line) => line.includes(processName)))) {
      return block.join("\n");
    }
  }
  return undefined;
}

function normalizeAndroidLogLine(line: string): string {
  return line
    .replace(/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\d+\s+\d+\s+[VDIWEF]\s+[^:]+:\s?/, "")
    .replace(/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+[VDIWEF]\/[^:]+(?:\(\d+\))?:\s?/, "");
}

function isCrashStartLine(line: string, type: AndroidCrashLogType): boolean {
  if (type === "java_crash") {
    return /^FATAL EXCEPTION\b/.test(line);
  }
  if (type === "native_crash") {
    return /Fatal signal\s+\d+|>>>\s*[^<]+<<</i.test(line);
  }
  return /\bANR in\b/i.test(line);
}

function isCrashDetailLine(line: string, type: AndroidCrashLogType): boolean {
  if (type === "java_crash") {
    return /^FATAL EXCEPTION\b/.test(line)
      || /^Process:\s*/.test(line)
      || /^PID:\s*\d+/.test(line)
      || /^Caused by:\s+/.test(line)
      || /^Suppressed:\s+/.test(line)
      || /^\s*at\s+/.test(line)
      || /^\s*\.\.\.\s+\d+\s+more$/.test(line)
      || isJavaThrowableLine(line);
  }
  if (type === "native_crash") {
    return /Fatal signal\s+\d+|signal\s+\d+|>>>\s*[^<]+<<</i.test(line)
      || /^(?:backtrace|registers|memory map|stack|abort message|fault addr):/i.test(line)
      || /^#\d+\s+pc\b/i.test(line)
      || /^(?:pid|uid|cmdline|build fingerprint|abi):/i.test(line);
  }
  return /\bANR in\b/i.test(line)
    || /^(?:PID|Reason|Parent|ErrorId|Frozen|State|Load|CPU usage):/i.test(line)
    || /^-----\s+(?:pid|Output from|end)/i.test(line)
    || /^Cmd line:/i.test(line)
    || /^DALVIK THREADS/i.test(line)
    || /^"[^"]+"\s+prio=/i.test(line)
    || /^\s*(?:at\s+|native:|-\s|\|)/i.test(line)
    || /^suspend all histogram:/i.test(line);
}

function isJavaThrowableLine(line: string): boolean {
  return /^(?:[A-Za-z_$][\w$]*\.)+[A-Za-z_$][\w$]*(?::\s.*)?$/.test(line);
}
