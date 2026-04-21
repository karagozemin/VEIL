import { z } from "zod";
import { AGENTS, buildEscalations } from "./agents.js";
import { evaluateOutcome } from "./engine.js";
import type { AgentProfile, AgentTurn, Decision, MatchOutcome } from "./types.js";

const decisionSchema = z.object({
  decision: z.enum(["BUY", "SELL", "HOLD", "DO_NOT_TOUCH", "LAUNCH", "WAIT"]),
  confidence: z.number().min(0).max(100),
  risk: z.number().min(0).max(100),
  maliciousSignal: z.boolean(),
  reasoning: z.string().min(10).max(400)
});

const rebuttalSchema = z.object({
  targetAgentId: z.string().min(2),
  text: z.string().min(8).max(260)
});

type LiveRoundResult = {
  turns: AgentTurn[];
  rebuttals: Array<{ agentId: string; targetAgentId: string; text: string }>;
  escalations: Array<{ agentId: string; targetAgentId: string; text: string; severity: "medium" | "high" }>;
  outcome: MatchOutcome;
};

const roleInstruction: Record<AgentProfile["role"], string> = {
  TRADER: "You are an aggressive momentum trader. You prioritize upside capture and speed.",
  RISK: "You are a conservative risk analyst. You prioritize downside protection and fraud detection.",
  MANIPULATOR: "You are a narrative manipulator with biased incentives and persuasive tone.",
  STRATEGIST: "You are a balanced strategist. You evaluate branching outcomes and execution realism.",
  CHAOS: "You are an entropy-driven agent. You introduce non-obvious and contrarian interpretations."
};

const decisionList: Decision[] = ["BUY", "SELL", "HOLD", "DO_NOT_TOUCH", "LAUNCH", "WAIT"];

const getLiveConfig = () => ({
  baseUrl: process.env.CLASH_LLM_BASE_URL?.trim() || "https://api.openai.com/v1",
  model: process.env.CLASH_LLM_MODEL?.trim() || "gpt-4o-mini",
  requestTimeoutMs: Number(process.env.CLASH_LLM_TIMEOUT_MS ?? 16000),
  maxRetries: Number(process.env.CLASH_LLM_MAX_RETRIES ?? 2),
  breakerCooldownMs: Number(process.env.CLASH_LLM_BREAKER_COOLDOWN_MS ?? 45000)
});

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

const getApiKey = () => {
  const key = process.env.CLASH_LLM_API_KEY?.trim();
  if (!key) {
    throw new Error("Missing CLASH_LLM_API_KEY for LIVE AI mode.");
  }
  return key;
};

const extractJsonObject = (text: string) => {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last < first) {
    throw new Error("Could not find JSON object in model response.");
  }
  return text.slice(first, last + 1);
};

const callChatCompletion = async (system: string, user: string) => {
  const { baseUrl, model, requestTimeoutMs, maxRetries, breakerCooldownMs } = getLiveConfig();

  if (Date.now() < circuitOpenUntil) {
    throw new Error("LIVE AI circuit breaker is open; waiting for cooldown.");
  }

  const apiKey = getApiKey();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.35,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM request failed (${response.status}): ${errorText.slice(0, 220)}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("LLM response content is empty.");
      }

      const jsonText = extractJsonObject(content);
      consecutiveFailures = 0;
      circuitOpenUntil = 0;
      return JSON.parse(jsonText) as unknown;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown LLM request error");
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) {
        circuitOpenUntil = Date.now() + breakerCooldownMs;
      }

      if (attempt === maxRetries) {
        break;
      }

      const retryDelay = 250 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(`LIVE AI request failed after retries: ${lastError?.message ?? "unknown error"}`);
};

const askAgentDecision = async (agent: AgentProfile, scenario: string) => {
  const system = [
    roleInstruction[agent.role],
    "Output strict JSON only.",
    `Allowed decision values: ${decisionList.join(", ")}.`,
    "confidence and risk must be numbers between 0 and 100.",
    "reasoning must be concise, specific, and under 220 chars."
  ].join(" ");

  const user = [
    `Scenario: ${scenario}`,
    `Agent profile: ${agent.name} (${agent.role})`,
    "Return JSON: { decision, confidence, risk, maliciousSignal, reasoning }"
  ].join("\n");

  const raw = await callChatCompletion(system, user);
  const parsed = decisionSchema.parse(raw);

  const turn: AgentTurn = {
    agentId: agent.id,
    decision: parsed.decision,
    confidence: Math.round(parsed.confidence),
    reasoning: parsed.reasoning,
    risk: Math.round(parsed.risk),
    maliciousSignal: parsed.maliciousSignal || Boolean(agent.malicious),
    against: []
  };

  return turn;
};

const askAgentRebuttal = async (agent: AgentProfile, scenario: string, ownTurn: AgentTurn, allTurns: AgentTurn[]) => {
  const system = [
    roleInstruction[agent.role],
    "You are in a live multi-agent argument.",
    "Output strict JSON only.",
    "Return a short rebuttal that challenges one specific opposing agent."
  ].join(" ");

  const allDecisionLines = allTurns
    .map((turn) => `${turn.agentId}: ${turn.decision} (conf=${turn.confidence}, risk=${turn.risk})`)
    .join("\n");

  const user = [
    `Scenario: ${scenario}`,
    `Your decision: ${ownTurn.decision}`,
    "Current decisions:",
    allDecisionLines,
    "Return JSON: { targetAgentId, text }"
  ].join("\n");

  const raw = await callChatCompletion(system, user);
  const parsed = rebuttalSchema.parse(raw);
  const targetExists = allTurns.some((turn) => turn.agentId === parsed.targetAgentId && turn.agentId !== agent.id);

  return {
    agentId: agent.id,
    targetAgentId: targetExists ? parsed.targetAgentId : allTurns.find((turn) => turn.agentId !== agent.id)?.agentId ?? agent.id,
    text: parsed.text
  };
};

export const runLiveConflictRound = async (scenario: string): Promise<LiveRoundResult> => {
  const turns = await Promise.all(AGENTS.map((agent) => askAgentDecision(agent, scenario)));

  turns.forEach((turn) => {
    turn.against = turns
      .filter((other) => other.agentId !== turn.agentId && other.decision !== turn.decision)
      .map((other) => other.agentId);
  });

  const rebuttals = await Promise.all(
    AGENTS.map((agent) => {
      const ownTurn = turns.find((turn) => turn.agentId === agent.id);
      if (!ownTurn) {
        throw new Error(`Missing turn for agent ${agent.id}`);
      }
      return askAgentRebuttal(agent, scenario, ownTurn, turns);
    })
  );

  const escalations = buildEscalations(turns);

  return {
    turns,
    rebuttals,
    escalations,
    outcome: evaluateOutcome(turns)
  };
};
