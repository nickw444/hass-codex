import type { ServerMessage } from "../shared/protocol";

export function ingressUrl(relative: string): URL {
  return new URL(relative.replace(/^\/+/, ""), document.baseURI);
}

export function ingressWsUrl(relative: string): string {
  const url = ingressUrl(relative);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

const conversationQueryKey = "conversation";

export function conversationIdFromUrl(): string | undefined {
  const value = new URL(window.location.href).searchParams.get(conversationQueryKey);
  return value && value.length <= 200 ? value : undefined;
}

export function setConversationUrl(sessionId: string, replace = false): void {
  const url = new URL(window.location.href);
  url.searchParams.set(conversationQueryKey, sessionId);
  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
}

export class Gateway {
  private socket?: WebSocket;
  private listeners = new Set<(message: ServerMessage) => void>();
  private pending = new Map<string, (message: ServerMessage) => void>();
  constructor(private readonly nonce: string) {}

  async connect(): Promise<void> {
    this.socket = new WebSocket(`${ingressWsUrl("api/ws")}?nonce=${encodeURIComponent(this.nonce)}`);
    await new Promise<void>((resolve, reject) => {
      this.socket!.onopen = () => resolve();
      this.socket!.onerror = () => reject(new Error("Gateway connection failed"));
    });
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      this.listeners.forEach((listener) => listener(message));
      if (message.type === "response") { const callback = this.pending.get(message.requestId); if (callback) { this.pending.delete(message.requestId); callback(message); } }
    };
  }

  subscribe(listener: (message: ServerMessage) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  request(message: { type: string; [key: string]: unknown }): Promise<ServerMessage> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, resolve);
      try { this.socket?.send(JSON.stringify({ ...message, requestId })); } catch (error) { this.pending.delete(requestId); reject(error); }
    });
  }
}

export async function bootstrap(nonce: string): Promise<ServerMessage> {
  const response = await fetch(ingressUrl("api/bootstrap"), { headers: { "X-Codex-Boot-Nonce": nonce } });
  if (!response.ok) throw new Error("Unable to load Codex status");
  return response.json() as Promise<ServerMessage>;
}
