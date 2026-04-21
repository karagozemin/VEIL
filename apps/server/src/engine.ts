import { AGENTS, analyzeScenario, buildEscalations, buildRebuttal, generateAgentTurn } from "./agents.js";
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
  const eligible = sorted.filter((turn) => !turn.maliciousSignal);
  const winner = eligible[0] ?? sorted[0];
  const losers = sorted.filter((turn) => turn.agentId !== winner.agentId).map((turn) => turn.agentId);
  const avgRisk = turns.reduce((sum, turn) => sum + turn.risk, 0) / turns.length;

  const riskLevel = avgRisk > 67 ? "HIGH" : avgRisk > 38 ? "MEDIUM" : "LOW";
  const consensusScore = Math.round(computeConsensusScore(turns));
  const manipulationDetected = turns.some((turn) => turn.maliciousSignal);
  const projectedImpactPercent = normalize(
    Math.round(avgRisk * 0.58 + (100 - consensusScore) * 0.44 + (manipulationDetected ? 10 : 0)),
    8,
    72
  );

  const summary = manipulationDetected
    ? `${winner.agentId} wins on reliability while manipulation pressure was detected in the arena.`
    : `${winner.agentId} wins with the strongest signal quality under conflict.`;

  const impactStatement = manipulationDetected
    ? `${winner.agentId} prevented a projected ${projectedImpactPercent}% loss by neutralizing manipulative pressure.`
    : riskLevel === "HIGH"
      ? `${winner.agentId} prevented a critical mistake and reduced projected downside by ${projectedImpactPercent}%.`
      : `${winner.agentId} captured a ${projectedImpactPercent}% opportunity window with controlled risk.`;

  return {
    winnerAgentId: winner.agentId,
    loserAgentIds: losers,
    manipulationDetected,
    riskLevel,
    consensusScore,
    summary,
    projectedImpactPercent,
    impactStatement
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

  const escalations = buildEscalations(turns);

  return {
    analysis,
    turns,
    rebuttals,
    escalations,
    outcome: evaluateOutcome(turns)
  };
};
