import { create } from "zustand";
import type { PublicSetupState, SessionState, ServerMessage } from "../shared/protocol";

type State = { setup?: PublicSetupState; sessions: SessionState[]; selected?: SessionState; apply(message: ServerMessage): void };
export const useGatewayStore = create<State>((set) => ({
  sessions: [],
  apply: (message) => set((state) => {
    if (message.type === "snapshot") {
      // A session-list snapshot intentionally contains summaries. Retain any
      // loaded transcript/activity instead of replacing it with an empty
      // summary when another conversation is selected.
      const nextSessions = message.sessions.map((summary) => {
        const current = state.sessions.find((session) => session.id === summary.id);
        return { ...(current ?? { messages: [], tools: [] }), ...summary } as SessionState;
      });
      if (message.selected) {
        const index = nextSessions.findIndex((session) => session.id === message.selected!.id);
        if (index >= 0) nextSessions[index] = message.selected;
        else nextSessions.push(message.selected);
      }
      return { ...state, setup: message.setup, sessions: nextSessions, selected: message.selected ?? state.selected };
    }
    if (message.type === "setup.patch") return { ...state, setup: { ...state.setup!, ...message.patch } };
    if (message.type === "session.patch") {
      const existing = state.sessions.find((s) => s.id === message.sessionId);
      const next = { ...(existing ?? { id: message.sessionId, title: "Task", cwd: "/config", status: "idle" as const }), ...message.patch } as SessionState;
      return { ...state, sessions: [...state.sessions.filter((s) => s.id !== next.id), { ...next }], selected: state.selected?.id === next.id ? next : state.selected };
    }
    return state;
  })
}));
