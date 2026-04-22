import { config as dotenvConfig } from "dotenv";
import cors from "cors";
import express from "express";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import { Server } from "socket.io";
import type { Socket } from "socket.io";
import { isAddress, verifyMessage } from "viem";
import { z } from "zod";
import { AGENTS } from "./agents.js";
import { getDeterministicDemoRound } from "./demoRound.js";
import { runConflictRound } from "./engine.js";
import { runLiveConflictRound } from "./liveAgents.js";
import { createSeededRandom } from "./random.js";
import { MatchEvent, MatchMode } from "./types.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const repositoryRoot = path.resolve(currentDir, "../../..");

dotenvConfig();
dotenvConfig({ path: path.join(repositoryRoot, ".env"), override: false });

const detectLlmProviderHint = () => {
  const baseUrl = process.env.VEIL_LLM_BASE_URL?.trim().toLowerCase() ?? "";
  if (!baseUrl) {
    return "default-openai-compatible";
  }
  if (baseUrl.includes("dgrid")) {
    return "dgrid";
  }
  if (baseUrl.includes("groq")) {
    return "groq";
  }
  if (baseUrl.includes("openai")) {
    return "openai";
  }
  return "custom-openai-compatible";
};

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "veil-server",
    liveAiConfigured: Boolean(process.env.VEIL_LLM_API_KEY?.trim()),
    llmBaseUrlConfigured: Boolean(process.env.VEIL_LLM_BASE_URL?.trim()),
    llmModelConfigured: Boolean(process.env.VEIL_LLM_MODEL?.trim()),
    llmProviderHint: detectLlmProviderHint()
  });
});

