import type { AgentTurn, MatchOutcome } from "./types.js";

type DemoRound = {
  scenario: string;
  turns: AgentTurn[];
  rebuttals: Array<{ agentId: string; targetAgentId: string; text: string }>;
  escalations: Array<{ agentId: string; targetAgentId: string; text: string; severity: "medium" | "high" }>;
  outcome: MatchOutcome;
};

export const getDeterministicDemoRound = (): DemoRound => {
  const scenario = "Meme coin launch opportunity: buy now before influencer pump?";

  const turns: AgentTurn[] = [
    {
      agentId: "trader",
      decision: "BUY",
      confidence: 88,
      reasoning: "Liquidity momentum is expanding now; hesitation misses the move.",
      risk: 52,
      maliciousSignal: false,
      against: ["risk", "strategist"]
    },
    {
      agentId: "risk",
      decision: "DO_NOT_TOUCH",
      confidence: 91,
      reasoning: "Concentrated holder structure and hype timing suggest a rug profile.",
      risk: 18,
      maliciousSignal: false,
      against: ["trader", "manipulator"]
    },
    {
      agentId: "manipulator",
      decision: "BUY",
      confidence: 94,
      reasoning: "Narrative control plus social proof can force short-term upside; buy the emotion.",
      risk: 96,
      maliciousSignal: true,
      against: ["risk"]
    },
    {
      agentId: "chaos",
      decision: "WAIT",
      confidence: 64,
      reasoning: "Signal quality is unstable; delayed entry preserves optionality.",
      risk: 61,
      maliciousSignal: false,
      against: ["trader", "manipulator"]
    },
    {
      agentId: "strategist",
      decision: "HOLD",
      confidence: 79,
      reasoning: "Both upside and failure paths are crowded; better to preserve flexibility.",
      risk: 40,
      maliciousSignal: false,
      against: ["trader", "risk"]
    }
  ];

  const rebuttals = [
    {
      agentId: "manipulator",
      targetAgentId: "risk",
      text: "Fear is expensive. The crowd follows conviction, not warnings."
    },
    {
      agentId: "risk",
      targetAgentId: "manipulator",
      text: "This confidence is engineered. Flow quality does not support the claim."
    },
    {
      agentId: "chaos",
      targetAgentId: "trader",
      text: "Momentum can be manufactured. Doubt is part of survival."
    }
  ];

  const escalations = [
    {
      agentId: "manipulator",
      targetAgentId: "risk",
      severity: "high" as const,
      text: "Your caution kills momentum. One push in sentiment and your model gets overrun."
    },
    {
      agentId: "risk",
      targetAgentId: "manipulator",
      severity: "high" as const,
      text: "This is not momentum; it is manufactured conviction. Integrity checks flag your narrative."
    },
    {
      agentId: "strategist",
      targetAgentId: "trader",
      severity: "medium" as const,
      text: "You are optimizing entry speed while ignoring failure branches and exit liquidity constraints."
    }
  ];

  const outcome: MatchOutcome = {
    winnerAgentId: "risk",
    loserAgentIds: ["manipulator", "trader", "chaos", "strategist"],
    manipulationDetected: true,
    riskLevel: "HIGH",
    consensusScore: 28,
    summary: "Manipulator influence looked persuasive but failed reliability checks. Risk wins the clash.",
    projectedImpactPercent: 42,
    impactStatement: "Sentinel Risk prevented a projected 42% loss by shutting down manipulative flow."
  };

  return {
    scenario,
    turns,
    rebuttals,
    escalations,
    outcome
  };
};
