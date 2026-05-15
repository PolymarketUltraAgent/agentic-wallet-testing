import { execFile, execFileSync } from "child_process";
import { resolve, dirname } from "path";
import { mkdirSync, readdirSync } from "fs";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type StepEmitter = (event: StepEvent) => void;

export interface StepEvent {
  step: string;
  status: "running" | "success" | "error";
  command?: string;
  output?: string;
  error?: string;
}

const ORIGINAL_HOME = process.env.HOME || "/root";
const ORIGINAL_PATH = process.env.PATH || "";

let _circleBin: string | null = null;
let _circleBinDir: string | null = null;

function findCircleBin(): { bin: string; binDir: string } {
  if (_circleBin && _circleBinDir) return { bin: _circleBin, binDir: _circleBinDir };

  // Try PATH first
  try {
    const found = execFileSync("which", ["circle"], {
      encoding: "utf8",
      env: { ...process.env, HOME: ORIGINAL_HOME },
    }).trim();
    if (found) {
      _circleBin = found;
      _circleBinDir = dirname(found);
      return { bin: _circleBin, binDir: _circleBinDir };
    }
  } catch { /* not in PATH */ }

  // Try nvm locations
  const nvmDir = resolve(ORIGINAL_HOME, ".nvm/versions/node");
  try {
    const versions = readdirSync(nvmDir).sort();
    const latest = versions.pop();
    if (latest) {
      const candidate = resolve(nvmDir, latest, "bin", "circle");
      _circleBin = candidate;
      _circleBinDir = dirname(candidate);
      return { bin: _circleBin, binDir: _circleBinDir };
    }
  } catch { /* nvm not installed */ }

  _circleBin = "circle";
  _circleBinDir = "";
  return { bin: _circleBin, binDir: _circleBinDir };
}

const IS_MACOS = process.platform === "darwin";

function getUserHome(userId: string): string {
  // macOS: Keychain breaks if HOME is overridden, use real HOME
  if (IS_MACOS) return ORIGINAL_HOME;
  // Linux/Docker: safe to isolate sessions via HOME
  const dir = resolve(process.cwd(), env.SESSION_DIR, userId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function exec(
  userId: string,
  args: string[]
): Promise<CLIResult> {
  const userHome = getUserHome(userId);
  const { bin, binDir } = findCircleBin();
  const command = `circle ${args.join(" ")}`;

  logger.debug({ userId, command }, "executing CLI");

  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        env: {
          ...process.env,
          HOME: userHome,
          PATH: binDir ? `${binDir}:${ORIGINAL_PATH}` : ORIGINAL_PATH,
        },
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const result: CLIResult = {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        };

        if (error) {
          logger.debug({ userId, command, error: stderr || error.message }, "CLI error");
        } else {
          logger.debug({ userId, command, output: stdout.trim() }, "CLI success");
        }

        resolve(result);
      }
    );
  });
}

export function parseJSON<T = unknown>(result: CLIResult): T | null {
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    try {
      return JSON.parse(result.stderr) as T;
    } catch {
      return null;
    }
  }
}
