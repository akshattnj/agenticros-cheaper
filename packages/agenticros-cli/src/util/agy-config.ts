/**
 * AGY (Google Antigravity) config and skill setup helpers.
 *
 * Configures AGY workspace `.mcp.json` and installs the AgenticROS AGY Skill
 * into `~/.gemini/antigravity-cli/skills/agenticros/SKILL.md` so Antigravity
 * agents can natively discover and orchestrate ROS2 robots using Gemini subscriptions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildAgenticrosMcpServerEntry, projectMcpJsonPath, upsertAgenticrosMcpJson } from "./claude-config.js";

export function agySkillPath(): string {
  return join(homedir(), ".gemini", "antigravity-cli", "skills", "agenticros", "SKILL.md");
}

export function agyMcpJsonPath(cwd = process.cwd()): string {
  return projectMcpJsonPath(cwd);
}

export function generateAgySkillContent(): string {
  return `---
name: agenticros
description: Native ROS2 robot control and semantic long-term memory integration for Google Antigravity (AGY). Use to list ROS2 topics, publish velocity commands, navigate to places, read sensors, capture camera snapshots, and maintain cross-session memory.
---

# AgenticROS — Google Antigravity (AGY) Integration

This skill equips Antigravity (AGY) agents with native ROS2 robot control, telemetry, and long-term memory via the AgenticROS MCP server over Zenoh / DDS.

## Available MCP Tools

- **\`ros2_list_topics\`**: List all active ROS2 topics and message types on the graph.
- **\`ros2_publish\`**: Publish a message to a ROS2 topic (e.g. \`/cmd_vel\` for movement).
- **\`ros2_estop\`**: Emergency stop — publishes zero linear/angular velocity to \`/cmd_vel\`.
- **\`ros2_save_place\` / \`ros2_list_places\` / \`ros2_navigate_to_place\`**: Named map landmarks store (\`~/.agenticros/places.json\`).
- **\`ros2_subscribe_once\`**: Read a single message snapshot from any topic.
- **\`ros2_service_call\`**: Invoke a ROS2 service endpoint.
- **\`ros2_action_goal\`**: Send a ROS2 action goal (e.g. Nav2 / MoveIt2).
- **\`ros2_param_get\` / \`ros2_param_set\`**: Inspect or update ROS2 node parameters.
- **\`ros2_camera_snapshot\`**: Capture JPEG camera frames from robot image topics.
- **\`ros2_depth_distance\`**: Sample 16-bit / 32-bit depth distance at image center.
- **\`memory_remember\` / \`memory_recall\` / \`memory_forget\` / \`memory_status\`**: Cross-adapter semantic long-term memory store (\`~/.agenticros/memory.json\` or mem0 vector store).

## Safety Guards

- All velocity publishing commands go through strict velocity clamps:
  - Default Linear Velocity Max: 1.0 m/s
  - Default Angular Velocity Max: 1.5 rad/s
- Emergency stop (\`ros2_estop\`) can be called at any point to halt robot motion instantly.
`;
}

export function writeAgyAgenticrosConfig(
  mcpEntryAbs: string,
  options?: { cwd?: string; namespace?: string },
): void {
  const cwd = options?.cwd ?? process.cwd();
  const mcpPath = agyMcpJsonPath(cwd);
  const abs = resolve(mcpEntryAbs);
  const entry = buildAgenticrosMcpServerEntry(abs, options?.namespace ?? "");

  const existing = existsSync(mcpPath) ? readFileSync(mcpPath, "utf8") : null;
  const merged = upsertAgenticrosMcpJson(existing, entry);

  mkdirSync(dirname(mcpPath), { recursive: true });
  writeFileSync(mcpPath, merged, "utf8");

  // Install AGY skill into ~/.gemini/antigravity-cli/skills/agenticros/SKILL.md
  const skillFile = agySkillPath();
  mkdirSync(dirname(skillFile), { recursive: true });
  writeFileSync(skillFile, generateAgySkillContent(), "utf8");
}

export function buildAgyDoctorChecks(
  mcpEntryExpected: string | undefined,
  repoRoot?: string,
): Array<{ id: string; label: string; severity: "green" | "yellow" | "red"; hint?: string; detail?: string }> {
  const checks: Array<{
    id: string;
    label: string;
    severity: "green" | "yellow" | "red";
    hint?: string;
    detail?: string;
  }> = [];

  const mcpPath = agyMcpJsonPath(repoRoot ?? process.cwd());
  const skillFile = agySkillPath();

  if (existsSync(mcpPath)) {
    checks.push({
      id: "agy-mcp-config",
      label: "AGY workspace MCP config OK",
      severity: "green",
      detail: mcpPath,
    });
  } else {
    checks.push({
      id: "agy-mcp-config",
      label: "AGY workspace MCP config missing",
      severity: "yellow",
      hint: "Run `agenticros agy setup`.",
    });
  }

  if (existsSync(skillFile)) {
    checks.push({
      id: "agy-skill",
      label: "AGY AgenticROS Skill installed OK",
      severity: "green",
      detail: skillFile,
    });
  } else {
    checks.push({
      id: "agy-skill",
      label: "AGY AgenticROS Skill missing",
      severity: "yellow",
      hint: "Run `agenticros agy setup` to install AGY skill.",
    });
  }

  return checks;
}
