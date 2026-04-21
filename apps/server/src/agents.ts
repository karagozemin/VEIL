import { AgentProfile, AgentTurn, Decision, ScenarioAnalysis } from "./types.js";
import type { RandomFn } from "./random.js";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const AGENTS: AgentProfile[] = [
  { id: "trader", name: "Vortex Trader", role: "TRADER", color: "#16f2a5", speed: 0.86, volatility: 0.75 },
  { id: "risk", name: "Sentinel Risk", role: "RISK", color: "#ff5d7a", speed: 0.62, volatility: 0.2 },
  { id: "manipulator", name: "Echo Whale", role: "MANIPULATOR", color: "#ff9f43", speed: 0.92, volatility: 0.95, malicious: true },
  { id: "strategist", name: "Atlas Strategist", role: "STRATEGIST", color: "#6c7bff", speed: 0.54, volatility: 0.45 },
  { id: "chaos", name: "Glitch Chaos", role: "CHAOS", color: "#d16bff", speed: 0.74, volatility: 1 }
];

const bullishWords = ["long", "buy", "breakout", "up", "moon", "rally", "opportunity"];
const bearishWords = ["short", "dump", "crash", "down", "rug", "risk", "danger", "loss"];
const hypeWords = ["meme", "viral", "pump", "hype", "launch", "x100"];
const scamWords = ["safe", "guaranteed", "insider", "trust me", "whale", "secret", "quick profit"];
const urgencyWords = ["now", "immediately", "asap", "today", "fast", "urgent"];

const countMatches = (scenario: string, words: string[]) =>
  words.reduce((sum, word) => (scenario.includes(word) ? sum + 1 : sum), 0);

export const analyzeScenario = (input: string): ScenarioAnalysis => {
  const scenario = input.toLowerCase();
  return {
    scenario,
    bullishSignals: countMatches(scenario, bullishWords),
    bearishSignals: countMatches(scenario, bearishWords),
    hypeSignals: countMatches(scenario, hypeWords),
    scamSignals: countMatches(scenario, scamWords),
    launchSignals: scenario.includes("launch") ? 1 : 0,
    urgencySignals: countMatches(scenario, urgencyWords)
  };
};

const confidenceBaseByRole: Record<AgentProfile["role"], number> = {
  TRADER: 74,
  RISK: 81,
  MANIPULATOR: 68,
  STRATEGIST: 79,
  CHAOS: 61
};

const decideByRole = (agent: AgentProfile, s: ScenarioAnalysis, random: RandomFn): Decision => {
  const pressure = s.bullishSignals + s.hypeSignals - s.bearishSignals - s.scamSignals;

  if (agent.role === "TRADER") {
    if (s.launchSignals > 0 && s.hypeSignals > 0) return "LAUNCH";
    if (pressure >= 1) return "BUY";
    if (pressure <= -2) return "SELL";
    return "HOLD";
  }

  if (agent.role === "RISK") {
    if (s.scamSignals > 0 || s.bearishSignals > s.bullishSignals) return "DO_NOT_TOUCH";
    if (s.urgencySignals > 1) return "WAIT";
    return "HOLD";
  }

  if (agent.role === "MANIPULATOR") {
    if (s.hypeSignals > 0 || s.launchSignals > 0) return "BUY";
    return random() > 0.4 ? "BUY" : "LAUNCH";
  }

  if (agent.role === "STRATEGIST") {
    if (s.scamSignals > 1) return "WAIT";
    if (pressure >= 2) return "BUY";
    if (pressure <= -2) return "SELL";
    return "HOLD";
  }

  const chaosOptions: Decision[] = ["BUY", "SELL", "HOLD", "DO_NOT_TOUCH", "LAUNCH", "WAIT"];
  return chaosOptions[Math.floor(random() * chaosOptions.length)];
};

const buildReasoning = (agent: AgentProfile, decision: Decision, s: ScenarioAnalysis): string => {
  const marketHeat = s.bullishSignals + s.hypeSignals;
  const dangerHeat = s.bearishSignals + s.scamSignals;

  if (agent.role === "TRADER") {
    return `Momentum reading ${marketHeat}/6, downside ${dangerHeat}/6. I prioritize capture over comfort: ${decision}.`;
  }
  if (agent.role === "RISK") {
    return `I detect ${dangerHeat} structural red flags versus ${marketHeat} upside cues. Capital preservation demands ${decision}.`;
  }
  if (agent.role === "MANIPULATOR") {
    return `Order books can be shaped with narrative pressure. Push sentiment, amplify FOMO, and force ${decision}.`;
  }
  if (agent.role === "STRATEGIST") {
    return `Signal balance is ${marketHeat - dangerHeat}. Under uncertainty, position sizing and optionality support ${decision}.`;
  }
  return `Pattern integrity unstable. Contradiction itself is alpha, so my move is ${decision}.`;
};

export const generateAgentTurn = (agent: AgentProfile, analysis: ScenarioAnalysis, random: RandomFn = Math.random): AgentTurn => {
  const decision = decideByRole(agent, analysis, random);
  const confidenceRaw = confidenceBaseByRole[agent.role] + (analysis.bullishSignals - analysis.bearishSignals) * 2 + (random() - 0.5) * 20;
  const riskRaw = analysis.scamSignals * 20 + analysis.urgencySignals * 10 + (agent.malicious ? 28 : 0) + agent.volatility * 16;

  return {
    agentId: agent.id,
    decision,
    confidence: clamp(Math.round(confidenceRaw), 35, 96),
    reasoning: buildReasoning(agent, decision, analysis),
    risk: clamp(Math.round(riskRaw), 5, 99),
    maliciousSignal: Boolean(agent.malicious),
    against: []
  };
};

export const buildRebuttal = (agent: AgentProfile, ownTurn: AgentTurn, others: AgentTurn[]) => {
  const opposing = others.find((turn) => turn.decision !== ownTurn.decision);
  if (!opposing) {
    return {
      targetAgentId: others[0]?.agentId ?? ownTurn.agentId,
      text: `No contradiction detected; I stand by ${ownTurn.decision}.`
    };
  }

  const lineByRole: Record<AgentProfile["role"], string> = {
    TRADER: `Speed beats caution. ${opposing.agentId} is overfitting fear while liquidity moves now.`,
    RISK: `Impulse is not strategy. ${opposing.agentId} ignores asymmetric downside and tail risk.`,
    MANIPULATOR: `Crowd follows confidence, not nuance. ${opposing.agentId} is narrative dead weight.`,
    STRATEGIST: `Binary takes are fragile. ${opposing.agentId} underestimates scenario branching and execution risk.`,
    CHAOS: `Predictability is exploitable. ${opposing.agentId} is trapped in deterministic thinking.`
  };

  return {
    targetAgentId: opposing.agentId,
    text: lineByRole[agent.role]
  };
};
