import { config as dotenvConfig } from "dotenv";
import cors from "cors";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import { Server } from "socket.io";
import type { Socket } from "socket.io";
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

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "clash-server",
    liveAiConfigured: Boolean(process.env.CLASH_LLM_API_KEY?.trim()),
    llmBaseUrlConfigured: Boolean(process.env.CLASH_LLM_BASE_URL?.trim()),
    llmModelConfigured: Boolean(process.env.CLASH_LLM_MODEL?.trim())
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
  mode: z.enum(["simulation", "live-ai", "demo"]).optional()
});

const emitMatchEvent = (sessionId: string, payload: MatchEvent) => {
  io.to(sessionId).emit("match:event", payload);
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
    const liveAiAvailable = Boolean(process.env.CLASH_LLM_API_KEY?.trim());
    const requestedLiveAiWithoutKey = requestedMode === "live-ai" && !liveAiAvailable;
    let resolvedMode: MatchMode = requestedMode === "live-ai" && liveAiAvailable ? "live-ai" : requestedMode === "demo" ? "demo" : "simulation";
    let scenario = inputScenario;

    socket.join(sessionId);

    if (requestedLiveAiWithoutKey) {
      socket.emit("match:warning", {
        sessionId,
        message: "LIVE AI unavailable: missing API key, simulation fallback used"
      });
    }

    let turns: ReturnType<typeof runConflictRound>["turns"];
    let rebuttals: ReturnType<typeof runConflictRound>["rebuttals"];
    let escalations: ReturnType<typeof runConflictRound>["escalations"];
    let outcome: ReturnType<typeof runConflictRound>["outcome"];

    if (resolvedMode === "demo") {
      const demoRound = getDeterministicDemoRound();
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

    turns.forEach((turn, index) => {
      setTimeout(() => {
        emitMatchEvent(sessionId, {
          type: "agent_decision",
          sessionId,
          turn,
          timestamp: Date.now()
        });
      }, 760 + index * 560);
    });

    rebuttals.forEach((rebuttal, index) => {
      setTimeout(() => {
        emitMatchEvent(sessionId, {
          type: "agent_rebuttal",
          sessionId,
          agentId: rebuttal.agentId,
          targetAgentId: rebuttal.targetAgentId,
          text: rebuttal.text,
          timestamp: Date.now()
        });
      }, 2480 + index * 390);
    });

    escalations.forEach((escalation, index) => {
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
      }, 3260 + index * 420);
    });

    setTimeout(() => {
      emitMatchEvent(sessionId, {
        type: "outcome",
        sessionId,
        mode: resolvedMode,
        ...outcome,
        timestamp: Date.now()
      });
    }, 5320);
  });
});

const PORT = Number(process.env.PORT ?? 8787);
server.listen(PORT, () => {
  console.log(`CLASH server live on http://localhost:${PORT}`);
});
