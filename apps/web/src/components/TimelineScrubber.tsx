import { motion } from "framer-motion";
import type { MatchEvent } from "../types";

type Marker = { event: MatchEvent; ratio: number };

type Props = {
  cursorMs: number;
  durationMs: number;
  isPlaying: boolean;
  markers: Marker[];
  onSeek: (nextMs: number) => void;
  onReplay: () => void;
  onPlayPause: () => void;
};

const markerKind = (event: MatchEvent) => {
  if (event.type === "agent_decision") {
    if (event.turn.agentId === "manipulator" || event.turn.maliciousSignal) {
      return "threat";
    }
    return "decision";
  }
  if (event.type === "agent_rebuttal") {
    return "rebuttal";
  }
  if (event.type === "agent_escalation") {
    return "escalation";
  }
  return "outcome";
};

const formatTime = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  const tenths = Math.floor((ms % 1000) / 100);
  return `${seconds}.${tenths}s`;
};

export function TimelineScrubber({ cursorMs, durationMs, isPlaying, markers, onSeek, onReplay, onPlayPause }: Props) {
  return (
    <div className="timeline-scrubber panel">
      <div className="panel-head">
        <h2>REPLAY TIMELINE</h2>
        <span>
          {formatTime(cursorMs)} / {formatTime(durationMs)}
        </span>
      </div>

      <div className="timeline-track-wrap">
        <input
          className="timeline-range"
          type="range"
          min={0}
          max={Math.max(0, durationMs)}
          step={10}
          value={Math.min(cursorMs, durationMs)}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        <div className="timeline-markers">
          {markers.map((marker, index) => (
            <motion.span
              key={`${marker.event.type}-${index}-${marker.event.timestamp}`}
              className={`timeline-marker timeline-marker-${markerKind(marker.event)} ${index % 2 === 0 ? "" : "offset"}`.trim()}
              style={{ left: `${marker.ratio * 100}%` }}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.01 }}
              title={marker.event.type}
            />
          ))}
        </div>
      </div>

      <div className="timeline-controls">
        <button className="control-btn" onClick={onPlayPause}>
          {isPlaying ? "PAUSE" : "PLAY"}
        </button>
        <button className="control-btn" onClick={onReplay}>
          REPLAY
        </button>
      </div>
    </div>
  );
}
