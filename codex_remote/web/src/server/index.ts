import Fastify, { type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { ClientMessage, type PublicSetupState, type ServerMessage, type SessionState, type SessionSummary, type SessionTool } from "../shared/protocol.js";
import { client as acpClient, methods, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
type BroadcastMessage = { type: string; [key: string]: unknown };

const execFileAsync = promisify(execFile);
const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
const port = Number(process.env.HASS_CODEX_PORT ?? 8099);
const workspace = process.env.HASS_CODEX_WORKSPACE ?? "/config";
const codex = process.env.CODEX_PATH ?? "/usr/local/bin/codex";
const codeHome = process.env.CODEX_HOME ?? "/data/codex";
const clientRoot = process.env.HASS_CODEX_CLIENT_ROOT ?? "/opt/hass-codex-web/client";
const acpBin = process.env.HASS_CODEX_ACP_BIN ?? "/opt/hass-codex-web/node_modules/@agentclientprotocol/codex-acp/dist/index.js";
const mockMode = process.env.HASS_CODEX_MOCK === "true";

let revision = 0;
let bootNonce = "";
let bootNonceExpires = 0;
let loginProcess: ReturnType<typeof spawn> | undefined;
let acpProcess: ReturnType<typeof spawn> | undefined;
let acpConnection: ReturnType<ReturnType<typeof acpClient>["connect"]> | undefined;
const acpSessionIds = new Map<string, string>();
let remoteConnected = false;
let lastPairing: { manualCode: string; expiresAt: string } | undefined;
const sockets = new Set<{ send(data: string): void; close(): void; nonce: string }>();
const sessions = new Map<string, SessionState>();

const setup: PublicSetupState = {
  phase: "validating",
  authenticated: false,
  remote: { status: "stopped" },
  acp: { status: "stopped" },
  homeAssistantMcp: { reachable: true }
};

function publicSnapshot(selectedId?: string): ServerMessage {
  return { type: "snapshot", revision, setup, sessions: [...sessions.values()].map(toSummary), selected: selectedId ? sessions.get(selectedId) : undefined };
}
function toSummary(s: SessionState): SessionSummary { return { id: s.id, title: s.title, cwd: s.cwd, status: s.status, updatedAt: s.updatedAt, model: s.model, effort: s.effort, draft: s.draft }; }

type AcpConfigOption = {
  id?: string;
  configId?: string;
  category?: string;
  currentValue?: string;
  options?: Array<{ value?: string; label?: string; name?: string }>;
};

function selectorFromConfigOptions(configOptions: unknown, matches: (option: AcpConfigOption) => boolean): SessionState["model"] | undefined {
  if (!Array.isArray(configOptions)) return undefined;
  const option = configOptions.find((item): item is AcpConfigOption => typeof item === "object" && item !== null && matches(item as AcpConfigOption));
  const configId = option?.configId ?? option?.id;
  if (!option || !configId || typeof option.currentValue !== "string" || !Array.isArray(option.options)) return undefined;
  const options = option.options
    .filter((value): value is { value: string; label?: string; name?: string } => typeof value?.value === "string")
    .map((value) => ({ id: value.value, label: value.label ?? value.name ?? value.value }));
  return options.length > 0 ? { configId, currentId: option.currentValue, options } : undefined;
}

function applyConfigOptions(session: SessionState, configOptions: unknown): void {
  session.model = selectorFromConfigOptions(configOptions, (option) => option.category === "model" || option.id === "model" || option.configId === "model") ?? session.model;
  session.effort = selectorFromConfigOptions(configOptions, (option) => option.category === "thought_level" || option.id === "reasoning_effort" || option.configId === "reasoning_effort") ?? session.effort;
}

function previewForBrowser(value: unknown, limit = 8_000): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return undefined;
  // Tool output can contain the very secrets this add-on is explicitly meant
  // not to expose to its browser API. Keep activity useful while failing safe.
  if (/secrets\.ya?ml|auth\.json|authorization:|bearer\s+[\w.-]+|api[_-]?key|access[_-]?token/i.test(text)) return "Sensitive content omitted.";
  return text.length > limit ? `${text.slice(0, limit)}\n… output truncated` : text;
}

function toolPayloadForBrowser(value: unknown, title: string): string | undefined {
  // Auto-review frames contain internal turn/review identifiers and are not an
  // end-user-facing tool result. Preserve its status card but omit the frame.
  if (/guardian review|auto.?review/i.test(title)) return undefined;
  if (typeof value === "object" && value !== null) {
    const record = value as { formatted_output?: unknown; command?: unknown };
    if (typeof record.formatted_output === "string") return previewForBrowser(record.formatted_output);
    if (typeof record.command === "string") return previewForBrowser(record.command);
  }
  return previewForBrowser(value);
}

function workspacePath(path: unknown): string | undefined {
  if (typeof path !== "string") return undefined;
  if (/secrets\.ya?ml|auth\.json/i.test(path)) return "Sensitive path omitted";
  return path.startsWith(`${workspace}/`) ? path.slice(workspace.length + 1) : path;
}

function normaliseTool(update: Record<string, unknown>, existing?: SessionTool): SessionTool {
  const title = typeof update.title === "string" ? update.title : existing?.title ?? "Codex activity";
  const content = Array.isArray(update.content) ? update.content as Array<Record<string, unknown>> : [];
  const diffs = content.filter((item) => item.type === "diff").flatMap((item) => {
    const path = workspacePath(item.path);
    return path ? [{ path, oldText: previewForBrowser(item.oldText), newText: previewForBrowser(item.newText) ?? "" }] : [];
  });
  const textOutput = content.filter((item) => item.type === "content" && typeof (item.content as { text?: unknown } | undefined)?.text === "string")
    .map((item) => (item.content as { text: string }).text).join("\n");
  const locations = Array.isArray(update.locations) ? (update.locations as Array<Record<string, unknown>>).flatMap((item) => {
    const path = workspacePath(item.path);
    return path ? [{ path, line: typeof item.line === "number" ? item.line : undefined }] : [];
  }) : existing?.locations;
  return {
    id: typeof update.toolCallId === "string" ? update.toolCallId : existing?.id ?? randomUUID(),
    title,
    kind: typeof update.kind === "string" ? update.kind as SessionTool["kind"] : existing?.kind ?? "other",
    status: typeof update.status === "string" ? update.status as SessionTool["status"] : existing?.status ?? "pending",
    input: toolPayloadForBrowser(update.rawInput, title) ?? existing?.input,
    output: toolPayloadForBrowser(update.rawOutput, title) ?? previewForBrowser(textOutput) ?? existing?.output,
    locations,
    diffs: diffs.length > 0 ? diffs : existing?.diffs
  };
}
function broadcast(message: Omit<BroadcastMessage, "revision">): void {
  const out = JSON.stringify({ ...message, revision: ++revision });
  for (const socket of sockets) { try { socket.send(out); } catch { sockets.delete(socket); } }
}
function sanitizeError(error: unknown): { code: string; message: string } { return { code: "error", message: error instanceof Error ? error.message.slice(0, 300) : "Operation failed" }; }
function nonceForPage(): string { bootNonce = randomBytes(32).toString("hex"); bootNonceExpires = Date.now() + 600_000; return bootNonce; }
function checkNonce(request: FastifyRequest): boolean { return request.headers["x-codex-boot-nonce"] === bootNonce && Date.now() < bootNonceExpires; }

async function login(): Promise<void> {
  if (loginProcess) return;
  setup.phase = "login_pending";
  broadcast({ type: "setup.patch", patch: setup });
  loginProcess = spawn(codex, ["app-server"], { cwd: workspace, env: { ...process.env, CODEX_HOME: codeHome, NO_BROWSER: "1" }, stdio: ["pipe", "pipe", "pipe"] });
  let id = 1;
  const childProcess = loginProcess;
  const send = (method: string, params: unknown) => childProcess.stdin?.write(`${JSON.stringify({ id: id++, method, params })}\n`);
  let loginId = "";
  if (childProcess.stdout) createInterface({ input: childProcess.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      try {
        const message = JSON.parse(line) as { result?: { type?: string; loginId?: string; verificationUrl?: string; userCode?: string }; method?: string; params?: { loginId?: string; success?: boolean; error?: string } };
        if (message.result?.type === "chatgptDeviceCode") {
          loginId = message.result.loginId ?? "";
          setup.login = { verificationUrl: message.result.verificationUrl ?? "https://auth.openai.com/codex/device", userCode: message.result.userCode ?? "", status: "waiting" };
          console.warn("------------------------------------------------------------");
          console.warn("STEP 1 OF 2 — CHATGPT SIGN-IN REQUIRED");
          console.warn(`Open: ${setup.login.verificationUrl}`);
          console.warn(`Code: ${setup.login.userCode}`);
          console.warn("This is NOT the Remote phone-pairing code.");
          console.warn("------------------------------------------------------------");
          broadcast({ type: "setup.patch", patch: setup });
        }
        if (message.method === "account/login/completed" && message.params?.loginId === loginId) {
          if (message.params.success) { setup.authenticated = true; setup.login = { ...setup.login!, status: "complete" }; setup.phase = "starting_remote"; broadcast({ type: "setup.patch", patch: setup }); void startRemote(); }
          else { setup.phase = "needs_login"; setup.login = { ...setup.login!, status: "failed", error: message.params.error ?? "Login failed" }; broadcast({ type: "setup.patch", patch: setup }); }
          loginProcess?.kill("SIGTERM"); loginProcess = undefined;
        }
      } catch { /* Never log protocol frames. */ }
    });
  childProcess.on("exit", () => { if (loginProcess === childProcess) loginProcess = undefined; });
  send("initialize", { clientInfo: { name: "hass-codex-web", title: "Home Assistant Codex", version: process.env.HASS_CODEX_VERSION ?? "0.2.0" }, capabilities: null });
  send("account/read", { refreshToken: false });
  send("account/login/start", { type: "chatgptDeviceCode" });
}

async function startRemote(): Promise<void> {
  if (mockMode) { remoteConnected = true; setup.remote = { status: "connected", serverName: "Local mock Remote" }; await startAcp(); return; }
  try {
    const result = await execFileAsync(codex, ["remote-control", "start", "--json"], { cwd: workspace, env: process.env, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(result.stdout) as { status?: string; serverName?: string };
    remoteConnected = parsed.status === "connected";
    setup.remote = { status: remoteConnected ? "connected" : "degraded", serverName: parsed.serverName };
    if (remoteConnected) console.info("Codex Remote Control daemon is connected.");
  } catch (error) { setup.remote = { status: "degraded", error: sanitizeError(error).message }; }
  if (remoteConnected && process.env.HASS_CODEX_PAIR_ON_START === "true") await pair();
  await startAcp();
}

async function pair(): Promise<void> {
  if (lastPairing && Date.parse(lastPairing.expiresAt) > Date.now()) return;
  if (mockMode) { lastPairing = { manualCode: "MOCK-PAIR", expiresAt: new Date(Date.now() + 900_000).toISOString() }; setup.remote.pairing = lastPairing; broadcast({ type: "setup.patch", patch: setup }); return; }
  try {
    const result = await execFileAsync(codex, ["remote-control", "pair", "--json"], { cwd: workspace, env: process.env, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(result.stdout) as { manualPairingCode?: string; expiresAt?: string | number };
    if (!parsed.manualPairingCode || !parsed.expiresAt) throw new Error("Pairing response was incomplete");
    const expiresAt = typeof parsed.expiresAt === "number" ? new Date(parsed.expiresAt < 2_000_000_000_000 ? parsed.expiresAt * 1000 : parsed.expiresAt).toISOString() : parsed.expiresAt;
    lastPairing = { manualCode: parsed.manualPairingCode, expiresAt };
    setup.remote.pairing = lastPairing;
    console.warn("------------------------------------------------------------");
    console.warn("STEP 2 OF 2 — PAIR YOUR PHONE WITH CODEX REMOTE");
    console.warn(`Remote pairing code: ${lastPairing.manualCode}`);
    console.warn(`Expires: ${new Date(lastPairing.expiresAt).toISOString()}`);
    console.warn("In ChatGPT mobile: open Remote, add a host, choose manual code, and enter this code.");
    console.warn("This is NOT the ChatGPT device-login code.");
    console.warn("------------------------------------------------------------");
    broadcast({ type: "setup.patch", patch: setup });
  } catch (error) { setup.remote.error = sanitizeError(error).message; broadcast({ type: "setup.patch", patch: setup }); }
}

async function startAcp(): Promise<void> {
  if (acpProcess || acpConnection) return;
  if (mockMode) { setup.acp = { status: "ready" }; setup.phase = "ready"; const id = randomUUID(); sessions.set(id, { id, title: "Local mock Home Assistant task", cwd: workspace, status: "idle", messages: [{ id: randomUUID(), role: "assistant", text: "Mock mode is active. This response is local and does not call Codex or Home Assistant.", createdAt: new Date().toISOString() }], tools: [], updatedAt: new Date().toISOString() }); broadcast({ type: "setup.patch", patch: setup }); return; }
  setup.phase = "starting_acp"; setup.acp = { status: "starting" }; broadcast({ type: "setup.patch", patch: setup });
  try {
    const child = spawn(process.execPath, [acpBin], { cwd: workspace, env: { ...process.env, CODEX_HOME: codeHome, CODEX_PATH: codex, NO_BROWSER: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    acpProcess = child;
    child.stderr.on("data", (chunk: Buffer) => { const line = chunk.toString().trim(); if (line && !line.includes("token") && !line.includes("secret")) console.warn(`ACP: ${line.slice(0, 300)}`); });
    child.on("exit", () => { if (acpProcess === child) acpProcess = undefined; acpConnection = undefined; setup.acp = { status: "degraded", error: "ACP process exited" }; if (setup.phase === "ready") setup.phase = "degraded"; broadcast({ type: "setup.patch", patch: setup }); });
    const stream = ndJsonStream(Writable.toWeb(child.stdin!) as unknown as globalThis.WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as unknown as globalThis.ReadableStream<Uint8Array>);
    const connection = acpClient({ name: "hass-codex-web" })
      .onNotification(methods.client.session.update, (ctx) => handleAcpUpdate(ctx.params))
      .onRequest(methods.client.session.requestPermission, async (ctx) => {
        // Auto-review normally handles routine writes. If ACP still asks the
        // client, fail closed rather than silently authorising an operation.
        const title = (ctx.params as { toolCall?: { title?: string } }).toolCall?.title ?? "Codex action";
        console.warn(`ACP permission request cancelled: ${title.slice(0, 120)}`);
        return { outcome: { outcome: "cancelled" as const } };
      })
      .onRequest(methods.client.fs.readTextFile, async (ctx) => {
        const file = (ctx.params as { path?: string }).path ?? "";
        if (!file.startsWith(`${workspace}/`) && file !== workspace) throw new Error("File is outside the Home Assistant workspace");
        return { content: await readFile(file, "utf8") };
      })
      .connect(stream);
    acpConnection = connection;
    await connection.agent.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientInfo: { name: "hass-codex-web", version: "0.2.0" }, clientCapabilities: { fs: { readTextFile: true }, terminal: false } });
    const listed = await connection.agent.request(methods.agent.session.list, { cwd: workspace }).catch(() => ({ sessions: [] })) as { sessions?: Array<{ sessionId?: string; id?: string; title?: string; cwd?: string; updatedAt?: string }> };
    for (const item of listed.sessions ?? []) {
      const remoteId = item.sessionId ?? item.id;
      if (!remoteId || (item.cwd && item.cwd !== workspace)) continue;
      const id = randomUUID();
      acpSessionIds.set(id, remoteId);
      sessions.set(id, { id, title: item.title ?? "Home Assistant task", cwd: workspace, status: "idle", messages: [], tools: [], updatedAt: item.updatedAt });
    }
    setup.acp = { status: "ready" }; setup.phase = remoteConnected ? "ready" : "degraded"; broadcast({ type: "setup.patch", patch: setup });
  } catch (error) { setup.acp = { status: "degraded", error: sanitizeError(error).message }; setup.phase = "degraded"; broadcast({ type: "setup.patch", patch: setup }); }
}

function handleAcpUpdate(params: unknown): void {
  const update = params as { sessionId?: string; update?: Record<string, unknown> & { sessionUpdate?: string } };
  if (!update.sessionId) return;
  const localId = [...acpSessionIds.entries()].find(([, remoteId]) => remoteId === update.sessionId)?.[0] ?? update.sessionId;
  const session = sessions.get(localId); if (!session) return;
  const u = update.update;
  if (u?.sessionUpdate) console.info(`ACP update: ${u.sessionUpdate}`);
  if (u?.sessionUpdate === "config_option_update") applyConfigOptions(session, u.configOptions);
  if (u?.sessionUpdate === "session_info_update" && typeof u.title === "string" && !session.draft) session.title = u.title;
  if (u?.sessionUpdate === "agent_thought_chunk") {
    session.reasoning = { active: true, updates: (session.reasoning?.updates ?? 0) + 1 };
  }
  if (u?.sessionUpdate === "agent_message_chunk" || u?.sessionUpdate === "user_message_chunk") {
    session.reasoning = session.reasoning ? { ...session.reasoning, active: false } : undefined;
    const content = u.content as { type?: unknown; text?: unknown } | undefined;
    if (content?.type === "text" && typeof content.text === "string") {
      const last = session.messages.at(-1);
      const role = u.sessionUpdate === "user_message_chunk" ? "user" : "assistant";
      if (last?.role === role) last.text += content.text;
      else session.messages.push({ id: typeof u.messageId === "string" ? u.messageId : randomUUID(), role, text: content.text, createdAt: new Date().toISOString() });
    }
  }
  if (u?.sessionUpdate === "tool_call" || u?.sessionUpdate === "tool_call_update") {
    const id = typeof u.toolCallId === "string" ? u.toolCallId : undefined;
    const current = id ? session.tools.find((tool) => tool.id === id) : undefined;
    const tool = normaliseTool(u, current);
    session.tools = [...session.tools.filter((item) => item.id !== tool.id), tool];
  }
  if (u?.sessionUpdate === "plan" && Array.isArray(u.entries)) session.plan = u.entries.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const item = entry as { content?: unknown; status?: unknown };
    return typeof item.content === "string" && (item.status === "pending" || item.status === "in_progress" || item.status === "completed") ? [{ title: item.content, status: item.status }] : [];
  });
  if (u?.sessionUpdate === "plan_update" && typeof u.plan === "object" && u.plan !== null && Array.isArray((u.plan as { entries?: unknown }).entries)) {
    session.plan = ((u.plan as { entries: Array<{ content?: unknown; status?: unknown }> }).entries).flatMap((item) => typeof item.content === "string" && (item.status === "pending" || item.status === "in_progress" || item.status === "completed") ? [{ title: item.content, status: item.status }] : []);
  }
  if (u?.sessionUpdate === "turn_complete" || u?.sessionUpdate === "prompt_complete") { session.status = "idle"; if (session.reasoning) session.reasoning.active = false; }
  session.updatedAt = new Date().toISOString(); broadcast({ type: "session.patch", sessionId: session.id, patch: session });
}

async function bootstrap(): Promise<void> {
  if (mockMode) { setup.authenticated = true; setup.remote = { status: "connected", serverName: "Local mock Remote" }; await startRemote(); return; }
  if (process.env.HASS_CODEX_FORCE_LOGIN === "true") await execFileAsync(codex, ["logout"], { cwd: workspace, env: process.env }).catch(() => undefined);
  try { await execFileAsync(codex, ["login", "status"], { cwd: workspace, env: process.env }); setup.authenticated = true; setup.phase = "starting_remote"; await startRemote(); }
  catch { setup.phase = "needs_login"; broadcast({ type: "setup.patch", patch: setup }); }
  if (setup.phase === "needs_login") await login();
}

await app.register(websocket);
await app.register(fastifyStatic, { root: join(clientRoot, "assets"), prefix: "/assets/", decorateReply: false });
app.get("/", async (_request, reply) => { const html = await readFile(join(clientRoot, "index.html"), "utf8"); return reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; frame-ancestors 'self'").type("text/html").send(html.replace("CODEX_BOOT_NONCE_PLACEHOLDER", nonceForPage())); });
app.get("/favicon.ico", async (_request, reply) => reply.code(204).send());
app.get("/api/bootstrap", async (request, reply) => { if (!checkNonce(request)) return reply.code(403).send({ error: "invalid_nonce" }); return publicSnapshot(); });
app.get("/api/ws", { websocket: true }, (socket, request) => {
  const nonce = String((request.query as { nonce?: string }).nonce ?? ""); if (nonce !== bootNonce || Date.now() >= bootNonceExpires) { socket.close(); return; }
  const client = { send: (data: string) => socket.send(data), close: () => socket.close(), nonce }; sockets.add(client); socket.send(JSON.stringify(publicSnapshot()));
  socket.on("message", async (raw: Buffer) => {
    const parsed = ClientMessage.safeParse(JSON.parse(raw.toString())); if (!parsed.success) { socket.send(JSON.stringify({ type: "response", requestId: "", ok: false, error: { code: "invalid_message", message: "Invalid request" } })); return; }
    const message = parsed.data;
    console.info(`Gateway request: ${message.type}`);
    let responseData: unknown;
    try {
      if (message.type === "snapshot") socket.send(JSON.stringify(publicSnapshot(message.requestId)));
      else if (message.type === "auth.start") await login();
      else if (message.type === "remote.pair") await pair();
      else if (message.type === "remote.retry") await startRemote();
      else if (message.type === "session.create") {
        if (!acpConnection && !mockMode) throw new Error("Codex is still starting");
        const id = randomUUID();
        // An ACP session is created now to obtain its actual model and effort
        // options, but it remains a local draft until the first prompt.
        const session: SessionState = { id, title: "New task", cwd: workspace, status: "idle", messages: [], tools: [], updatedAt: new Date().toISOString(), draft: true };
        if (!mockMode) {
          console.info(`ACP session/new started for session ${id.slice(0, 8)}`);
          const result = await acpConnection!.agent.request(methods.agent.session.new, { cwd: workspace, mcpServers: [] });
          console.info(`ACP session/new completed for session ${id.slice(0, 8)}`);
          const typedResult = result as { sessionId?: string; configOptions?: unknown };
          const remoteId = typedResult.sessionId;
          if (!remoteId) throw new Error("Codex did not return a session id");
          acpSessionIds.set(id, remoteId);
          applyConfigOptions(session, typedResult.configOptions);
        }
        sessions.set(id, session);
        responseData = { sessionId: id };
        broadcast({ type: "session.patch", sessionId: id, patch: session });
      }
      else if (message.type === "session.select") {
        const session = sessions.get(message.sessionId);
        if (!session) throw new Error("Session not found");
        const remoteId = acpSessionIds.get(message.sessionId);
        if (remoteId) {
          session.messages = [];
          session.tools = [];
          session.plan = undefined;
          session.reasoning = undefined;
          const result = await acpConnection?.agent.request(methods.agent.session.load, { sessionId: remoteId, cwd: workspace, mcpServers: [] });
          applyConfigOptions(session, (result as { configOptions?: unknown } | undefined)?.configOptions);
        }
        socket.send(JSON.stringify(publicSnapshot(message.sessionId)));
      }
      else if (message.type === "session.model.set") {
        const session = sessions.get(message.sessionId);
        const remoteId = acpSessionIds.get(message.sessionId);
        if (!session || !remoteId || !session.model) throw new Error("Model selection is not available for this task");
        if (!session.model.options.some((option) => option.id === message.modelId)) throw new Error("Unsupported Codex model");
        if (session.status === "running") throw new Error("Wait for the current response before changing model");
        const result = await acpConnection?.agent.request(methods.agent.session.setConfigOption, {
          sessionId: remoteId,
          configId: session.model.configId,
          value: message.modelId
        });
        applyConfigOptions(session, (result as { configOptions?: unknown } | undefined)?.configOptions);
        if (session.model) session.model.currentId = message.modelId;
        session.updatedAt = new Date().toISOString();
        broadcast({ type: "session.patch", sessionId: session.id, patch: session });
      }
      else if (message.type === "session.effort.set") {
        const session = sessions.get(message.sessionId);
        const remoteId = acpSessionIds.get(message.sessionId);
        if (!session || !remoteId || !session.effort) throw new Error("Reasoning effort selection is not available for this task");
        if (!session.effort.options.some((option) => option.id === message.effortId)) throw new Error("Unsupported reasoning effort");
        if (session.status === "running") throw new Error("Wait for the current response before changing reasoning effort");
        const result = await acpConnection?.agent.request(methods.agent.session.setConfigOption, {
          sessionId: remoteId,
          configId: session.effort.configId,
          value: message.effortId
        });
        applyConfigOptions(session, (result as { configOptions?: unknown } | undefined)?.configOptions);
        if (session.effort) session.effort.currentId = message.effortId;
        session.updatedAt = new Date().toISOString();
        broadcast({ type: "session.patch", sessionId: session.id, patch: session });
      }
      else if (message.type === "session.rename") { const s = sessions.get(message.sessionId); if (!s) throw new Error("Session not found"); s.title = message.title; broadcast({ type: "session.patch", sessionId: s.id, patch: s }); }
      else if (message.type === "session.archive") sessions.delete(message.sessionId);
      else if (message.type === "prompt.send") {
        const s = sessions.get(message.sessionId); if (!s) throw new Error("Session not found");
        if (s.status === "running") throw new Error("This task is already running");
        const text = message.blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
        if (!text.trim()) throw new Error("Prompt cannot be empty");
        s.messages.push({ id: randomUUID(), role: "user", text, createdAt: new Date().toISOString() });
        if (s.draft) { s.draft = false; s.title = text.replace(/\s+/g, " ").trim().slice(0, 72); }
        s.status = "running"; s.updatedAt = new Date().toISOString(); broadcast({ type: "session.patch", sessionId: s.id, patch: s });
        if (mockMode) { setTimeout(() => { s.messages.push({ id: randomUUID(), role: "assistant", text: `Mock Codex received:\n\n${text}\n\nNo files or Home Assistant services were changed.`, createdAt: new Date().toISOString() }); s.status = "idle"; s.updatedAt = new Date().toISOString(); broadcast({ type: "session.patch", sessionId: s.id, patch: s }); }, 250); }
        else {
          if (!acpConnection) throw new Error("Codex ACP is not ready");
          console.info(`ACP prompt started for session ${s.id.slice(0, 8)}`);
          void acpConnection.agent.request(methods.agent.session.prompt, { sessionId: acpSessionIds.get(s.id) ?? s.id, prompt: [{ type: "text", text }] }).then(() => {
            console.info(`ACP prompt completed for session ${s.id.slice(0, 8)}`);
            if (s.status === "running") { s.status = "idle"; if (s.reasoning) s.reasoning.active = false; s.updatedAt = new Date().toISOString(); broadcast({ type: "session.patch", sessionId: s.id, patch: s }); }
          }).catch((error) => { s.status = "error"; if (s.reasoning) s.reasoning.active = false; s.tools.push({ id: randomUUID(), title: "ACP error", kind: "other", status: "failed", output: sanitizeError(error).message }); broadcast({ type: "session.patch", sessionId: s.id, patch: s }); });
        }
      }
      else if (message.type === "prompt.cancel") { const s = sessions.get(message.sessionId); if (s) { s.status = "idle"; broadcast({ type: "session.patch", sessionId: s.id, patch: s }); } }
      socket.send(JSON.stringify({ type: "response", requestId: message.requestId, ok: true, data: responseData }));
    } catch (error) { socket.send(JSON.stringify({ type: "response", requestId: message.requestId, ok: false, error: sanitizeError(error) })); }
  });
  socket.on("close", () => sockets.delete(client));
});
app.setErrorHandler((error, _request, reply) => reply.code(500).send({ error: sanitizeError(error) }));
await app.listen({ host: "0.0.0.0", port });
console.info(`Codex web gateway listening on ${port}`);
void bootstrap();

async function shutdown(): Promise<void> { for (const socket of sockets) socket.close(); loginProcess?.kill("SIGTERM"); acpProcess?.kill("SIGTERM"); await execFileAsync(codex, ["remote-control", "stop"], { cwd: workspace, env: process.env }).catch(() => undefined); await app.close(); process.exit(0); }
process.on("SIGINT", () => void shutdown()); process.on("SIGTERM", () => void shutdown());
