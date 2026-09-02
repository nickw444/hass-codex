import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from "react";
import { ActionBarPrimitive, AuiIf, ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from "@assistant-ui/react";
import type { SessionModel, SessionState } from "../shared/protocol";
import { bootstrap, conversationIdFromUrl, Gateway, setConversationUrl } from "./api";
import { useGatewayStore } from "./store";
import { RuntimeProvider } from "./runtime";

declare global { interface Window { codexBootNonce?: string } }

class AppErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Codex UI error", error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="error-screen"><div className="error-card"><h1>Codex UI needs a refresh</h1><p>The gateway is still running. Reload this page to reconnect to your Home Assistant workspace.</p><button onClick={() => location.reload()}>Reload</button></div></div>;
  }
}

export function App() { return <AppErrorBoundary><AppContent /></AppErrorBoundary>; }

function AppContent() {
  const nonce = window.codexBootNonce ?? "";
  const [gateway] = useState(() => new Gateway(nonce));
  const { setup, sessions, selected, apply } = useGatewayStore();
  const [selectedId, setSelectedId] = useState<string | undefined>(() => conversationIdFromUrl());
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let off: () => void = () => undefined;
    void bootstrap(nonce).then(apply).then(() => gateway.connect()).then(() => { off = gateway.subscribe(apply); setConnected(true); }).catch((error) => console.error("Unable to connect to Codex gateway", error));
    return () => off();
  }, [apply, gateway, nonce]);
  useEffect(() => {
    const onPopState = () => setSelectedId(conversationIdFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = (id: string, replace = false) => { setConversationUrl(id, replace); setSelectedId(id); };
  useEffect(() => {
    if (sessions.length === 0) return;
    const hasSelected = selectedId && sessions.some((session) => session.id === selectedId);
    if (!hasSelected) { navigate(sessions[0].id, true); return; }
    if (connected && selected?.id !== selectedId) void gateway.request({ type: "session.select", sessionId: selectedId });
  }, [connected, gateway, selected?.id, selectedId, sessions]);

  // A create/select action updates selectedId immediately, while the gateway
  // snapshot arrives asynchronously. Prefer that local choice so a prompt can
  // never be sent to the previously selected ACP session.
  const active = sessions.find((session) => session.id === selectedId) ?? (selected?.id === selectedId ? selected : undefined);
  const visibleSessions = sessions.filter((session) => !session.draft).sort((left, right) => Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""));
  const create = async () => {
    const response = await gateway.request({ type: "session.create" });
    const id = response.type === "response" && response.ok && response.data && typeof response.data === "object" && "sessionId" in response.data ? String(response.data.sessionId) : undefined;
    if (id) navigate(id);
  };
  const choose = (id: string) => navigate(id);
  const setModel = async (modelId: string) => { if (active) await gateway.request({ type: "session.model.set", sessionId: active.id, modelId }); };
  const setEffort = async (effortId: string) => { if (active) await gateway.request({ type: "session.effort.set", sessionId: active.id, effortId }); };

  if (!setup || setup.phase === "needs_login" || setup.phase === "login_pending") return <Setup setup={setup} gateway={gateway} />;
  return <RuntimeProvider gateway={gateway} sessionId={active?.id} messages={active?.messages ?? []} running={active?.status === "running"}>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">◈</span><span>Codex</span></div>
        <button className="new-task" onClick={() => void create()}><span>＋</span> New task</button>
        <div className="sidebar-label">Tasks</div>
        <nav className="session-list" aria-label="Codex tasks">{visibleSessions.map((session) => <button className={session.id === active?.id ? "selected" : ""} key={session.id} onClick={() => void choose(session.id)}>{session.title}</button>)}</nav>
        <div className="sidebar-footer"><span className={`health-dot ${setup.acp.status}`} /> ACP {setup.acp.status}<span className="sidebar-version">v0.2.0</span></div>
      </aside>
      <main className="chat-panel">
        <header className="chat-header"><div className="workspace-title"><strong>{active?.title ?? "New task"}</strong><span>Home Assistant · /config</span></div><div className="header-actions"><span className={`connection-pill ${setup.phase}`}><span className="health-dot" /> {setup.phase === "ready" ? "Ready" : setup.phase}</span><button className="secondary-button" onClick={() => void gateway.request({ type: "remote.pair" })}>Pair device</button></div></header>
        <ThreadPrimitive.Root className="thread-root">
          <AuiIf condition={(state) => state.thread.isEmpty}><EmptyState model={active?.model} effort={active?.effort} disabled={active?.status === "running"} onModelChange={setModel} onEffortChange={setEffort} /></AuiIf>
          <AuiIf condition={(state) => !state.thread.isEmpty}>
            <ThreadPrimitive.Viewport className="conversation" autoScroll>
              <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
              <ActivityFeed session={active} />
              <ThreadPrimitive.ViewportFooter className="viewport-footer"><ThreadPrimitive.ScrollToBottom className="scroll-to-bottom" aria-label="Scroll to latest message">↓</ThreadPrimitive.ScrollToBottom><Composer model={active?.model} effort={active?.effort} disabled={active?.status === "running"} onModelChange={setModel} onEffortChange={setEffort} /><p className="disclaimer">Codex can make mistakes. Check important Home Assistant changes.</p></ThreadPrimitive.ViewportFooter>
            </ThreadPrimitive.Viewport>
          </AuiIf>
        </ThreadPrimitive.Root>
      </main>
    </div>
  </RuntimeProvider>;
}

function UserMessage() { return <MessagePrimitive.Root className="message-row user-message"><div className="message-body"><MessagePrimitive.Content /></div></MessagePrimitive.Root>; }
function AssistantMessage() { return <MessagePrimitive.Root className="message-row assistant-message"><div className="message-body"><MessagePrimitive.Content /><ActionBarPrimitive.Root className="message-actions"><ActionBarPrimitive.Copy /></ActionBarPrimitive.Root></div></MessagePrimitive.Root>; }
function ActivityFeed({ session }: { session?: SessionState }) {
  if (!session || (!session.reasoning && session.tools.length === 0 && !session.plan?.length)) return null;
  return <section className="activity-feed" aria-label="Codex activity">
    <div className="activity-heading"><span>Activity</span>{session.status === "running" && <span className="activity-live">Working</span>}</div>
    {session.reasoning && <details className="activity-card reasoning-card" open={session.reasoning.active}><summary><span className="activity-icon">◌</span><span>Reasoning</span><span className="activity-status">{session.reasoning.active ? "Thinking" : "Completed"}</span></summary><p>Codex is reasoning through the task. Detailed private reasoning is not displayed.</p></details>}
    {session.plan && session.plan.length > 0 && <details className="activity-card plan-card" open><summary><span className="activity-icon">☷</span><span>Plan</span><span className="activity-status">{session.plan.filter((step) => step.status === "completed").length}/{session.plan.length}</span></summary><ol>{session.plan.map((step, index) => <li className={`plan-${step.status}`} key={`${index}-${step.title}`}><span>{step.status === "completed" ? "✓" : step.status === "in_progress" ? "•" : "○"}</span>{step.title}</li>)}</ol></details>}
    {session.tools.map((tool) => <details className={`activity-card tool-card tool-${tool.status}`} key={tool.id} open={tool.status === "in_progress" || tool.status === "pending"}><summary><span className="activity-icon">{toolIcon(tool.kind)}</span><span className="tool-title">{tool.title}</span><span className="activity-status">{tool.status.replace("_", " ")}</span></summary><div className="tool-details">{tool.locations?.length ? <p className="tool-locations">{tool.locations.map((location) => `${location.path}${location.line ? `:${location.line}` : ""}`).join(", ")}</p> : null}{tool.input && <ToolText label="Input" text={tool.input} />}{tool.output && <ToolText label="Output" text={tool.output} />}{tool.diffs?.map((diff) => <div className="tool-diff" key={diff.path}><strong>{diff.path}</strong><pre><code>{formatDiff(diff.oldText, diff.newText)}</code></pre></div>)}</div></details>)}
  </section>;
}
function toolIcon(kind: SessionState["tools"][number]["kind"]): string { return ({ read: "⌕", edit: "✎", delete: "−", move: "→", search: "⌕", execute: "›_", think: "◌", fetch: "↗", switch_mode: "⇄", other: "•" })[kind]; }
function ToolText({ label, text }: { label: string; text: string }) { return <div className="tool-text"><strong>{label}</strong><pre><code>{text}</code></pre></div>; }
function formatDiff(oldText: string | undefined, newText: string): string { const removed = oldText ? oldText.split("\n").map((line) => `- ${line}`).join("\n") : ""; const added = newText.split("\n").map((line) => `+ ${line}`).join("\n"); return [removed, added].filter(Boolean).join("\n"); }
function EmptyState({ model, effort, disabled, onModelChange, onEffortChange }: { model?: SessionModel; effort?: SessionModel; disabled: boolean; onModelChange: (modelId: string) => void; onEffortChange: (effortId: string) => void }) { return <div className="empty-state"><div className="empty-content"><h1>Where should we begin?</h1><Composer model={model} effort={effort} disabled={disabled} onModelChange={onModelChange} onEffortChange={onEffortChange} /></div></div>; }
function Composer({ model, effort, disabled, onModelChange, onEffortChange }: { model?: SessionModel; effort?: SessionModel; disabled: boolean; onModelChange: (modelId: string) => void; onEffortChange: (effortId: string) => void }) {
  return <ComposerPrimitive.Root className="composer"><ComposerPrimitive.Input placeholder="Ask Codex anything" submitMode="enter" /><div className="composer-footer"><div className="composer-config">{model ? <label className="model-selector"><span className="sr-only">Codex model</span><select value={model.currentId} disabled={disabled} onChange={(event) => onModelChange(event.target.value)} aria-label="Codex model">{model.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : <span className="model-pending">Codex</span>}{effort && <label className="model-selector effort-selector"><span className="sr-only">Reasoning effort</span><select value={effort.currentId} disabled={disabled} onChange={(event) => onEffortChange(event.target.value)} aria-label="Reasoning effort">{effort.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}</div><ComposerPrimitive.Send aria-label="Send prompt"><span>↑</span></ComposerPrimitive.Send></div></ComposerPrimitive.Root>;
}

function Setup({ setup, gateway }: { setup?: ReturnType<typeof useGatewayStore.getState>["setup"]; gateway: Gateway }) {
  const login = setup?.login;
  return <div className="setup"><div className="setup-card"><div className="brand"><span className="brand-mark">◈</span> Codex</div><div className="setup-eyebrow">HOME ASSISTANT WORKSPACE</div><h1>Connect Codex to ChatGPT</h1><p>{login ? "Open the link, sign in, and enter the one-time code." : "The add-on is preparing sign-in."}</p>{login && <><a className="signin-link" href={login.verificationUrl} target="_blank" rel="noopener noreferrer">Open ChatGPT sign-in <span>↗</span></a><code>{login.userCode}</code><button className="primary-button" onClick={() => void gateway.request({ type: "auth.start" })}>Retry sign-in</button></>}<p className="hint">This is the ChatGPT device-login code, not the mobile Remote pairing code. Pairing is available after sign-in.</p></div></div>;
}
