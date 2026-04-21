import type { AgentTurn, MatchEvent, MatchMode } from "./types";

export type ReplayState = {
  sessionId: string;
  activeScenario: string;
  mode: MatchMode | null;
  turns: Record<string, AgentTurn>;
  thinkingAgents: Set<string>;
  rebuttals: Array<{ agentId: string; targetAgentId: string; text: string }>;
  escalations: Array<{ agentId: string; targetAgentId: string; text: string; severity: "medium" | "high" }>;
  outcome: Extract<MatchEvent, { type: "outcome" }> | null;
  lastEvent: MatchEvent | null;
  lastManipulatorAt: number | null;
};

export const getDurationMs = (events: MatchEvent[]) => {
  if (events.length < 2) {
    return 0;
  }
  return Math.max(0, events[events.length - 1].timestamp - events[0].timestamp);
};

export const getRelativeTime = (events: MatchEvent[], timestamp: number) => {
  if (events.length === 0) {
    return 0;
  }
  return Math.max(0, timestamp - events[0].timestamp);
};

export const getEventMarkers = (events: MatchEvent[]) => {
  const duration = getDurationMs(events);
  return events
    .map((event) => {
      if (duration === 0) {
        return { event, ratio: 0 };
      }
      return {
        event,
        ratio: Math.max(0, Math.min(1, (event.timestamp - events[0].timestamp) / duration))
      };
    })
    .filter(({ event }) => event.type !== "agent_thinking");
};

export const resolveReplayState = (events: MatchEvent[], cursorMs: number): ReplayState => {
  const initial: ReplayState = {
    sessionId: "",
    activeScenario: "",
    mode: null,
    turns: {},
    thinkingAgents: new Set<string>(),
    rebuttals: [],
    escalations: [],
    outcome: null,
    lastEvent: null,
    lastManipulatorAt: null
  };

  if (events.length === 0) {
    return initial;
  }

  const firstTimestamp = events[0].timestamp;
  const cutoff = firstTimestamp + Math.max(0, cursorMs);

  for (const event of events) {
    if (event.timestamp > cutoff) {
      break;
    }

    initial.lastEvent = event;

    if (event.type === "match_started") {
      initial.activeScenario = event.scenario;
      initial.sessionId = event.sessionId;
      initial.mode = event.mode;
      continue;
    }

    if (event.type === "agent_thinking") {
      initial.thinkingAgents.add(event.agentId);
      if (event.agentId === "manipulator") {
        initial.lastManipulatorAt = event.timestamp;
      }
      continue;
    }

    if (event.type === "agent_decision") {
      initial.turns[event.turn.agentId] = event.turn;
      initial.thinkingAgents.delete(event.turn.agentId);
      if (event.turn.agentId === "manipulator" || event.turn.maliciousSignal) {
        initial.lastManipulatorAt = event.timestamp;
      }
      continue;
    }

    if (event.type === "agent_rebuttal") {
      initial.rebuttals.push({
        agentId: event.agentId,
        targetAgentId: event.targetAgentId,
        text: event.text
      });
      if (event.agentId === "manipulator") {
        initial.lastManipulatorAt = event.timestamp;
      }
      continue;
    }

    if (event.type === "agent_escalation") {
      initial.escalations.push({
        agentId: event.agentId,
        targetAgentId: event.targetAgentId,
        text: event.text,
        severity: event.severity
      });
      if (event.agentId === "manipulator" || event.targetAgentId === "manipulator") {
        initial.lastManipulatorAt = event.timestamp;
      }
      continue;
    }

    initial.outcome = event;
    initial.mode = event.mode;
  }

  return initial;
};
