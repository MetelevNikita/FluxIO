import { LoaderCircle, Server } from "lucide-react";
import type { PlayoutStatus } from "@gruber/contracts";
import type { ConnectionState } from "../App";

interface GlobalStatusBarProps {
  connection: ConnectionState;
  serverAddress: string;
  status: PlayoutStatus | null;
}

export function GlobalStatusBar({
  connection,
  serverAddress,
  status,
}: GlobalStatusBarProps) {
  const progress = status?.progressPercent ?? 0;
  const active = status
    ? ["starting", "running", "stopping"].includes(status.state)
    : false;
  const serverActive = connection.kind === "ready";
  const remaining = Math.max(
    0,
    ((status?.totalDurationSeconds ?? 0) - (status?.outTimeSeconds ?? 0)) /
      Math.max(status?.speed ?? 0, 1),
  );
  return (
    <footer className="global-status-bar">
      <div
        className={`media-server-status ${serverActive ? "active" : "inactive"}`}
        title={connection.kind === "error"
          ? connection.message
          : `Media server ${serverAddress}`}
      >
        <Server aria-hidden="true" size={17} />
        <span className="server-state-dot" aria-hidden="true" />
        <span className="media-server-copy">
          <strong>{serverActive ? "ACTIVE" : "NOT ACTIVE"}</strong>
          <small>{serverAddress}</small>
        </span>
      </div>
      <div className="encoding-file">
        <LoaderCircle className={active ? "spin" : ""} size={16} />
        <span>
          {active ? "On Air:" : "Playout:"}{" "}
          <strong>{status?.currentItemName ?? status?.state ?? "idle"}</strong>
        </span>
      </div>
      <div
        className="global-progress"
        aria-label="Encoding progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        role="progressbar"
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="encoding-summary">
        <span>{progress.toFixed(1)}% Complete</span>
        <i />
        <span className="muted">Est. Remaining: {formatDuration(remaining)}</span>
        <i />
        <span className="speed-tag">×{(status?.speed ?? 0).toFixed(2)} Speed</span>
      </div>
    </footer>
  );
}

function formatDuration(seconds: number): string {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const remaining = whole % 60;
  return [hours, minutes, remaining]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
