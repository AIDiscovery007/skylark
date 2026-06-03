# Changelog

## [Unreleased]

### Added

- Added the initial private Electron desktop agent workspace with a secure main/preload boundary, typed IPC bridge, and a minimal React chat shell.
- Added OpenAI Codex OAuth login in desktop provider settings using shared pi CLI auth storage.
- Added desktop credential settings for runtime provider API keys and Anthropic, GitHub Copilot, and OpenAI Codex subscription logins.
- Added API key connection testing from desktop credential settings.
- Added local-folder projects so desktop sessions, tools, and terminals run inside the selected project cwd.
- Added desktop capability management for skills, prompt templates, stdio MCP servers, MCP tool adapters, and composer slash command insertion.
- Added read-only detail previews for desktop skills and prompt templates in the capability library.
- Added sidebar session deletion with persisted session cleanup and safe active-session replacement.
- Added right-side workspace panel tabs for review, local file previews, sandboxed HTML previews, and restricted browser previews.
- Added one-click line wrapping for text-style assistant code blocks.
- Added generated thread file references for completed edit, write, find, and grep tool calls that open in the workspace preview panel.
- Added per-session Plan / Execute mode with read-only planning guardrails and approved-plan execution from assistant plans.
- Added a persisted execution progress panel backed by an execute-only structured progress tool.
- Added desktop composer file attachments with picker, drag/drop, paste image support, and a built-in `/compact` slash command.
- Added persisted Agent Workspace metadata and lifecycle storage for workspace runtime support.
- Added an app-owned tmux runtime adapter for session, pane, capture, send, role-scoped pane stop/restart, and cleanup operations.
- Added a workspace runtime orchestrator that prepares, opens, pauses, resumes, archives, and role-scopes app-owned tmux runtimes.
- Added terminal context harvesting with bounded capture, redaction, extracted error blocks, and persisted snapshots.
- Added `workspace_runtime_*` agent tools for preparing the current session runtime, reading status, capturing context, sending text, pausing, resuming, archiving, and role-scoped pane control.
- Added a runtime permission gate and audit log for workspace runtime control actions.
- Added workspace runtime reconciliation and resource governance for idle pause, hot runtime limits, orphans, and snapshot retention.
- Added a compact Workspace status panel that combines task progress and current-session runtime pane state without exposing tmux internals.
- Added focused read-only subagents with persisted transcripts, Activity rendering, and Environment panel lifecycle status.
- Added a right-side subagent detail thread with persisted handoff briefs, live child runtime events, and Environment panel entry points.
- Added a debug workspace creation flow with package-script command detection for dev, test, and logs panes.
- Added human takeover ownership state with agent-write blocking while a pane is under user control.
- Added a global Events kanban for capturing ideas, documents, and follow-up work before running them as project sessions.
- Added event management criteria, priorities, comments, and reviewable agent proposals for the Events board.
- Added a bottom progress float for Events board management runs and supports reviewable discard recommendations.
- Added an execute-only `create_events` agent tool for creating one or more Events board items from explicit user requests.
- Added appearance settings for light, dark, and system themes with custom colors, fonts, sidebar translucency, and contrast.
- Added global UI and code font size controls to desktop appearance settings.
- Added 10 Color Hunt palette presets to desktop appearance settings.
- Added editable Agent Home `AGENTS.md` and `COMPACT.md` instruction resources to desktop general settings.
- Added a `clear:sessions` maintenance script for clearing local desktop session history and stale event run references.
- Added unsigned macOS Apple Silicon DMG and ZIP packaging for the Skeleton desktop app.
- Added independent Skeleton `0.1.0` release metadata for packaged desktop app versioning.
- Added Skylark `0.1.1` release metadata for the packaged desktop app.
- Added standalone public Skylark `0.2.0` release metadata, repository docs, and GitHub Release download packaging.

### Changed

