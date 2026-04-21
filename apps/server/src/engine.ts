import { AGENTS, analyzeScenario, buildRebuttal, generateAgentTurn } from "./agents.js";
import { AgentTurn, MatchOutcome } from "./types.js";
import type { RandomFn } from "./random.js";

const normalize = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export const computeConsensusScore = (turns: AgentTurn[]) => {
  const uniqueDecisions = new Set(turns.map((turn) => turn.decision)).size;
  const disagreement = normalize(uniqueDecisions * 18 + (100 - turns.reduce((sum, t) => sum + t.confidence, 0) / turns.length) * 0.5, 0, 100);
  return 100 - disagreement;
};

export const evaluateOutcome = (turns: AgentTurn[]): MatchOutcome => {
  const scored = turns.map((turn) => {
    const reliability = turn.confidence - turn.risk - (turn.maliciousSignal ? 18 : 0);
    return { ...turn, reliability };
  });

  const sorted = [...scored].sort((a, b) => b.reliability - a.reliability);
  const winner = sorted[0];
  const losers = sorted.slice(1).map((turn) => turn.agentId);
  const avgRisk = turns.reduce((sum, turn) => sum + turn.risk, 0) / turns.length;

  const riskLevel = avgRisk > 67 ? "HIGH" : avgRisk > 38 ? "MEDIUM" : "LOW";
  const consensusScore = Math.round(computeConsensusScore(turns));
  const manipulationDetected = turns.some((turn) => turn.maliciousSignal);

  const summary = manipulationDetected
    ? `${winner.agentId} wins on reliability while manipulation pressure was detected in the arena.`
    : `${winner.agentId} wins with the strongest signal quality under conflict.`;

  return {
    winnerAgentId: winner.agentId,
    loserAgentIds: losers,
    manipulationDetected,
    riskLevel,
    consensusScore,
    summary
  };
};

export const runConflictRound = (scenario: string, random: RandomFn = Math.random) => {
  const analysis = analyzeScenario(scenario);
  const turns = AGENTS.map((agent) => generateAgentTurn(agent, analysis, random));

  turns.forEach((turn) => {
    turn.against = turns.filter((other) => other.agentId !== turn.agentId && other.decision !== turn.decision).map((other) => other.agentId);
  });

  const rebuttals = AGENTS.map((agent) => {
    const own = turns.find((turn) => turn.agentId === agent.id)!;
    const others = turns.filter((turn) => turn.agentId !== agent.id);
    return {
      agentId: agent.id,
      ...buildRebuttal(agent, own, others)
    };
  });

  return {
    analysis,
    turns,
    rebuttals,
    outcome: evaluateOutcome(turns)
  };
};
