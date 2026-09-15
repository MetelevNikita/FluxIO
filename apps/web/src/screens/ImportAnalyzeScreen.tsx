import { CalendarClock, Check, ChevronRight, LoaderCircle, Package, Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { inputProfileMismatch, type InputProfile } from "../input-profile";
import type { MediaAsset, ScheduleSlot } from "../types";
import { useI18n } from "../i18n";

interface ImportAnalyzeScreenProps {
  activeSchedule: ScheduleSlot;
  assets: MediaAsset[];
  inputProfile: InputProfile | null;
  onInputProfileChange: (profile: InputProfile) => void;
  onRemoveAsset: (assetId: string) => void;
  onReplaceAsset?: (assetId: string) => Promise<void>;
  busy: boolean;
  currentCount: number;
  futureCount: number;
  onAddFiles: (files: File[]) => void;
  onClear: () => void;
  onProceed: () => void;
  onScheduleChange: (slot: ScheduleSlot) => void;
  onSelectDirectory?: () => Promise<void>;
  onSelectFiles?: () => Promise<void>;
  onSelectSchedule?: (slot: ScheduleSlot) => Promise<void>;
  operationError: string | null;
}

export function ImportAnalyzeScreen({
  activeSchedule,
  assets,
  inputProfile,
  onInputProfileChange,
  onRemoveAsset,
  onReplaceAsset,
  busy,
  currentCount,
  futureCount,
  onAddFiles,
  onClear,
  onProceed,
  onScheduleChange,
  onSelectDirectory,
  onSelectFiles,
  onSelectSchedule,
  operationError,
}: ImportAnalyzeScreenProps) {
  const { tr } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [draft, setDraft] = useState<InputProfile>(() => inputProfile ?? {
    container: "mp4", codec: "h264", width: 1920, height: 1080,
  });
  useEffect(() => {
    if (inputProfile) setDraft(inputProfile);
  }, [inputProfile]);
  const mismatchCount = useMemo(
    () => assets.filter((asset) => inputProfileMismatch(asset, inputProfile).length > 0).length,
    [assets, inputProfile],
  );
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
      <div className="input-profile-card">
        <strong>{tr("Профиль входного видео", "Input video profile")}</strong>
        <label>{tr("Контейнер", "Container")}
          <input onChange={(event) => setDraft({ ...draft, container: event.target.value })} value={draft.container} placeholder="mp4" />
        </label>
        <label>{tr("Кодек", "Codec")}
          <input onChange={(event) => setDraft({ ...draft, codec: event.target.value })} value={draft.codec} placeholder="h264" />
        </label>
        <label>{tr("Ширина", "Width")}
          <input min={1} onChange={(event) => setDraft({ ...draft, width: Number(event.target.value) })} type="number" value={draft.width || ""} />
        </label>
        <label>{tr("Высота", "Height")}
          <input min={1} onChange={(event) => setDraft({ ...draft, height: Number(event.target.value) })} type="number" value={draft.height || ""} />
        </label>
        <button disabled={!draft.container.trim() || !draft.codec.trim() || !Number.isInteger(draft.width) || draft.width < 1 || !Number.isInteger(draft.height) || draft.height < 1}
          onClick={() => onInputProfileChange({ ...draft, container: draft.container.trim().replace(/^\./, "").toLowerCase(), codec: draft.codec.trim().toLowerCase() })}
          type="button">{inputProfile ? tr("Обновить профиль", "Update profile") : tr("Создать профиль", "Create profile")}</button>
        <span>{inputProfile
          ? `${inputProfile.container.toUpperCase()} · ${inputProfile.codec.toUpperCase()} · ${inputProfile.width}×${inputProfile.height} · ${tr("несовпадений", "mismatches")}: ${mismatchCount}`
          : tr("Создайте профиль перед импортом видео", "Create a profile before importing video")}</span>
      </div>
      <div className="schedule-tabs import-schedule-tabs">
        <button
          className={activeSchedule === "current" ? "active" : ""}
          onClick={() => onScheduleChange("current")}
          type="button"
        >{tr("Текущий импорт", "Current import")} <span>{currentCount}</span></button>
        <button
          className={activeSchedule === "future" ? "active" : ""}
          onClick={() => onScheduleChange("future")}
          type="button"
        >{tr("Будущий импорт", "Future import")} <span>{futureCount}</span></button>
      </div>
      <div className="section-heading">
        <div>
          <h1>{activeSchedule === "current"
            ? tr("Текущая медиатека", "Current Media Library")
            : tr("Будущая медиатека", "Future Media Library")}</h1>
          <p>
            {tr(
              "Добавьте папки, карты памяти или отдельные файлы для подробного анализа потоков.",
              "Ingest camera cards, directories, or standalone assets for deep stream parsing.",
            )}
          </p>
        </div>
        <div className="library-heading-actions">
          <button
            className="secondary-button schedule-import-button"
            disabled={busy || !onSelectSchedule || !inputProfile}
            onClick={() => void onSelectSchedule?.(activeSchedule)}
            title={onSelectSchedule ? undefined : tr("Импорт расписания доступен в Electron", "Schedule import is available in Electron")}
            type="button"
          >
            <CalendarClock size={16} /> {tr("Импорт", "Import")} {activeSchedule === "current"
              ? tr("текущего", "Current") : tr("будущего", "Future")} .AIR/.TXT
          </button>
          <button
            className="secondary-button"
            disabled={busy || !inputProfile}
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
            {busy ? tr("Анализ…", "Analyzing…") : tr("Добавить отдельные файлы", "Add Standalone Files")}
          </button>
        </div>
        <span className={`library-readiness ${allReady ? "ready" : busy ? "busy" : ""}`}>
          {busy ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}
          {busy ? tr("Анализ…", "Analyzing…") : `${readyCount}/${assets.length} ${tr("готово", "ready")}`}
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
        disabled={busy || !inputProfile}
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
        <strong>{tr("Перетащите сюда папку с видеофайлами", "Drop folder with video files here")}</strong>
        <span>
          {busy
            ? tr("Чтение метаданных через ffprobe…", "Reading media metadata with ffprobe…")
            : tr(
                "Поддерживаются ProRes, DNxHD, H.264, H.265 и папки с контейнерами.",
                "Supports ProRes, DNxHD, H.264, H.265 raw container directories",
              )}
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
                <th>{tr("Превью", "Preview")}</th>
                <th>{tr("Имя файла", "File name")}</th>
                <th>{tr("Длительность", "Duration")}</th>
                <th>{tr("Кодек", "Codec")}</th>
                <th>{tr("Разрешение", "Resolution")}</th>
                <th>FPS</th>
                <th>{tr("Битрейт", "Bitrate")}</th>
                <th>{tr("Размер", "Size")}</th>
                <th>{tr("Статус", "Status")}</th>
                <th>{tr("Действия", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => {
                const mismatch = inputProfileMismatch(asset, inputProfile);
                return <tr className={mismatch.length ? "input-profile-mismatch" : undefined} key={asset.id} title={mismatch.join("; ")}>
                  <td>
                    <img alt="" className="asset-thumbnail" src={asset.preview} />
                  </td>
                  <td>
                    <strong className="asset-name">{asset.name}</strong>
                    <span className="asset-hash">SHA-256 {tr("ПРОВЕРЕН", "PARSED")}</span>
                  </td>
                  <td className="mono">{asset.duration}</td>
                  <td className="mono">{asset.codec}</td>
                  <td className="mono">{asset.resolution}</td>
                  <td className="mono">{asset.fps}</td>
                  <td className="mono">{asset.bitrate}</td>
                  <td className="mono">{asset.size}</td>
                  <td className="status-cell">
                    {mismatch.length ? <span className="asset-status error"><TriangleAlert size={11} /> {tr("Не соответствует", "Mismatch")}</span> : <AssetStatus status={asset.status} />}
                  </td>
                  <td className="asset-actions">
                    {onReplaceAsset ? <button aria-label={`${tr("Заменить", "Replace")} ${asset.name}`} onClick={() => void onReplaceAsset(asset.id)} title={tr("Заменить файл", "Replace file")} type="button"><RefreshCw size={14} /></button> : null}
                    <button aria-label={`${tr("Удалить", "Remove")} ${asset.name}`} onClick={() => onRemoveAsset(asset.id)} title={tr("Удалить строку", "Remove row")} type="button"><Trash2 size={14} /></button>
                  </td>
                </tr>;
              })}
              {assets.length === 0 ? (
                <tr>
                  <td className="empty-library" colSpan={10}>
                    {activeSchedule === "future"
                      ? tr("Будущий импорт пуст. Загрузите следующее расписание или добавьте файлы.", "Future import is empty. Load the next schedule or add standalone files.")
                      : tr("Текущий импорт пуст. Перетащите папку или добавьте файлы.", "Current import is empty. Drop a folder or add standalone files.")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ingestion-summary">
        <div className="summary-metrics">
          <SummaryMetric label={tr("Проанализировано:", "Analyzed Assets:")} value={`${assets.length} ${tr("файлов", "Files")}`} />
          <SummaryMetric label={tr("Общая длительность:", "Total Duration:")} value={formatDuration(totalDuration)} />
          <SummaryMetric label={tr("Общий объём:", "Aggregate Payload:")} value={formatSize(totalSize)} />
        </div>
        <div className="summary-actions">
          <button
            className="ghost-button"
            disabled={assets.length === 0 || busy}
            onClick={onClear}
            type="button"
          >
            {tr("Очистить очередь", "Clear Queue")}
          </button>
          <button
            className="primary-button"
            disabled={!allReady || busy}
            onClick={onProceed}
            type="button"
          >
            {tr("Перейти к плейлисту", "Proceed to Playlist")}
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </main>
  );
}

function AssetStatus({ status }: { status: MediaAsset["status"] }) {
  const { tr } = useI18n();
  const label = status === "analyzed"
    ? tr("Готово", "Done")
    : status === "pending"
      ? tr("Анализ", "Analyzing")
      : status === "error"
        ? tr("Ошибка", "Error")
        : tr("Готов", "Ready");
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
