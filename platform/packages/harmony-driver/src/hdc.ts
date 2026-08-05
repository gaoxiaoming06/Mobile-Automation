import { execFile } from "node:child_process";

export type ExecTextOptions = {
  timeoutMs?: number;
  maxBuffer?: number;
};

export function hdcText(args: string[], options: ExecTextOptions = {}): Promise<string> {
  return execText("hdc", args, options);
}

export function hdcShell(serial: string, args: string[], options: ExecTextOptions = {}): Promise<string> {
  return hdcText(["-t", serial, "shell", ...args], options);
}

export function hdcFileRecv(
  serial: string,
  remotePath: string,
  localPath: string,
  options: ExecTextOptions = {}
): Promise<string> {
  return hdcText(["-t", serial, "file", "recv", remotePath, localPath], options);
}

export function commandVersion(command: string, args: string[]): Promise<{ available: boolean; version?: string; path?: string }> {
  return execText(command, args, { timeoutMs: 5000 })
    .then((output) => ({
      available: true,
      version: firstLine(output)
    }))
    .catch(() => ({ available: false }));
}

function execText(command: string, args: string[], options: ExecTextOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        timeout: options.timeoutMs ?? 15000,
        maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = [stderr, stdout, error.message].filter(Boolean).join("\n").trim();
          reject(new Error(detail || `${command} ${args.join(" ")} failed`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function firstLine(output: string): string | undefined {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}
