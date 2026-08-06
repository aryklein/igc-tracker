"use client";

import { formatDuration } from "@/lib/flightMath";

const SPEEDS = [1, 5, 10, 20, 50, 100, 200];

type PlaybackControlsProps = {
  currentMs: number;
  currentTimestamp: number | null;
  durationMs: number;
  isPlaying: boolean;
  speed: number;
  showNames: boolean;
  showAltitudes: boolean;
  onPlayPause: () => void;
  onReset: () => void;
  onSeek: (elapsedMs: number) => void;
  onSpeedChange: (speed: number) => void;
  onShowNames: (enabled: boolean) => void;
  onShowAltitudes: (enabled: boolean) => void;
};

export function PlaybackControls({
  currentMs,
  currentTimestamp,
  durationMs,
  isPlaying,
  speed,
  showNames,
  showAltitudes,
  onPlayPause,
  onReset,
  onSeek,
  onSpeedChange,
  onShowNames,
  onShowAltitudes,
}: PlaybackControlsProps) {
  const localTime = currentTimestamp
    ? new Date(currentTimestamp).toLocaleTimeString([], {
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";

  return (
    <div className="playback-card">
      <div className="playback-topline">
        <button aria-label={isPlaying ? "Pause" : "Play"} className="icon-button" type="button" onClick={onPlayPause}>
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button aria-label="Reset" className="icon-button" type="button" onClick={onReset}>
          ↺
        </button>
        <div className="show-labels">
          <label>
            <input type="checkbox" checked={showNames} onChange={() => onShowNames(!showNames)} />
            Show Names
          </label>
          <label>
            <input type="checkbox" checked={showAltitudes} onChange={() => onShowAltitudes(!showAltitudes)} />
            Show Altitudes
          </label>
        </div>
        <span>
          {formatDuration(currentMs)} / {formatDuration(durationMs)}
        </span>
      </div>
      <fieldset className="speed-list" aria-label="Playback speed">
        {SPEEDS.map((speedOption) => (
          <button
            className={speedOption === speed ? "active" : ""}
            key={speedOption}
            type="button"
            onClick={() => onSpeedChange(speedOption)}
          >
            {speedOption}x
          </button>
        ))}
      </fieldset>
      <label className="progress-control">
        <span className="progress-heading">
          <span>Flight progress</span>
          <strong>{localTime}</strong>
        </span>
        <input
          aria-label="Flight progress"
          max={durationMs}
          min={0}
          step={1000}
          type="range"
          value={Math.min(currentMs, durationMs)}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </label>
    </div>
  );
}
