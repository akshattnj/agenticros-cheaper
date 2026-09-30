# AgenticROS — Comprehensive Source Code & Function Reference

This document provides a detailed breakdown of all functions, classes, transport abstractions, configuration pipelines, and memory mechanisms within the AgenticROS codebase. It is structured for high context efficiency, allowing human developers and Large Language Models (LLMs) to quickly inspect symbol signatures, operational flows, and implementation logic.

---

## Table of Contents
1. [Architecture & System Overview](#1-architecture--system-overview)
2. [Cross-Adapter Memory Subsystem (Detailed Focus)](#2-cross-adapter-memory-subsystem-detailed-focus)
   - [Core Memory Contracts & Types](#core-memory-contracts--types)
   - [Memory Factory & Namespace Resolution](#memory-factory--namespace-resolution)
   - [Local Memory Provider (`LocalMemoryProvider`)](#local-memory-provider-localmemoryprovider)
   - [Mem0 Memory Provider (`Mem0MemoryProvider`)](#mem0-memory-provider-mem0memoryprovider)
   - [Adapter-Level Memory Lifecycle & Tools](#adapter-level-memory-lifecycle--tools)
   - [In-Memory State Trackers Across Codebase](#in-memory-state-trackers-across-codebase)
3. [Core Package (`@agenticros/core`)](#3-core-package-agenticroscore)
   - [Configuration (`config.ts`)](#configuration-configts)
   - [Transport Abstraction (`transport/*`)](#transport-abstraction-transport)
   - [Named Places Store (`places.ts`)](#named-places-store-placests)
   - [Topic Utilities (`topic-utils.ts`)](#topic-utilities-topic-utilsts)
   - [Discovery & Fleet Registry (`discovery.ts`, `robots.ts`, `find-robots-for.ts`)](#discovery--fleet-registry-discoveryts-robotsts-find-robots-forts)
   - [Hive Inter-Robot System (`hive/*`)](#hive-inter-robot-system-hive)
4. [ROS Camera Package (`@agenticros/ros-camera`)](#4-ros-camera-package-agenticrosros-camera)
5. [Codex / Claude Code MCP Server (`@agenticros/claude-code`)](#5-codex--claude-code-mcp-server-agenticrosclaude-code)
6. [OpenClaw Gateway Plugin (`@agenticros/agenticros`)](#6-openclaw-gateway-plugin-agenticrosagenticros)
7. [Gemini CLI Adapter (`@agenticros/gemini`)](#7-gemini-cli-adapter-agenticrosgemini)
8. [Orchestrator CLI (`agenticros`)](#8-orchestrator-cli-agenticros)
9. [Robot Eyes Display (`@agenticros/eyes`)](#9-robot-eyes-display-agenticroseyes)
10. [ROS2 Workspace Python Nodes (`ros2_ws`)](#10-ros2-workspace-python-nodes-ros2_ws)
11. [Google Antigravity (AGY) Integration & Implementation Log](#11-google-antigravity-agy-integration--implementation-log)


---

## 1. Architecture & System Overview

AgenticROS decouples AI agent platforms (OpenClaw, Claude Code/Codex MCP, Gemini CLI) from ROS2 hardware using a tiered architecture:

```
+-------------------------------------------------------------------------+
|                  Adapters (MCP Server / OpenClaw / Gemini CLI)          |
+-------------------------------------------------------------------------+
|                @agenticros/core (Transport, Config, Memory)             |
+-------------------------------------------------------------------------+
|  Zenoh (ws)  |  Rosbridge (ws)  |  Local DDS (rclnodejs) | WebRTC (Mode C) |
+-------------------------------------------------------------------------+
|                            ROS2 Nodes / Robot                           |
+-------------------------------------------------------------------------+
```

- **`packages/core`**: Zero-platform-dependency core transport abstractions, Zod schemas, semantic memory backends, places store, and fleet discovery.
- **`packages/ros-camera`**: Shared snapshot decoder converting `sensor_msgs/Image` and `sensor_msgs/CompressedImage` to JPEG buffers.
- **`packages/agenticros-claude-code`**: Stdio MCP server implementing 15+ tool handlers for Codex / Claude Code.
- **`packages/agenticros`**: OpenClaw gateway plugin offering web config UI, HTTP teleop, VLM scene description, and tool routes.
- **`packages/agenticros-gemini`**: Standalone terminal client using Gemini API function calls.
- **`packages/agenticros-cli`**: Orchestrator CLI (`agenticros setup`, `doctor`, `eyes`, `skills`).
- **`packages/robot-eyes`**: Browser & terminal animated face display with WASD teleop keyboard control.
- **`ros2_ws`**: Native ROS2 nodes in Python (`agenticros_discovery`, `agenticros_agent`, `agenticros_follow_me`, `agenticros_explore`).

---

## 2. Cross-Adapter Memory Subsystem (Detailed Focus)

The memory subsystem allows independent agent adapters to maintain shared long-term facts about the robot, environment, user preferences, and spatial landmarks across sessions. Memory is namespaced (by default using `robot.namespace`).

### Core Memory Contracts & Types
Defined in [`packages/core/src/memory/types.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/core/src/memory/types.ts):

- `MemoryRecord`:
  - `id: string`: Unique record ID assigned by provider.
  - `content: string`: Raw memory text stored by agent.
  - `namespace: string`: Namespace key (e.g. robot namespace).
  - `tags?: string[]`: Optional tags assigned at write time.
  - `path?: string`: Hierarchical key hint (e.g., `"profile.speed"`).
  - `createdAt: number`: Unix timestamp in milliseconds.
  - `score?: number`: Relevance/similarity score assigned during `recall`.
- `MemoryStatus`:
  - `enabled: boolean`, `backend: "local" | "mem0"`, `namespace: string`, `recordCount: number`, `lastWriteAt: number | null`, `embedder?: { provider: string; model?: string }`.
- `MemoryProvider` Interface:
  - `remember(input: RememberInput): Promise<MemoryRecord>`
  - `recall(input: RecallInput): Promise<MemoryRecord[]>`
  - `forget(input: ForgetInput): Promise<{ removed: number }>`
  - `status(namespace: string): Promise<MemoryStatus>`
  - `recent(namespace: string, limit?: number): Promise<MemoryRecord[]>`

---

### Memory Factory & Namespace Resolution
Defined in [`packages/core/src/memory/factory.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/core/src/memory/factory.ts):

#### `createMemory(config: AgenticROSConfig): Promise<MemoryProvider | null>`
- **Logic**: Returns `null` if `config.memory.enabled === false`. Otherwise inspects `config.memory.backend`:
  - `"local"`: Dynamically imports `./local/provider.js` and constructs `LocalMemoryProvider`.
  - `"mem0"`: Dynamically imports `./mem0/provider.js` and constructs `Mem0MemoryProvider`.
- **Context Benefit**: Dynamic imports ensure zero unnecessary dependencies are loaded when memory is disabled or running on local backend.

#### `resolveMemoryNamespace(config: AgenticROSConfig, argNamespace?: string): string`
- **Precedence Hierarchy**:
  1. Explicit argument (`argNamespace` if non-empty).
  2. `config.memory.namespace` (if set in configuration).
  3. `config.robot.namespace` (global robot ID).
  4. Fallback empty string `""`.

---

### Local Memory Provider (`LocalMemoryProvider`)
Defined in [`packages/core/src/memory/local/provider.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/core/src/memory/local/provider.ts):

Lightweight JSON file store (`~/.agenticros/memory.json`) without external vector database dependencies.

#### Key Functions & Implementation Details:

1. `constructor(config: { storePath: string })`:
   - Expands home directory paths (`~/...`) via `expandHome()`. Sets initial memory cache `records = null`.
2. `remember(input: RememberInput): Promise<MemoryRecord>`:
   - Validates non-empty namespace. Generates UUID `id`.
   - Reads existing records via `load()`, appends record, triggers serialized atomic save `persist()`.
3. `recall(input: RecallInput): Promise<MemoryRecord[]>`:
   - Tokenizes search query into lowercase word tokens via `tokenize()`.
   - **TF-style Token Overlap & Exponential Decay Scoring**:
     \[
     \text{overlap} = \frac{\text{hits}}{\sqrt{|\text{queryTokens}| \times |\text{docTokens}|}}
     \]
     \[
     \text{recencyBonus} = \exp\left(-\frac{\text{ageMs}}{1000 \times 60 \times 60 \times 24 \times 14}\right) \quad (14\text{-day half-life})
     \]
     \[
     \text{score} = \begin{cases} 0 & \text{if } \text{overlap} = 0 \\ \text{overlap} + (\text{recencyBonus} \times 0.05) & \text{otherwise} \end{cases}
     \]
   - Ranks matches descending by score and returns top `limit` results.
4. `forget(input: ForgetInput): Promise<{ removed: number }>`:
   - Supports 3 deletion modalities:
     - By exact ID (`input.id`).
     - By query matching within namespace (`input.query` + `input.namespace`).
     - Entire namespace deletion (`input.namespace` alone).
   - Writes updated array to disk if items were removed.
5. `status(namespace: string): Promise<MemoryStatus>`:
   - Counts matching records for `namespace` and calculates maximum `createdAt` write timestamp.
6. `recent(namespace: string, limit = 5): Promise<MemoryRecord[]>`:
   - Sorts namespace records newest-first by `createdAt` and returns up to `limit`.
7. `persist(): Promise<void>` (Private):
   - Uses a Promise write chain (`this.writeChain`) to prevent concurrent file write corruption.
   - Writes JSON payload to `<storePath>.tmp` first, then atomically renames to `<storePath>`.

---

### Mem0 Memory Provider (`Mem0MemoryProvider`)
Defined in [`packages/core/src/memory/mem0/provider.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/core/src/memory/mem0/provider.ts):

Vector-search memory provider interfacing with `mem0ai/oss`.

#### Key Functions & Implementation Details:

1. `createMem0Provider(args: { config: Mem0BackendConfig }): Promise<Mem0MemoryProvider>`:
   - Dynamically imports `mem0ai/oss`.
   - Triggers `detectEmbedder()` if `embedder` is not specified in config.
   - Instantiates `mem0ai` `Memory` instance with SQLite history DB (`historyDbPath`).
2. `detectEmbedder(opts?): Promise<Mem0ComponentConfig>`:
   - Auto-detection sequence:
     1. Pings Ollama at `http://localhost:11434/api/tags` with a 200ms timeout. If reachable, selects provider `"ollama"` with model `"nomic-embed-text"`.
     2. Checks for `OPENAI_API_KEY`. If present, selects provider `"openai"` with model `"text-embedding-3-small"`.
     3. Throws explicit error instructing configuration if neither is available.
3. `remember(input: RememberInput): Promise<MemoryRecord>`:
   - Calls `this.memory.add(input.content, { userId: namespace, metadata, infer: this.inferOnWrite })`.
   - Extracts assigned ID via `extractFirstId(result)`.
4. `recall(input: RecallInput): Promise<MemoryRecord[]>`:
   - Queries `this.memory.search(input.query, { filters: { user_id: namespace }, limit })`.
   - Normalizes hit shapes via `normalizeHits()` and converts to `MemoryRecord[]`.
5. `forget(input: ForgetInput): Promise<{ removed: number }>`:
   - Deletes by single ID, or enumerates hits matching `user_id` namespace and deletes each ID sequentially to maintain version compatibility across `mem0ai` releases.
6. `status(namespace: string)` & `recent(namespace: string, limit)`:
   - Queries `memory.getAll({ filters: { user_id: namespace }, limit: 1000 })`, sorting by timestamp.

---

### Adapter-Level Memory Lifecycle & Tools

#### MCP Adapter Memory Lifecycle ([`packages/agenticros-claude-code/src/memory.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/agenticros-claude-code/src/memory.ts))
- `ensureMemory(config)`: Lazy-initializes singleton `MemoryProvider` before executing any tool request.
- `resetMemory()`: Resets provider to force re-initialization when config updates.

#### OpenClaw Plugin Memory Lifecycle ([`packages/agenticros/src/memory.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/agenticros/src/memory.ts))
- `ensurePluginMemory(config)`: Ensures OpenClaw plugin memory instance is loaded.
- `resetPluginMemory()`: Clears cached memory instance.

#### Memory Tool Handlers (Shared across MCP, OpenClaw, Gemini)
- `memory_remember`: Stores facts into semantic memory (`input: { content, tags?, path?, namespace? }`).
- `memory_recall`: Retrieves relevant facts given a search query (`input: { query, limit?, namespace? }`).
- `memory_forget`: Removes matching records by ID, query, or namespace (`input: { id?, query?, namespace? }`).
- `memory_status`: Reports backend health, total records, and last write timestamp (`input: { namespace? }`).

---

### In-Memory State Trackers Across Codebase

1. **Named Places Store ([`packages/core/src/places.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/core/src/places.ts))**:
   - Manages map landmark coordinates (`~/.agenticros/places.json`).
   - Functions: `loadPlaces()`, `savePlaces()`, `listPlaces()`, `getPlace(name)`, `savePlace(place)`, `forgetPlace(name)`, `poseFromLocalizationMessage(msg)`.
2. **Mission Registry ([`packages/core/src/mission-registry.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/core/src/mission-registry.ts))**:
   - In-memory tracker managing long-running mission goals (e.g. follow-me, exploration). Allows sibling MCP/OpenClaw tool calls like `mission_cancel` to signal cancellation tokens mid-mission.
3. **Camera Snapshot Cache ([`packages/agenticros/src/camera-snapshot-cache.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/agenticros/src/camera-snapshot-cache.ts))**:
   - Temporary in-memory cache storing binary camera buffers to prevent redundant ROS topic subscriptions.
4. **Transport Connection Pool ([`packages/core/src/transport/transport-pool.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/core/src/transport/transport-pool.ts))**:
   - Retains active ROS transport connections indexed by robot ID / mode to reuse connections across requests.

---

## 3. Core Package (`@agenticros/core`)

### Configuration (`config.ts`)
- `AgenticROSConfigSchema`: Zod schema defining transport settings, robot properties, fleet list (`robots`), safety limits, describer options, memory settings, and skill paths.
- `parseConfig(raw: Record<string, unknown>): AgenticROSConfig`: Validates and parses raw config objects, handling legacy schema backwards compatibility.
- `prepareConfigForPersistence(parsed, raw)`: Strips non-explicit Zod defaults before saving config to disk.
- `getTransportConfig(config): TransportConfig`: Generates transport configuration object based on active mode.

### Transport Abstraction (`transport/*`)
- `RosTransport` Interface ([`packages/core/src/transport/transport.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/core/src/transport/transport.ts)):
  - `publish(topic, msg, options)`
  - `subscribe(topic, type, callback)`
  - `callService(service, type, req)`
  - `sendActionGoal(action, type, goal)`
  - `getParam(node, param)` / `setParam(node, param, value)`
  - `getTopicList()` / `getServiceList()`
  - `getConnectionStatus()`
- `createTransport(config: TransportConfig)` ([`packages/core/src/transport/factory.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/core/src/transport/factory.ts)):
  - Dynamically instantiates Zenoh (`ZenohTransport`), Rosbridge (`RosbridgeTransport`), Local (`LocalRosTransport`), or WebRTC (`WebRtcTransport`).

### Named Places Store (`places.ts`)
- Maintains map poses (`x, y, yaw, frame`).
- `savePlace({ name, x, y, yaw, frame })`: Stores/updates a named landmark.
- `poseFromLocalizationMessage(msg)`: Extracts `x, y, yaw` from `geometry_msgs/PoseStamped` or `nav_msgs/Odometry`.

### Topic Utilities (`topic-utils.ts`)
- `prefixTopic(topic, namespace)`: Ensures correct topic namespacing.
- `normalizeTopic(topic)`: Strips duplicate slashes and trailing whitespace.
- `stripNamespace(topic, namespace)`: Removes robot namespace prefix from topic paths.

### Discovery & Fleet Registry (`discovery.ts`, `robots.ts`, `find-robots-for.ts`)
- `discoverCapabilities(transport)`: Queries ROS2 topic list to identify available capabilities (SLAM, Nav2, MoveIt, camera streams).
- `resolveRobots(config)`: Resolves list of available fleet robots.
- `findRobotsFor(config, filter)`: Filters robots matching desired kind (`amr`, `arm`), sensors (`has_realsense`), or capabilities.
- `getTransportConfigForRobot(config, robotId)`: Resolves per-robot transport overrides.

### Hive Inter-Robot System (`hive/*`)
- `createHiveClient(config)`: Initializes inter-robot peer communication client over Corebrum HTTP endpoint.
- `HiveClient`: Class managing fleet discovery, peer health heartbeats, and inter-robot task routing.

---

## 4. ROS Camera Package (`@agenticros/ros-camera`)

Defined in [`packages/ros-camera/src/index.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/ros-camera/src/index.ts):

- `decodeCameraImage(msg: unknown): CameraSnapshotResult`:
  - Detects `sensor_msgs/CompressedImage` vs `sensor_msgs/Image`.
- `compressedToJpeg(msg)`: Converts compressed image payload (JPEG/PNG) into standardized Base64 JPEG data.
- `rawToJpeg(msg)`: Unpacks raw pixel encodings (`rgb8`, `bgr8`, `mono8`, `rgba8`, `bgra8`) and encodes to JPEG buffer using `jpeg-js`.

---

## 5. Codex / Claude Code MCP Server (`@agenticros/claude-code`)

- `index.ts`: Entrypoint launching Stdio Server Transport and registering tool request handlers.
- `safety.ts` -> `validateTwistSafety(cmd, safetyConfig)`:
  - Clamps `linear.x/y/z` to `[-maxLinearVelocity, maxLinearVelocity]`.
  - Clamps `angular.x/y/z` to `[-maxAngularVelocity, maxAngularVelocity]`.
- `depth.ts` -> `sampleDepthDistance(buffer, encoding, width, height)`:
  - Parses 16-bit unsigned (`16UC1` in mm) or 32-bit float (`32FC1` in meters) depth images at center pixel coordinates.
- Tool Handlers (`tools.ts`):
  - `ros2_list_topics`, `ros2_publish`, `ros2_estop`, `ros2_save_place`, `ros2_list_places`, `ros2_navigate_to_place`, `ros2_subscribe_once`, `ros2_service_call`, `ros2_action_goal`, `ros2_param_get`, `ros2_param_set`, `ros2_camera_snapshot`, `ros2_depth_distance`, `memory_remember`, `memory_recall`, `memory_forget`, `memory_status`.

---

## 6. OpenClaw Gateway Plugin (`@agenticros/agenticros`)

- `service.ts` -> `AgenticRosService`: Plugin lifecycle controller.
- `skill-loader.ts` -> `loadSkillPackages()`: Discovers and dynamically loads external AgenticROS skill packages.
- `describer.ts` -> `describeSnapshot(imageBase64, config)`: Passes camera images to Ollama / OpenAI VLM endpoints to generate text descriptions for non-multimodal primary LLMs.
- `routes.ts`: Registers web configuration endpoints (`/agenticros/config`) and teleop web app routes (`/agenticros/teleop/`).

---

## 7. Gemini CLI Adapter (`@agenticros/gemini`)

- `chat.ts`: Manages Gemini terminal chat session loop.
- `tools.ts`: Translates AgenticROS tools into Gemini Function Declarations and handles invocation responses.

---

## 8. Orchestrator CLI (`agenticros`)

Command modules in [`packages/agenticros-cli/src/commands/`](file:///home/aki/agenticros-cheaper/agenticros/packages/agenticros-cli/src/commands):

- `codex.ts`: Manages Codex CLI configuration (`agenticros codex setup`).
- `doctor.ts`: Verifies node execution environment, Zenoh router connectivity, and ROS transport status.
- `eyes.ts`: Launches robot face display daemon.
- `up.ts` / `down.ts`: Starts and stops Docker simulation environment services.
- `skills.ts`: Lists, installs, and manages skill packages.

---

## 9. Robot Eyes Display (`@agenticros/eyes`)

Located in [`packages/robot-eyes/`](file:///home/aki/agenticros-cheaper/agenticros/packages/robot-eyes):

- `src/index.js`: Express server hosting local WebRTC / DDS face interface.
- `public/eyes.js`: Canvas rendering engine updating animated eye pupils, blinking, and emotion states (happy, neutral, sad, confused).
- `public/teleop.js`: WASD keyboard teleop listener sending velocity publish commands to `cmd_vel`.
- `lib/person-gaze.js`: Calculates pupil tracking angles towards detected person coordinates.

---

## 10. ROS2 Workspace Python Nodes (`ros2_ws`)

Located in [`ros2_ws/src/`](file:///home/aki/agenticros-cheaper/agenticros/ros2_ws/src):

1. **`agenticros_discovery/discovery_node.py`**:
   - ROS2 node publishing robot metadata and topic capability manifests on `/_agenticros/discovery`.
2. **`agenticros_agent/agent_node.py`**:
   - WebRTC agent bridge node (Mode C cloud transport).
3. **`agenticros_follow_me`**:
   - `follow_me_node.py`: Main state machine for human target tracking.
   - `person_tracker.py`: Tracks target bounding box coordinates and depth.
   - `follower_controller.py`: Proportional control loop generating velocity commands (`cmd_vel`).
4. **`agenticros_explore`**:
   - `explore_node.py`: Frontier exploration node.
   - `frontiers.py`: Computes map frontier centroids from `nav_msgs/OccupancyGrid` messages for autonomous navigation.

---

## 11. Google Antigravity (AGY) Integration & Implementation Log

AgenticROS natively integrates with **Google Antigravity (AGY)**, allowing Antigravity agents (CLI & IDE) to orchestrate ROS2 robots using default terminal accounts and Gemini subscriptions without requiring any external `GEMINI_API_KEY`.

### Key Implementation Components & Source Files:

1. **AGY Configuration & Skill Helper ([`packages/agenticros-cli/src/util/agy-config.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/agenticros-cli/src/util/agy-config.ts))**:
   - `agySkillPath()`: Resolves path to `~/.gemini/antigravity-cli/skills/agenticros/SKILL.md`.
   - `agyMcpJsonPath(cwd)`: Resolves project `.mcp.json`.
   - `generateAgySkillContent()`: Scaffolds the official AGY AgenticROS Skill specification detailing all 15+ ROS2/memory tools and velocity safety policies.
   - `writeAgyAgenticrosConfig(mcpEntryAbs, options)`: Automatically registers the AgenticROS stdio MCP server entry in `.mcp.json` and writes the AGY Skill file.
   - `buildAgyDoctorChecks(mcpEntryExpected, repoRoot)`: Performs health diagnostics for AGY configuration and skill installation (`agenticros agy doctor`).

2. **AGY Command Handlers ([`packages/agenticros-cli/src/commands/agy.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/agenticros-cli/src/commands/agy.ts))**:
   - `agySetupCommand(opts)`: CLI handler for `agenticros agy setup`.
   - `agyDoctorCommand(opts)`: CLI handler for `agenticros agy doctor`.
   - `agyRunCommand(prompt, opts)`: Non-interactive terminal CLI runner invoking `agy --print "<prompt>" --dangerously-skip-permissions`. Passes prompts through AGY using the terminal user's default Gemini subscription without API keys.

3. **Orchestrator CLI Commander Integration ([`packages/agenticros-cli/src/index.ts`](file:///home/aki/agenticros-cheaper/agenticros/packages/agenticros-cli/src/index.ts))**:
   - Registered `agenticros agy` command group with `setup`, `doctor`, and `run <prompt...>` subcommands.

4. **Launcher Wrapper Script ([`./agenticros`](file:///home/aki/agenticros-cheaper/agenticros/agenticros))**:
   - Repository root convenience script updated to delegate `agenticros agy run "<prompt>"` directly to `~/.local/bin/agy` or system `agy` binary, ensuring zero-dependency non-interactive execution even when global Node/pnpm are omitted.

5. **Official AGY Skill Spec ([`~/.gemini/antigravity-cli/skills/agenticros/SKILL.md`](file:///home/aki/.gemini/antigravity-cli/skills/agenticros/SKILL.md))**:
   - Deployed skill file enabling AGY agents to automatically recognize and call AgenticROS tools (`ros2_list_topics`, `ros2_publish`, `ros2_save_place`, `memory_remember`, `ros2_estop`, etc.).

6. **Shell Environment Auto-Sourcing (`~/.zshrc` & `~/.bashrc`)**:
   - Automatically sources ROS2 Jazzy (`/opt/ros/jazzy/setup.zsh`) and AgenticROS workspace (`ros2_ws/install/setup.zsh`).
   - Symlinked `/home/aki/.local/bin/agenticros` to `./agenticros`.