- Switched assistant markdown code blocks to a unified `react-shiki` code frame with syntax highlighting.
- Flattened assistant code block chrome and aligned expansion with structural drawer motion.
- Removed the active sidebar session accent bar in favor of the selected row background.
- Made the capabilities library the sole selected sidebar item while open and removed its local back button.
- Treated sidebar session selection as a peer route that exits the capabilities view.
- Renamed the packaged desktop app identity from Skeleton to Skylark.
- Converted Skylark from a `pi-mono` workspace package into a standalone app repository that depends on published `@earendil-works/pi-*` npm packages.
- Separated local development user data from packaged Skylark user data.
- Moved Skylark desktop agent data into `~/.skylark` with JSONL session transcripts, legacy desktop data migration, and platform-only window state under Electron user data.
- Renamed Events board criteria to `~/.skylark/events/EVENTS.md` and cleans up legacy event criteria filenames.
- Made the Events detail run editor the single event problem editing surface and removed the duplicate content editor.
- Treats running Events as comment-only context during event management so proposals cannot change their priority or status.
- Added a lightweight inline confirmation control before starting Events board management runs.
- Made completed or failed Events board management progress floats dismissible from a hover close control.
- Moved Events board `EVENTS.md` criteria editing from the board header into desktop general settings.
- Switched Skylark sessions to a baseline discovery toolset with on-demand Skill loading, capability search, local intent pre-activation, model-driven toolset activation, and turn-scoped tool reset.
- Changed desktop subagents to use structured handoff briefs and soft exploration budgets that finalize with best-effort summaries instead of failing on `maxTurns`.

### Fixed

- Prevented clean packaged installs from auto-importing the development working directory as the first project.
- Made the top new conversation action return from capabilities to the active blank conversation before creating another session.
- Kept the session workbench mounted and painted while switching to the capabilities library and aligned its header with the session panel header.
- Moved desktop capability management into an independent repository-style library page opened from the sidebar.
- Enabled the default local desktop tool set (`read`, `find`, `grep`, `bash`, `edit`, `write`) for new desktop sessions and exposed runtime tool availability to the renderer.
- Replaced free-form provider/model settings with runtime-catalog-backed selectors and added a persisted `showThinkingBlocks` renderer setting.
- Hid assistant thinking blocks by default and upgraded tool activity cards to render structured output for built-in tools.
- Bypassed agent tool approval prompts in Execute mode while keeping manual UI approvals intact.
- Rendered proposed Plan mode outputs as expandable thread cards instead of raw `<proposed_plan>` blocks.
- Limited broad found-file references to files directly mentioned by the assistant response.
- Moved Plan mode execution into a one-time action row with an `等一会儿` dismissal path.
- Changed Plan mode execution to send a compact start command instead of replaying the full plan as a prompt.
- Kept Plan mode conversational for greetings and discussion instead of forcing every reply into a proposed plan.
- Added a minimized execution-progress pill so the floating progress panel can get out of the thread content on narrow windows.
- Kept review fullscreen titlebar metadata scoped to the active chat view, kept collapsed Events/capability titlebar controls clickable, and prevented the chat header drag region from covering collapsed sidebar controls after creating a conversation.
- Kept detail-backed settings loading until Agent Home instruction resources hydrate so the AGENTS.md editor does not first paint empty.
- Restored Agent Home instruction editors from persisted content after settings detail reloads so AGENTS.md and EVENTS.md do not remain blank from stale local textarea state.
- Ignored stale Events board management proposal items that reference events outside the current management context instead of failing the whole management run.

### Fixed

- Replaced the desktop chat timeline's assistant-ui render boundary with AI Elements-backed rendering to avoid white-screen crashes during session switches and runtime updates.
- Enabled the `xhigh` thinking level for GPT-5.5 desktop sessions.
- Protected active long-running workspace runtime panes from idle and hot resource governor pauses.
- Hardened workspace runtime context and write paths so raw tmux socket/session metadata is not exposed to agent tools, pane ids must belong to the current workspace runtime, unmanaged socket metadata is refused, pause snapshot failures are reported, and tmux command timeouts use a dedicated error code.
- Shortened app-owned tmux socket paths so deep Electron user-data paths do not break runtime startup.
- Kept active session deletion on the adjacent existing session instead of creating a new session when another session is available.
- Stopped empty project selection and capability loading from auto-creating sessions, showing a quiet empty-project hint instead.
- Kept background session stream updates out of the visible transcript while another session snapshot is loading, avoiding white screens and mixed transcripts during running-session switches.
- Kept workspace-level third-party agent context files out of Skylark's default runtime context and clarified that Skylark session storage lives under the app-owned agent home.
- Avoided appending duplicate desktop session metadata snapshots when only transcript messages changed.
- Replaced remaining Pi-branded empty-state and composer copy with Skylark-branded copy in the desktop chat surface.
