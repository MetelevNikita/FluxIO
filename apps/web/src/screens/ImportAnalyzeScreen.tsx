import { Check, ChevronRight, LoaderCircle, Package, Plus, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import type { MediaAsset } from "../types";

interface ImportAnalyzeScreenProps {
  assets: MediaAsset[];
  busy: boolean;
  onAddFiles: (files: File[]) => void;
  onClear: () => void;
  onProceed: () => void;
  onSelectDirectory?: () => Promise<void>;
  onSelectFiles?: () => Promise<void>;
  operationError: string | null;
}

export function ImportAnalyzeScreen({
  assets,
  busy,
  onAddFiles,
  onClear,
  onProceed,
  onSelectDirectory,
  onSelectFiles,
  operationError,
}: ImportAnalyzeScreenProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const totalDuration = assets.reduce(
    (total, asset) => total + asset.durationSeconds,
    0,
  );
  const totalSize = assets.reduce(
    (total, asset) => total + parseSize(asset.size),
    0,
  );
  const readyCount = assets.filter((asset) => asset.status === "analyzed").length;
  const allReady = assets.length > 0 && readyCount === assets.length;

  function acceptFiles(files: FileList | null) {
    if (files && files.length > 0) {
      onAddFiles(Array.from(files));
    }
  }

  return (
    <main className="import-screen screen-body">
      <div className="section-heading">
        <div>
          <h1>Media Library</h1>
          <p>
            Ingest camera cards, directories, or standalone assets for deep
            stream parsing.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            if (onSelectFiles) {
              void onSelectFiles();
            } else {
              fileInput.current?.click();
            }
          }}
          type="button"
        >
          <Plus size={16} />
          {busy ? "Analyzing…" : "Add Standalone Files"}
        </button>
        <span className={`library-readiness ${allReady ? "ready" : busy ? "busy" : ""}`}>
          {busy ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}
          {busy ? "Analyzing…" : `${readyCount}/${assets.length} ready`}
        </span>
        <input
          accept="video/*,.mxf,.mkv,.ts"
          className="visually-hidden"
          multiple
          onChange={(event) => acceptFiles(event.target.files)}
          ref={fileInput}
          type="file"
        />
      </div>

      <button
        className={`drop-zone ${dragActive ? "drag-active" : ""}`}
        disabled={busy}
        onClick={() => {
          if (onSelectDirectory) {
            void onSelectDirectory();
          } else {
            fileInput.current?.click();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          acceptFiles(event.dataTransfer.files);
        }}
        type="button"
      >
        <span className="drop-icon">
          <Package size={23} />
        </span>
        <strong>Drop folder with video files here</strong>
        <span>
          {busy
            ? "Reading media metadata with ffprobe…"
            : "Supports ProRes, DNxHD, H.264, H.265 raw container directories"}
        </span>
      </button>

      {operationError ? (
        <div className="operation-error" role="alert">{operationError}</div>
      ) : null}

      <div className="media-table-panel">
        <div className="media-table-scroll">
          <table className="media-table">
            <thead>
              <tr>
                <th>Preview</th>
                <th>File name</th>
                <th>Duration</th>
                <th>Codec</th>
                <th>Resolution</th>
                <th>FPS</th>
                <th>Bitrate</th>
                <th>Size</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id}>
                  <td>
                    <img alt="" className="asset-thumbnail" src={asset.preview} />
                  </td>
                  <td>
                    <strong className="asset-name">{asset.name}</strong>
                    <span className="asset-hash">SHA-256 PARSED</span>
                  </td>
                  <td className="mono">{asset.duration}</td>
                  <td className="mono">{asset.codec}</td>
                  <td className="mono">{asset.resolution}</td>
                  <td className="mono">{asset.fps}</td>
                  <td className="mono">{asset.bitrate}</td>
                  <td className="mono">{asset.size}</td>
                  <td className="status-cell">
                    <AssetStatus status={asset.status} />
                  </td>
                </tr>
              ))}
              {assets.length === 0 ? (
                <tr>
                  <td className="empty-library" colSpan={9}>
                    Queue is empty. Drop a folder or add standalone files.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ingestion-summary">
        <div className="summary-metrics">
          <SummaryMetric label="Analyzed Assets:" value={`${assets.length} Files`} />
          <SummaryMetric label="Total Duration:" value={formatDuration(totalDuration)} />
          <SummaryMetric label="Aggregate Payload:" value={formatSize(totalSize)} />
        </div>
        <div className="summary-actions">
          <button
            className="ghost-button"
            disabled={assets.length === 0 || busy}
            onClick={onClear}
            type="button"
          >
            Clear Queue
          </button>
          <button
            className="primary-button"
            disabled={!allReady || busy}
            onClick={onProceed}
            type="button"
          >
            Proceed to Playlist
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </main>
  );
}

function AssetStatus({ status }: { status: MediaAsset["status"] }) {
  const label = status === "analyzed"
    ? "Done"
    : status === "pending"
      ? "Analyzing"
      : status === "error"
        ? "Error"
        : "Ready";
  const Icon = status === "analyzed"
    ? Check
    : status === "error"
      ? TriangleAlert
      : LoaderCircle;
  return (
    <span className={`asset-status ${status}`}>
      <Icon className={status === "pending" ? "spin" : undefined} size={11} />
      {label}
    </span>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function formatDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function parseSize(value: string): number {
  const match = value.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  const unit = match[2]?.toUpperCase() ?? "B";
  const power = ["B", "KB", "MB", "GB", "TB"].indexOf(unit);

  return Number.isFinite(amount) && power >= 0 ? amount * 1024 ** power : 0;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  return `${(bytes / 1024 ** power).toFixed(power > 1 ? 2 : 0)} ${units[power]}`;
}