app.get("/agents", (_req: Request, res: Response) => {
  res.json({ agents: AGENTS });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const scenarioSchema = z.object({
  scenario: z.string().min(3),
  sessionId: z.string().optional(),
  mode: z.enum(["simulation", "live-ai", "demo"]).optional(),
  liveAuthToken: z.string().min(12).optional()
});

const challengeSchema = z.object({
  address: z.string(),
  chainId: z.number().optional()
});

const verifySchema = z.object({
  address: z.string(),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/)
});

type LiveChallenge = {
  message: string;
  nonce: string;
  chainId: number;
  expiresAt: number;
};

type LiveToken = {
  address: string;
  expiresAt: number;
};

const liveChallenges = new Map<string, LiveChallenge>();
const liveTokens = new Map<string, LiveToken>();

const CHALLENGE_TTL_MS = 3 * 60 * 1000;
const LIVE_TOKEN_TTL_MS = 20 * 60 * 1000;
const BNB_MAINNET_CHAIN_ID = 56;
const BNB_TESTNET_CHAIN_ID = 97;
const SUPPORTED_BNB_CHAIN_IDS = new Set([BNB_MAINNET_CHAIN_ID, BNB_TESTNET_CHAIN_ID]);

const nowMs = () => Date.now();

const toAddressKey = (value: string) => value.toLowerCase();

const purgeExpiredAuthState = () => {
  const current = nowMs();

  for (const [addressKey, challenge] of liveChallenges.entries()) {
    if (challenge.expiresAt <= current) {
      liveChallenges.delete(addressKey);
    }
  }

  for (const [token, session] of liveTokens.entries()) {
    if (session.expiresAt <= current) {
      liveTokens.delete(token);
    }
  }
};

const chainName = (chainId: number) => (chainId === BNB_TESTNET_CHAIN_ID ? "BNB Chain Testnet" : "BNB Chain");

const buildChallengeMessage = (address: string, chainId: number, nonce: string, expiresAt: number) => {
  const issuedAt = new Date().toISOString();
  const expiresAtIso = new Date(expiresAt).toISOString();

  return [
    "VEIL LIVE AUTHORIZATION",
    "",
    "Sign this message to enable LIVE AI mode.",
    "This is an off-chain signature and costs no gas.",
    "",
    `Address: ${address}`,
    `Chain: ${chainName(chainId)} (${chainId})`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expires At: ${expiresAtIso}`
  ].join("\n");
};

app.post("/auth/challenge", (req: Request, res: Response) => {
  purgeExpiredAuthState();

  const parsed = challengeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid challenge payload" });
    return;
  }

  const rawAddress = parsed.data.address.trim();
  if (!isAddress(rawAddress)) {
    res.status(400).json({ message: "Invalid wallet address" });
    return;
  }

  if (parsed.data.chainId !== undefined && !SUPPORTED_BNB_CHAIN_IDS.has(parsed.data.chainId)) {
    res.status(400).json({ message: "BNB Chain required for LIVE AI signature" });
    return;
  }

  const addressKey = toAddressKey(rawAddress);
  const requestedChainId = parsed.data.chainId ?? BNB_MAINNET_CHAIN_ID;
  const nonce = randomUUID();
  const expiresAt = nowMs() + CHALLENGE_TTL_MS;
  const message = buildChallengeMessage(rawAddress, requestedChainId, nonce, expiresAt);

  liveChallenges.set(addressKey, { message, nonce, chainId: requestedChainId, expiresAt });

  res.json({
    address: rawAddress,
    chainId: requestedChainId,
    nonce,
    message,
    expiresAt
  });
});

app.post("/auth/verify", async (req: Request, res: Response) => {
  purgeExpiredAuthState();

  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid verify payload" });
    return;
  }

  const rawAddress = parsed.data.address.trim();
  if (!isAddress(rawAddress)) {
    res.status(400).json({ message: "Invalid wallet address" });
    return;
  }

  const addressKey = toAddressKey(rawAddress);
  const challenge = liveChallenges.get(addressKey);

  if (!challenge || challenge.expiresAt <= nowMs()) {
    liveChallenges.delete(addressKey);
    res.status(401).json({ message: "Challenge expired. Request a new signature challenge." });
    return;
  }

  const isValid = await verifyMessage({
    address: rawAddress as `0x${string}`,
    message: challenge.message,
    signature: parsed.data.signature as `0x${string}`
  });

  if (!isValid) {
    res.status(401).json({ message: "Invalid signature" });
    return;
  }

  const token = randomUUID();
  const expiresAt = nowMs() + LIVE_TOKEN_TTL_MS;
  liveTokens.set(token, { address: addressKey, expiresAt });
  liveChallenges.delete(addressKey);

  res.json({
    token,
    expiresAt,
    address: rawAddress,
    chainId: challenge.chainId
  });
});

const emitMatchEvent = (sessionId: string, payload: MatchEvent) => {
  io.to(sessionId).emit("match:event", payload);
};

const dramaOrder = ["manipulator", "trader", "risk", "strategist", "chaos"];

const orderByDrama = <T extends { agentId: string }>(items: T[]) => {
  const score = (agentId: string) => {
    const index = dramaOrder.indexOf(agentId);
    return index < 0 ? dramaOrder.length : index;
  };
  return [...items].sort((left, right) => score(left.agentId) - score(right.agentId));
};

io.on("connection", (socket: Socket) => {
  socket.on("match:join", (sessionId: string) => {
    socket.join(sessionId);
    socket.emit("match:joined", { sessionId });
  });

  socket.on("scenario:start", async (rawInput: unknown) => {
    const parsed = scenarioSchema.safeParse(rawInput);
    if (!parsed.success) {
      socket.emit("match:error", {
        message: "Invalid scenario input"
      });
      return;
    }

    const sessionId = parsed.data.sessionId ?? `match_${Math.random().toString(36).slice(2, 9)}`;
    const inputScenario = parsed.data.scenario.trim();
    const requestedMode = parsed.data.mode ?? "simulation";
    purgeExpiredAuthState();

    const requestedLiveAuthToken = parsed.data.liveAuthToken?.trim();
    const liveAuthSession = requestedLiveAuthToken ? liveTokens.get(requestedLiveAuthToken) : undefined;
    const liveAiAvailable = Boolean(process.env.VEIL_LLM_API_KEY?.trim());
    const requestedLiveAiWithoutKey = requestedMode === "live-ai" && !liveAiAvailable;
    const requestedLiveAiWithoutSignature = requestedMode === "live-ai" && (!requestedLiveAuthToken || !liveAuthSession || liveAuthSession.expiresAt <= nowMs());
    let resolvedMode: MatchMode = requestedMode === "live-ai" && liveAiAvailable ? "live-ai" : requestedMode === "demo" ? "demo" : "simulation";
    let scenario = inputScenario;

    socket.join(sessionId);

    if (requestedLiveAiWithoutKey) {
      socket.emit("match:warning", {
        sessionId,
        message: "LIVE AI unavailable: missing API key, simulation fallback used"
      });
    }

    if (requestedLiveAiWithoutSignature) {
      resolvedMode = "simulation";
      socket.emit("match:warning", {
        sessionId,
        message: "LIVE AI locked: sign with BNB wallet first, simulation fallback used"
      });
    }

    let turns: ReturnType<typeof runConflictRound>["turns"];
    let rebuttals: ReturnType<typeof runConflictRound>["rebuttals"];
    let escalations: ReturnType<typeof runConflictRound>["escalations"];
    let outcome: ReturnType<typeof runConflictRound>["outcome"];

    if (resolvedMode === "demo") {
      const demoRound = getDeterministicDemoRound(inputScenario);
      scenario = demoRound.scenario;
      turns = demoRound.turns;
      rebuttals = demoRound.rebuttals;
      escalations = demoRound.escalations;
      outcome = demoRound.outcome;
    } else if (resolvedMode === "live-ai") {
      try {
        const liveRound = await runLiveConflictRound(scenario);
        turns = liveRound.turns;
        rebuttals = liveRound.rebuttals;
        escalations = liveRound.escalations;
        outcome = liveRound.outcome;
      } catch (error) {
        resolvedMode = "simulation";
        const fallbackRound = runConflictRound(scenario, createSeededRandom(`${sessionId}:${scenario}:fallback`));
        turns = fallbackRound.turns;
        rebuttals = fallbackRound.rebuttals;
        escalations = fallbackRound.escalations;
        outcome = {
          ...fallbackRound.outcome,
          summary: `LIVE AI failed, simulation fallback used. ${fallbackRound.outcome.summary}`
        };
        socket.emit("match:warning", {
          sessionId,
          message: error instanceof Error ? error.message : "LIVE AI failed, fallback used"
        });
      }
    } else {
      const simulationRound = runConflictRound(scenario, createSeededRandom(`${sessionId}:${scenario}:simulation`));
      turns = simulationRound.turns;
      rebuttals = simulationRound.rebuttals;
      escalations = simulationRound.escalations;
      outcome = simulationRound.outcome;
    }

    emitMatchEvent(sessionId, {
      type: "match_started",
      sessionId,
      scenario,
      mode: resolvedMode,
      timestamp: Date.now()
    });

    const thinkingOrder = [...AGENTS].sort((a, b) => b.speed - a.speed);

    thinkingOrder.forEach((agent, index) => {
      setTimeout(() => {
        emitMatchEvent(sessionId, {
          type: "agent_thinking",
          sessionId,
          agentId: agent.id,
          timestamp: Date.now()
        });
      }, index * 260 + 100);
    });

    const orderedTurns = orderByDrama(turns);
    orderedTurns.forEach((turn, index) => {
      setTimeout(() => {
        emitMatchEvent(sessionId, {
          type: "agent_decision",
          sessionId,
          turn,
          timestamp: Date.now()
        });
      }, 720 + index * 520);
    });

    const orderedRebuttals = orderByDrama(rebuttals);
    orderedRebuttals.forEach((rebuttal, index) => {
      setTimeout(() => {
        emitMatchEvent(sessionId, {
          type: "agent_rebuttal",
          sessionId,
          agentId: rebuttal.agentId,
          targetAgentId: rebuttal.targetAgentId,
          text: rebuttal.text,
          timestamp: Date.now()
        });
      }, 2280 + index * 360);
    });

    const orderedEscalations = orderByDrama(escalations);
    orderedEscalations.forEach((escalation, index) => {
      setTimeout(() => {
        emitMatchEvent(sessionId, {
          type: "agent_escalation",
          sessionId,
          agentId: escalation.agentId,
          targetAgentId: escalation.targetAgentId,
          text: escalation.text,
          severity: escalation.severity,
          timestamp: Date.now()
        });
      }, 3000 + index * 380);
    });

    setTimeout(() => {
      emitMatchEvent(sessionId, {
        type: "outcome",
        sessionId,
        mode: resolvedMode,
        ...outcome,
        timestamp: Date.now()
      });
    }, 4680);
  });
});

const PORT = Number(process.env.PORT ?? 8787);
server.listen(PORT, () => {
  console.log(`VEIL server live on http://localhost:${PORT}`);
});
