export type Decision = "BUY" | "SELL" | "HOLD" | "DO_NOT_TOUCH" | "LAUNCH" | "WAIT";
export type MatchMode = "simulation" | "live-ai" | "demo";

export interface AgentTurn {
  agentId: string;
  decision: Decision;
  confidence: number;
  reasoning: string;
  risk: number;
  maliciousSignal: boolean;
  against: string[];
}

export type MatchEvent =
  | { type: "match_started"; sessionId: string; scenario: string; mode: MatchMode; timestamp: number }
  | { type: "agent_thinking"; sessionId: string; agentId: string; timestamp: number }
  | { type: "agent_decision"; sessionId: string; turn: AgentTurn; timestamp: number }
  | { type: "agent_rebuttal"; sessionId: string; agentId: string; text: string; targetAgentId: string; timestamp: number }
  | {
      type: "agent_escalation";
      sessionId: string;
      agentId: string;
      targetAgentId: string;
      text: string;
      severity: "medium" | "high";
      timestamp: number;
    }
  | {
      type: "outcome";
      sessionId: string;
      mode: MatchMode;
      winnerAgentId: string;
      loserAgentIds: string[];
      manipulationDetected: boolean;
      riskLevel: "LOW" | "MEDIUM" | "HIGH";
      consensusScore: number;
      summary: string;
      projectedImpactPercent: number;
      impactStatement: string;
      timestamp: number;
    };
