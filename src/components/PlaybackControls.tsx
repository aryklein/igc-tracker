"use client";

import { formatDuration } from "@/lib/flightMath";

const SPEEDS = [1, 4, 8, 16, 32];

type PlaybackControlsProps = {
  currentMs: number;
  durationMs: number;
  isPlaying: boolean;
  speed: number;
  onPlayPause: () => void;
  onReset: () => void;
  onSeek: (elapsedMs: number) => void;
  onSpeedChange: (speed: number) => void;
};

export function PlaybackControls({
  currentMs,
  durationMs,
  isPlaying,
  speed,
  onPlayPause,
  onReset,
  onSeek,
  onSpeedChange,
}: PlaybackControlsProps) {
  return (
    <div className="playback-card">
      <div className="playback-topline">
        <button type="button" onClick={onPlayPause}>
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={onReset}>
          Reset
        </button>
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
        <span>Flight progress</span>
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
