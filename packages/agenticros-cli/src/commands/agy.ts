/**
 * `agenticros agy` — setup, health checks, and prompt runner for Google Antigravity (AGY).
 *
 * Configures the workspace `.mcp.json` and installs the AGY Skill into
 * `~/.gemini/antigravity-cli/skills/agenticros/SKILL.md` so Antigravity agents
 * can natively orchestrate ROS2 robots using Gemini subscriptions (no API key required).
 */

import { execa } from "execa";
import { buildAgyDoctorChecks, writeAgyAgenticrosConfig } from "../util/agy-config.js";
import { findMcpEntry } from "../util/mcp-discovery.js";
import { header, info, ok, warn } from "../util/logger.js";
import { getCliPaths } from "../util/paths.js";

export interface AgySetupOptions {
  quiet?: boolean;
  repoRoot?: string;
  cwd?: string;
}

export interface AgyDoctorOptions {
  json?: boolean;
}

export interface AgyRunOptions {
  cwd?: string;
  model?: string;
}

export async function agySetupCommand(opts: AgySetupOptions = {}): Promise<void> {
  if (!opts.quiet) {
    header("Configure AgenticROS for Google Antigravity (AGY)");
  }

  const paths = getCliPaths(opts.cwd ?? process.cwd());
  const repoRoot = opts.repoRoot ?? paths.repoRoot;

  const mcpEntry = findMcpEntry();
  if (!mcpEntry) {
    if (!opts.quiet) {
      warn("Could not locate built MCP entrypoint.");
      info("Run `pnpm build` before running AGY.");
    }
  } else {
    writeAgyAgenticrosConfig(mcpEntry, { cwd: repoRoot });
    if (!opts.quiet) {
      ok("Configured workspace `.mcp.json` for AGY.");
      ok("Installed AGY Skill into `~/.gemini/antigravity-cli/skills/agenticros/SKILL.md`.");
      info("AGY is now fully configured to orchestrate ROS2 robots via Gemini subscriptions (zero API keys needed)!");
    }
  }
}

export async function agyDoctorCommand(opts: AgyDoctorOptions = {}): Promise<number> {
  if (!opts.json) {
    header("AGY (Google Antigravity) Doctor");
  }

  const paths = getCliPaths();
  const mcpEntry = findMcpEntry();
  const checks = buildAgyDoctorChecks(mcpEntry, paths.repoRoot);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ agy: checks }, null, 2)}\n`);
    return checks.some((c) => c.severity === "red") ? 1 : 0;
  }

  for (const check of checks) {
    if (check.severity === "green") {
      ok(`${check.label} ${check.detail ? `(${check.detail})` : ""}`);
    } else if (check.severity === "yellow") {
      warn(`${check.label} — ${check.hint ?? ""}`);
    } else {
      warn(`[FAIL] ${check.label} — ${check.hint ?? ""}`);
    }
  }

  return checks.some((c) => c.severity === "red") ? 1 : 0;
}

/**
 * Execute a prompt via AGY non-interactively from standard terminal shell.
 * Uses default terminal account & Gemini subscription without API key.
 */
export async function agyRunCommand(prompt: string, opts: AgyRunOptions = {}): Promise<void> {
  const args = ["--print", prompt, "--dangerously-skip-permissions"];
  if (opts.model) {
    args.push("--model", opts.model);
  }

  try {
    await execa("agy", args, {
      stdio: "inherit",
      cwd: opts.cwd ?? process.cwd(),
    });
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      // Try ~/.local/bin/agy
      const fallbackPath = `${process.env.HOME ?? ""}/.local/bin/agy`;
      await execa(fallbackPath, args, {
        stdio: "inherit",
        cwd: opts.cwd ?? process.cwd(),
      });
    } else {
      throw err;
    }
  }
}
