import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import type { SessionMessage } from "../shared/protocol";
import { Gateway } from "./api";

function convertMessage(message: SessionMessage): ThreadMessageLike {
  const common = {
    id: message.id,
    role: message.role,
    content: [{ type: "text", text: message.text }],
    metadata: { custom: { reasoning: message.reasoning ?? false } }
  };
  if (message.role === "assistant") return { ...common, status: "complete" } as unknown as ThreadMessageLike;
  return common as unknown as ThreadMessageLike;
}

export function RuntimeProvider({ gateway, sessionId, messages, running, children }: { gateway: Gateway; sessionId?: string; messages: SessionMessage[]; running: boolean; children: React.ReactNode }) {
  const runtime = useExternalStoreRuntime<SessionMessage>({
    messages,
    convertMessage,
    isRunning: running,
    isSendDisabled: running,
    onNew: async (message) => {
      const text = message.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n");
      if (!sessionId) return;
      await gateway.request({ type: "prompt.send", sessionId, blocks: [{ type: "text", text }] });
    },
    onCancel: async () => { if (sessionId) await gateway.request({ type: "prompt.cancel", sessionId }); }
  });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
