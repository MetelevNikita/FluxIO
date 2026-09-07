import {
  CirclePlay,
  FolderOpen,
  Layers3,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { SystemMetrics } from "@gruber/contracts";
import type { ConnectionState } from "../use-media-service";
import type { AppView } from "../types";
import { FluxIoLogo } from "./FluxIoLogo";
import { LanguageSelector } from "./LanguageSelector";
import { useI18n } from "../i18n";

interface AppHeaderProps {
  activeView: AppView;
  connection: ConnectionState;
  onNavigate: (view: AppView) => void;
  systemMetrics: SystemMetrics | null;
}

export function AppHeader({
  activeView,
  connection,
  onNavigate,
  systemMetrics,
}: AppHeaderProps) {
  const { tr } = useI18n();
  const navigation = [
    { id: "import", label: tr("Импорт и анализ", "Import & Analyze"), icon: FolderOpen },
    { id: "effects", label: tr("Эффекты", "Effects"), icon: Layers3 },
    { id: "playlist", label: tr("Плейлист и превью", "Playlist & Preview"), icon: CirclePlay },
    { id: "broadcast", label: tr("Настройки эфира", "Broadcast Settings"), icon: SlidersHorizontal },
  ] as const;
  const [localTime, setLocalTime] = useState(() => formatLocalTime(new Date()));
  const [programmes, setProgrammes] = useState(() => currentProgramme());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLocalTime(formatLocalTime(new Date()));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const bridge = window.gruberDesktop;
    if (!bridge) return;
    let active = true;
    void bridge.getInstancesOverview().then((overview) => {
      if (active) setProgrammes(overview.instances);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const badgeState = connection.kind === "ready"
    ? connection.health.status
    : connection.kind === "loading"
      ? "connecting"
      : "offline";
  const badgeLabel = badgeState === "ready"
    ? tr("ЭФИРНАЯ КОНСОЛЬ", "LIVE CONSOLE")
    : badgeState === "degraded"
      ? tr("ОГРАНИЧЕННО", "DEGRADED")
      : badgeState === "connecting"
        ? tr("ПОДКЛЮЧЕНИЕ", "CONNECTING")
        : tr("НЕТ СВЯЗИ", "OFFLINE");
  const connectionTitle =
    connection.kind === "ready"
      ? `${tr("Медиасервис", "Media service")} ${connection.health.version} ${connection.health.status}`
      : connection.kind === "error"
        ? connection.message
        : tr("Подключение к медиасервису", "Connecting to media service");

  return (
    <header className="console-header">
      <div className="brand-area">
        <FluxIoLogo />
        {window.gruberDesktop ? (
          <select
            aria-label={tr("Выбор программы", "Select programme")}
            className={`programme-selector ${badgeState}`}
            onChange={(event) => {
              const id = event.currentTarget.value;
              if (id === "__overview") void window.gruberDesktop?.showInstances();
              else if (id !== window.gruberDesktop?.instanceId) {
                void window.gruberDesktop?.openInstance(id);
              }
            }}
            title={connectionTitle}
            value={window.gruberDesktop.instanceId}
          >
            {programmes.map((programme) => (
              <option
                disabled={!programme.enabled || !programme.online}
                key={programme.id}
                value={programme.id}
              >
                {programme.name}{!programme.enabled
                  ? ` — ${tr("отключена", "disabled")}`
                  : !programme.online
                    ? ` — ${tr("нет связи", "offline")}`
                    : ""}
              </option>
            ))}
            <option disabled>──────────</option>
            <option value="__overview">{tr("Все программы…", "All programmes…")}</option>
          </select>
        ) : (
          <span
            className={`live-console-badge ${badgeState}`}
            title={connectionTitle}
          >
            {badgeLabel}
          </span>
        )}
      </div>

      <nav className="console-navigation" aria-label={tr("Основная навигация", "Primary navigation")}>
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            className={`nav-tab ${activeView === id ? "active" : ""}`}
            key={id}
            onClick={() => onNavigate(id)}
            type="button"
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="system-metrics" aria-label={tr("Системные метрики", "System metrics")}>
        <Metric
          label="CPU"
          title={tr("Текущая загрузка процессора сервера", "Current server CPU load")}
          value={systemMetrics ? `${systemMetrics.cpuPercent.toFixed(1)}%` : "—"}
        />
        <Metric
          label="NET"
          title={tr("Фактический битрейт исходящего программного потока", "Actual outgoing programme bitrate")}
          value={systemMetrics ? formatNetworkMbps(systemMetrics.networkMbps) : "—"}
        />
        <span className="metric-divider" aria-hidden="true" />
        <time title={localTimeZoneName()}>{localTime}</time>
      </div>
      <div className="header-language"><LanguageSelector /></div>
    </header>
  );
}

function currentProgramme() {
  const bridge = window.gruberDesktop;
  return bridge ? [{
    id: bridge.instanceId,
    name: bridge.instanceName,
    enabled: true,
    online: true,
  }] : [];
}

function Metric({
  label,
  title,
  value,
}: {
  label: string;
  title: string;
  value: string;
}) {
  return (
    <span className="metric" title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function formatNetworkMbps(value: number): string {
  return `${value < 1 ? value.toFixed(2) : value.toFixed(1)} Mbps`;
}

/** Часы шапки идут по времени той машины, на которой запущено приложение. */
function formatLocalTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

function localTimeZoneName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Местное время";
}
