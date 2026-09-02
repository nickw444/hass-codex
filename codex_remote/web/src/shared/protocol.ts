import { z } from "zod";

export const PromptBlock = z.object({
  type: z.enum(["text", "image"]),
  text: z.string().max(100_000).optional(),
  data: z.string().max(7_000_000).optional(),
  mimeType: z.string().max(100).optional()
});

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), requestId: z.string().uuid(), nonce: z.string().min(32).max(128), selectedSessionId: z.string().optional() }),
  z.object({ type: z.literal("snapshot"), requestId: z.string().uuid() }),
  z.object({ type: z.literal("session.list"), requestId: z.string().uuid() }),
  z.object({ type: z.literal("session.create"), requestId: z.string().uuid() }),
  z.object({ type: z.literal("session.select"), requestId: z.string().uuid(), sessionId: z.string().min(1).max(200) }),
  z.object({ type: z.literal("session.model.set"), requestId: z.string().uuid(), sessionId: z.string().min(1).max(200), modelId: z.string().min(1).max(200) }),
  z.object({ type: z.literal("session.effort.set"), requestId: z.string().uuid(), sessionId: z.string().min(1).max(200), effortId: z.string().min(1).max(200) }),
  z.object({ type: z.literal("session.rename"), requestId: z.string().uuid(), sessionId: z.string(), title: z.string().min(1).max(200) }),
  z.object({ type: z.literal("session.archive"), requestId: z.string().uuid(), sessionId: z.string() }),
  z.object({ type: z.literal("prompt.send"), requestId: z.string().uuid(), sessionId: z.string(), blocks: z.array(PromptBlock).min(1).max(32) }),
  z.object({ type: z.literal("prompt.cancel"), requestId: z.string().uuid(), sessionId: z.string() }),
  z.object({ type: z.literal("permission.respond"), requestId: z.string().uuid(), permissionId: z.string(), optionId: z.string().nullable() }),
  z.object({ type: z.literal("elicitation.respond"), requestId: z.string().uuid(), elicitationId: z.string(), response: z.unknown() }),
  z.object({ type: z.literal("auth.start"), requestId: z.string().uuid() }),
  z.object({ type: z.literal("auth.cancel"), requestId: z.string().uuid() }),
  z.object({ type: z.literal("auth.logout"), requestId: z.string().uuid() }),
  z.object({ type: z.literal("remote.pair"), requestId: z.string().uuid() }),
  z.object({ type: z.literal("remote.retry"), requestId: z.string().uuid() })
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export type PublicSetupState = {
  phase: "validating" | "needs_login" | "login_pending" | "starting_remote" | "starting_acp" | "ready" | "degraded" | "error";
  authenticated: boolean;
  login?: { verificationUrl: string; userCode: string; status: "waiting" | "complete" | "failed"; error?: string };
  remote: { status: "stopped" | "starting" | "connected" | "degraded"; serverName?: string; pairing?: { manualCode: string; expiresAt: string }; error?: string };
  acp: { status: "stopped" | "starting" | "ready" | "degraded"; error?: string };
  homeAssistantMcp: { reachable: boolean };
};

export type SessionMessage = { id: string; role: "user" | "assistant"; text: string; reasoning?: boolean; createdAt: string };
export type SessionConfigSelector = { configId: string; currentId: string; options: Array<{ id: string; label: string }> };
export type SessionModel = SessionConfigSelector;
export type SessionTool = {
  id: string;
  title: string;
  kind: "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";
  status: "pending" | "in_progress" | "completed" | "failed";
  input?: string;
  output?: string;
  locations?: Array<{ path: string; line?: number }>;
  diffs?: Array<{ path: string; oldText?: string; newText: string }>;
};
export type SessionReasoning = { active: boolean; updates: number };
export type SessionSummary = { id: string; title: string; cwd: string; status: "idle" | "running" | "error"; updatedAt?: string; model?: SessionModel; effort?: SessionConfigSelector; draft?: boolean };
export type SessionState = SessionSummary & { messages: SessionMessage[]; tools: SessionTool[]; reasoning?: SessionReasoning; plan?: Array<{ title: string; status: "pending" | "in_progress" | "completed" }> };
export type ServerMessage =
  | { type: "snapshot"; revision: number; setup: PublicSetupState; sessions: SessionSummary[]; selected?: SessionState }
  | { type: "setup.patch"; revision: number; patch: Partial<PublicSetupState> }
  | { type: "session.patch"; revision: number; sessionId: string; patch: Partial<SessionState> }
  | { type: "permission.request"; revision: number; request: { id: string; title: string; options: Array<{ id: string; label: string }> } }
  | { type: "elicitation.request"; revision: number; request: { id: string; title: string; message: string; url?: string } }
  | { type: "response"; requestId: string; ok: boolean; data?: unknown; error?: { code: string; message: string } }
  | { type: "fatal"; error: { code: string; message: string } };
