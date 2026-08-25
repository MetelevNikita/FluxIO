import {
  AudioLines,
  Captions,
  ChartNoAxesColumnIncreasing,
  Download,
  Eye,
  EyeOff,
  FlagTriangleRight,
  Grid2X2,
  LockKeyhole,
  MapPin,
  Radio,
  Repeat2,
  Rows3,
  Square,
  Upload,
  Video,
} from "lucide-react";
import { memo, useEffect, useId, useRef, useState } from "react";
import type {
  FfmpegCapabilities,
  NetworkInterfaceInfo,
  PlayoutStatus,
  ScheduleStartMarker,
  WorkspaceSessionCheckpoint,
} from "@gruber/contracts";
import { attachHlsVideo } from "../hls-video";
import { usePlayoutStatus } from "../playout-status";
import { getPlayoutAudioLevel } from "../media-api";
import { mediaApiUrl } from "../runtime";
import { useI18n } from "../i18n";
import { ColourBars } from "../components/ColourBars";
import type { BroadcastSettings } from "../types";

interface BroadcastSettingsScreenProps {
  capabilities: FfmpegCapabilities | null;
  networkInterfaces: NetworkInterfaceInfo[];
  onStart: () => void;
  onStartFresh: () => void;
  onStop: () => void;
  operationError: string | null;
  playlistLength: number;
  /**
   * Только состояние сессии. Целый снимок статуса сюда не приходит: он меняется
   * раз в секунду и ломал бы `memo` этого экрана. Живые числа берёт из контекста
   * монитор кодирования — перерисовывается он один.
   */
  playoutState: PlayoutStatus["state"] | null;
  recoveryCheckpoint: WorkspaceSessionCheckpoint | null;
  scheduleStartMarker: ScheduleStartMarker | null;
  scheduleStartItemName: string | null;
  scte35MarkerCount: number;
  settings: BroadcastSettings;
  onSettingsChange: (settings: BroadcastSettings) => void;
  onImportSettings: (file?: File) => Promise<void>;
  onSaveSettings: () => Promise<void>;
  settingsProfileBusy: boolean;
  settingsProfileMessage: string | null;
}

type SettingsUpdater = <Key extends keyof BroadcastSettings>(
  key: Key,
  value: BroadcastSettings[Key],
) => void;

/**
 * Экран обёрнут в `memo`: без этого форма настроек перерисовывалась четыре раза
 * в секунду на опросе статуса, и ввод в полях «залипал». Любой новый проп
 * обязан быть стабильным — иначе memo молча перестаёт работать.
 */
export const BroadcastSettingsScreen = memo(function BroadcastSettingsScreen({
  capabilities,
  networkInterfaces,
  onStart,
  onStartFresh,
  onStop,
  operationError,
  playlistLength,
  playoutState,
  recoveryCheckpoint,
  scheduleStartMarker,
  scheduleStartItemName,
  scte35MarkerCount,
  settings,
  onSettingsChange,
  onImportSettings,
  onSaveSettings,
  settingsProfileBusy,
  settingsProfileMessage,
}: BroadcastSettingsScreenProps) {
  const { tr } = useI18n();
  const settingsFileInput = useRef<HTMLInputElement>(null);
  function update<Key extends keyof BroadcastSettings>(
    key: Key,
    value: BroadcastSettings[Key],
  ) {
    onSettingsChange({ ...settings, [key]: value });
  }

  const active = playoutState
    ? ["starting", "running", "stopping"].includes(playoutState)
    : false;
  const incompatibleScte35Output =
    settings.scte35PlanningEnabled && settings.protocol.startsWith("RTMP");
  const incompatibleSubtitleOutput =
    settings.subtitleOutputMode === "DVB Subtitles" && settings.protocol.startsWith("RTMP");

  return (
    <main className="broadcast-screen screen-body">
      <section className="settings-column">
        <div className="settings-heading settings-heading-row">
          <div>
            <h1>{tr("Настройки кодирования", "Encoding Settings")}</h1>
            <p>
              {tr("Настройте видео, звук, транспорт и параметры выдачи эфирного контура.", "Configure video, audio, transport, and streaming parameters for your broadcast pipeline.")}
            </p>
          </div>
          <div className="playout-actions">
            <button
              aria-pressed={settings.repeatSchedule}
              className={`schedule-repeat-button ${settings.repeatSchedule ? "active" : ""}`}
              disabled={active}
              onClick={() => update("repeatSchedule", !settings.repeatSchedule)}
              title={tr("После последнего ролика начать плейлист заново", "Restart the playlist from the first clip after the last clip finishes")}
              type="button"
            >
              <Repeat2 size={15} /> {tr("Повтор", "Repeat")}
            </button>
            <span className={`playout-state state-${playoutState ?? "idle"}`}>
              {playoutState ?? "idle"}
            </span>
            {active ? (
              <button
                className="danger-button"
                disabled={playoutState === "stopping"}
                onClick={onStop}
                type="button"
              >
                <Square fill="currentColor" size={13} /> {tr("Стоп", "Stop")}
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={
                  playlistLength === 0 ||
                  !settings.streamingEnabled ||
                  incompatibleScte35Output ||
                  incompatibleSubtitleOutput
                }
                onClick={onStart}
                type="button"
              >
                <Radio size={15} /> {recoveryCheckpoint
                  ? tr("Продолжить эфир", "Resume Stream")
                  : scheduleStartMarker
                    ? tr("Старт с метки", "Start from Marker")
                    : tr("Начать эфир", "Start Stream")}
              </button>
            )}
          </div>
        </div>

        <div className="encoding-profile-toolbar">
          <div>
            <strong>{tr("Профиль настроек кодирования", "Encoding settings profile")}</strong>
            <span title={settingsProfileMessage ?? undefined}>
              {settingsProfileMessage ?? tr("Переносимый профиль .txt · пароли никогда не экспортируются", "Portable .txt profile · passwords are never exported")}
            </span>
          </div>
          <div className="encoding-profile-actions">
            <button
              disabled={settingsProfileBusy}
              onClick={() => void onSaveSettings()}
              type="button"
            >
              <Download size={14} /> {tr("Сохранить .TXT", "Save .TXT")}
            </button>
            <button
              disabled={active || settingsProfileBusy}
              onClick={() => window.gruberDesktop
                ? void onImportSettings()
                : settingsFileInput.current?.click()}
              type="button"
            >
              <Upload size={14} /> {tr("Импорт .TXT", "Import .TXT")}
            </button>
            <input
              accept=".txt,text/plain"
              className="visually-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onImportSettings(file);
                event.target.value = "";
              }}
              ref={settingsFileInput}
              type="file"
            />
          </div>
        </div>

        {recoveryCheckpoint ? (
          <div className="recovery-resume-banner" role="status">
            <div>
              <strong>{tr("Найдена точка восстановления прерванного эфира", "Interrupted playout checkpoint found")}</strong>
              <span>
                {tr("Ролик", "Clip")} {recoveryCheckpoint.currentItemIndex + 1}: {recoveryCheckpoint.currentItemName ?? tr("Неизвестно", "Unknown")}
                {" · "}{formatMonitorTime(recoveryCheckpoint.outTimeSeconds)} elapsed
                {" · "}{recoveryCheckpoint.progressPercent.toFixed(1)}%
              </span>
            </div>
            <button disabled={active} onClick={onStartFresh} type="button">
              Start from beginning
            </button>
          </div>
        ) : null}

        {!recoveryCheckpoint && scheduleStartMarker ? (
          <div className="recovery-resume-banner schedule-start-banner" role="status">
            <div>
              <strong><MapPin size={14} /> {tr("Выбран стартовый ролик расписания", "Schedule start clip selected")}</strong>
              <span>{scheduleStartItemName ?? scheduleStartMarker.assetId}</span>
            </div>
            <button disabled={active} onClick={onStartFresh} type="button">
              Start from beginning
            </button>
          </div>
        ) : null}

        {operationError ? (
          <div className="operation-error" role="alert">{operationError}</div>
        ) : null}

        <SettingsCard icon={<Video size={16} />} title={tr("Видеокодек", "Video Codec")}>
          <SelectField
            label={tr("Кодек", "Codec")}
            onChange={(value) => onSettingsChange({
              ...settings,
              videoCodec: value,
              bFrames: value === "MPEG-2 Video"
                ? Math.min(2, settings.bFrames)
                : settings.bFrames,
            })}
            options={codecOptions(capabilities)}
            value={settings.videoCodec}
          />
          <SelectField
            label={tr("Профиль", "Profile")}
            onChange={(value) => update("profile", value)}
            options={["Main Profile", "High Profile", "Main 10"]}
            value={settings.profile}
          />
          <SelectField
            label={tr("Уровень", "Level")}
            onChange={(value) => update("level", value)}
            options={["4.0", "4.1", "5.0", "5.1", "5.2"]}
            value={settings.level}
          />
          <RangeField
            label={tr("Пресет", "Preset")}
            max={100}
            min={0}
            onChange={(value) => update("preset", value)}
            suffix={presetLabel(settings.preset)}
            value={settings.preset}
          />
          <div className="range-extremes">
            <span>ultrafast</span>
            <span>veryslow</span>
          </div>
        </SettingsCard>

        <SettingsCard icon={<Grid2X2 size={16} />} title={tr("Разрешение и частота кадров", "Resolution & Frame Rate")}>
          <div className="dimension-row">
            <NumberField
              label={tr("Ширина", "Width")}
              onChange={(value) => {
                onSettingsChange({
                  ...settings,
                  width: value,
                  height: settings.dimensionsLocked
                    ? Math.round((value / 16) * 9)
                    : settings.height,
                });
              }}
              value={settings.width}
            />
            <button
              aria-label={tr("Сохранить соотношение сторон", "Lock aspect ratio")}
              className={`dimension-lock ${settings.dimensionsLocked ? "active" : ""}`}
              onClick={() =>
                update("dimensionsLocked", !settings.dimensionsLocked)
              }
              type="button"
            >
              <LockKeyhole size={17} />
            </button>
            <NumberField
              label={tr("Высота", "Height")}
              onChange={(value) => update("height", value)}
              value={settings.height}
            />
          </div>
          <SelectField
            label={tr("Частота кадров", "Frame Rate")}
            onChange={(value) => update("frameRate", value)}
            options={[
              "23.976 fps",
              "24.000 fps",
              "25.000 fps",
              "29.970 fps",
              "50.000 fps",
              "59.940 fps",
            ]}
            value={settings.frameRate}
          />
          <SelectField
            label={tr("Порядок полей", "Field Order")}
            onChange={(value) => update("fieldOrder", value)}
            options={[
              { label: tr("Прогрессивная", "Progressive"), value: "progressive" },
              { label: tr("Верхнее поле первым (TFF)", "Upper field first (TFF)"), value: "upper" },
              { label: tr("Нижнее поле первым (BFF)", "Lower field first (BFF)"), value: "lower" },
            ]}
            value={settings.fieldOrder}
          />
          <ToggleField
            checked={settings.deinterlace}
            label={tr("Деинтерлейс-фильтр (YADIF)", "Deinterlace Filter (YADIF)")}
            onChange={(checked) => update("deinterlace", checked)}
          />
        </SettingsCard>

        <SettingsCard icon={<Rows3 size={16} />} title={tr("Структура GOP (I/P/B)", "GOP Structure (I/P/B)")}>
          <div className="three-column-fields">
            <NumberField
              label={tr("Длина GOP (кадры)", "GOP length (frames)")}
              max={600}
              min={1}
              onChange={(value) => update("gopSize", value)}
              value={settings.gopSize}
            />
            <NumberField
              label={tr("Последовательные B-кадры", "Consecutive B-frames")}
              max={settings.videoCodec === "MPEG-2 Video" ? 2 : 16}
              min={0}
              onChange={(value) => update("bFrames", value)}
              value={settings.bFrames}
            />
            <SelectField
              label={tr("Режим GOP", "GOP mode")}
              onChange={(value) => update("closedGop", value === "closed")}
              options={[
                { label: tr("Закрытый GOP", "Closed GOP"), value: "closed" },
                { label: tr("Открытый GOP", "Open GOP"), value: "open" },
              ]}
              value={settings.closedGop ? "closed" : "open"}
            />
          </div>
          <p className="gop-setting-note">
            {gopStructureSummary(settings)}
          </p>
        </SettingsCard>

        <SettingsCard
          icon={<Captions size={16} />}
          title={tr("Выдача субтитров", "Subtitle Output")}
        >
          <SelectField
            disabled={!settings.streamingEnabled}
            label={tr("Режим выдачи", "Delivery mode")}
            onChange={(value) => update(
              "subtitleOutputMode",
              value as BroadcastSettings["subtitleOutputMode"],
            )}
            options={["Burn-in", "DVB Subtitles"]}
            value={settings.subtitleOutputMode}
          />
          <p className="transport-setting-note">
            Burn-in draws enabled SRT files into the video. DVB Subtitles creates a separate,
            receiver-selectable bitmap PID for UDP/SRT MPEG-TS; the original video stays clean.
          </p>
          {settings.subtitleOutputMode === "DVB Subtitles" ? (
            <>
              <div className="three-column-fields">
                <NumberField
                  label={tr("PID субтитров", "Subtitle PID")}
                  max={8_190}
                  min={32}
                  onChange={(value) => update("subtitlePid", Math.min(8_190, Math.max(32, value)))}
                  value={settings.subtitlePid}
                />
                <TextField
                  label={tr("Язык ISO 639", "ISO 639 language")}
                  onChange={(value) => update("subtitleLanguage", value.slice(0, 3))}
                  value={settings.subtitleLanguage}
                />
                <SelectField
                  label={tr("Тип субтитров", "Subtitle type")}
                  onChange={(value) => update(
                    "subtitleType",
                    value as BroadcastSettings["subtitleType"],
                  )}
                  options={["Normal", "Hearing impaired"]}
                  value={settings.subtitleType}
                />
              </div>
              <div className="three-column-fields">
                <TextField
                  label={tr("Гарнитура шрифта", "Font family")}
                  onChange={(value) => update("subtitleFontFamily", value)}
                  value={settings.subtitleFontFamily}
                />
                <NumberField
                  label={tr("Размер шрифта", "Font size")}
                  max={160}
                  min={12}
                  onChange={(value) => update("subtitleFontSize", value)}
                  value={settings.subtitleFontSize}
                />
                <NumberField
                  label={tr("Отступ снизу (px)", "Bottom margin (px)")}
                  max={1_000}
                  min={0}
                  onChange={(value) => update("subtitleBottomMargin", value)}
                  value={settings.subtitleBottomMargin}
                />
              </div>
              <div className="three-column-fields">
                <SelectField
                  label={tr("Цвета палитры", "Palette colours")}
                  onChange={(value) => update(
                    "subtitleMaxColours",
                    Number(value) as BroadcastSettings["subtitleMaxColours"],
                  )}
                  options={["4", "16", "256"]}
                  value={String(settings.subtitleMaxColours)}
                />
                <NumberField
                  label={tr("Резерв битрейта (кбит/с)", "Reserved bitrate (kbps)")}
                  max={2_000}
                  min={32}
                  onChange={(value) => update("subtitleBitrateKbps", value)}
                  value={settings.subtitleBitrateKbps}
                />
                <NumberField
                  label={tr("Смещение PTS (мс)", "PTS offset (ms)")}
                  max={10_000}
                  min={0}
                  onChange={(value) => update("subtitlePtsOffsetMs", value)}
                  value={settings.subtitlePtsOffsetMs}
                />
              </div>
              <div className={`scte35-runtime-note ${incompatibleSubtitleOutput ? "warning" : ""}`}>
                <Captions size={15} />
                <span>
                  {incompatibleSubtitleOutput
                    ? tr("RTMP/FLV не передаёт PID DVB-субтитров. Выберите UDP или SRT.", "RTMP/FLV cannot carry a DVB subtitle PID. Select UDP or SRT.")
                    : tr("Учитываются только ролики с включённым SRT в плейлисте. Сигнализация PMT и дескриптор субтитров создаются автоматически; ID страниц — 1/1. Оставьте смещение PTS равным 0 мс, если не требуется компенсация измеренной задержки приёмника.", "Only clips with SRT enabled in Playlist are included. PMT signalling and the subtitling descriptor are generated automatically; page IDs are 1/1. Keep PTS offset at 0 ms unless a measured receiver delay needs compensation.")}
                </span>
              </div>
            </>
          ) : null}
        </SettingsCard>

        <SettingsCard
          icon={<ChartNoAxesColumnIncreasing size={16} />}
          title={tr("Управление битрейтом", "Bitrate Control")}
        >
          <SelectField
            label={tr("Режим управления", "Rate Control Mode")}
            onChange={(value) => update("rateControl", value)}
            options={["CBR", "VBR", "CRF"]}
            value={settings.rateControl}
          />
          <RangeField
            label={tr("Целевой битрейт", "Target Bitrate")}
            max={50}
            min={1}
            onChange={(value) => update("targetBitrate", value)}
            step={0.5}
            suffix={`${settings.targetBitrate.toFixed(1)} Mbps`}
            value={settings.targetBitrate}
          />
          <div className="range-extremes">
            <span>1 Mbps</span>
            <span>50 Mbps</span>
          </div>
          <div className="two-column-fields">
            <NumberField
              disabled={settings.rateControl !== "VBR"}
              label={tr("Макс. битрейт (Мбит/с)", "Max Bitrate (Mbps)")}
              onChange={(value) => update("maxBitrate", value)}
              step={0.5}
              value={settings.maxBitrate}
            />
            <NumberField
              label={tr("Буфер VBV (кбит)", "VBV Buffer (kbit)")}
              onChange={(value) => update("bufferSize", value)}
              value={settings.bufferSize}
            />
          </div>
          <RangeField
            label="CRF"
            max={51}
            min={0}
            onChange={(value) => update("crf", value)}
            suffix={String(settings.crf)}
            value={settings.crf}
          />
        </SettingsCard>

        <SettingsCard
          headerAction={(
            <ToggleField
              checked={settings.loudnessNormalizationEnabled}
              compact
              label={`${settings.loudnessTargetLufs.toFixed(1)} LUFS`}
              onChange={(checked) => update("loudnessNormalizationEnabled", checked)}
            />
          )}
          icon={<AudioLines size={16} />}
          title={tr("Звук", "Audio")}
        >
          <div className="two-column-fields">
            <SelectField
              label={tr("Кодек", "Codec")}
              onChange={(value) => update("audioCodec", value)}
              options={["AAC-LC", "MP2", "AC-3"]}
              value={settings.audioCodec}
            />
            <SelectField
              label={tr("Частота дискретизации", "Sample Rate")}
              onChange={(value) => update("sampleRate", value)}
              options={["44100 Hz", "48000 Hz", "96000 Hz"]}
              value={settings.sampleRate}
            />
          </div>
          <SelectField
            label={tr("Каналы", "Channels")}
            onChange={(value) => update("channels", value)}
            options={["Mono", "Stereo (L/R)", "5.1"]}
            value={settings.channels}
          />
          <RangeField
            label={tr("Битрейт звука", "Audio Bitrate")}
            max={320}
            min={64}
            onChange={(value) => update("audioBitrate", value)}
            suffix={`${settings.audioBitrate} kbps`}
            value={settings.audioBitrate}
          />
          <div className="range-extremes">
            <span>64 kbps</span>
            <span>320 kbps</span>
          </div>
          <NumberField
            disabled={!settings.loudnessNormalizationEnabled}
            label={tr("Целевая громкость программы (LUFS)", "Programme loudness target (LUFS)")}
            max={-5}
            min={-70}
            onChange={(value) => update(
              "loudnessTargetLufs",
              Math.min(-5, Math.max(-70, value)),
            )}
            step={0.1}
            value={settings.loudnessTargetLufs}
          />
          <p className="transport-setting-note">
            EBU R128 broadcast normalization. When enabled, final programme audio is
            adjusted in real time to {settings.loudnessTargetLufs.toFixed(1)} LUFS,
            with −1 dBTP true-peak and 7 LU loudness-range targets. Disable it to
            preserve the source level unchanged.
          </p>
        </SettingsCard>

        <SettingsCard
          headerAction={
            <ToggleField
              checked={settings.streamingEnabled}
              compact
              label={tr("Включено", "Enabled")}
              onChange={(checked) => update("streamingEnabled", checked)}
            />
          }
          icon={<Radio size={16} />}
          title={tr("Выдача", "Streaming")}
        >
          <SelectField
            disabled={!settings.streamingEnabled}
            label={tr("Протокол", "Protocol")}
            onChange={(value) => update("protocol", value)}
            options={["SRT", "UDP", "RTMP", "RTMPS"]}
            value={settings.protocol}
          />
          {settings.protocol === "UDP" ? (
            <UdpFields
              networkInterfaces={networkInterfaces}
              settings={settings}
              update={update}
            />
          ) : null}
          {settings.protocol === "SRT" ? (
            <SrtFields settings={settings} update={update} />
          ) : null}
          {settings.protocol === "RTMP" || settings.protocol === "RTMPS" ? (
            <>
              <TextField
                disabled={!settings.streamingEnabled}
                label={tr("Адрес сервера", "Server URL")}
                onChange={(value) => update("rtmpServerUrl", value)}
                value={settings.rtmpServerUrl}
              />
              <SecretField
                disabled={!settings.streamingEnabled}
                label={tr("Ключ потока", "Stream Key")}
                onChange={(value) => update("rtmpStreamKey", value)}
                value={settings.rtmpStreamKey}
              />
            </>
          ) : null}
        </SettingsCard>

        <SettingsCard
          headerAction={
            <ToggleField
              checked={settings.scte35PlanningEnabled}
              compact
              label={tr("Планировщик", "Planner")}
              onChange={(checked) => update("scte35PlanningEnabled", checked)}
            />
          }
          icon={<FlagTriangleRight size={16} />}
          title={tr("Рекламные метки SCTE-35", "SCTE-35 Ad Markers")}
        >
          <div className="scte35-planner-summary">
            <div>
              <strong>{scte35MarkerCount}</strong>
              <span>markers in playlist</span>
            </div>
            <p>
              Set defaults here, then place individual Event IDs at the
              playhead in the Playlist tab.
            </p>
          </div>
          <SelectField
            disabled={!settings.scte35PlanningEnabled}
            label={tr("Команда cue", "Cue command")}
            onChange={(value) => update("scte35Command", value)}
            options={[
              "time_signal + segmentation_descriptor",
              "splice_insert (legacy)",
            ]}
            value={settings.scte35Command}
          />
          <div className="two-column-fields">
            <SelectField
              disabled={!settings.scte35PlanningEnabled}
              label={tr("Владелец сегментации", "Segmentation owner")}
              onChange={(value) => update("scte35Owner", value)}
              options={["Provider", "Distributor"]}
              value={settings.scte35Owner}
            />
            <NumberField
              disabled={!settings.scte35PlanningEnabled}
              label={tr("Event ID по умолчанию", "Default Event ID")}
              onChange={(value) => update("scte35DefaultEventId", Math.min(4_294_967_295, value))}
              value={settings.scte35DefaultEventId}
            />
          </div>
          <div className="three-column-fields">
            <NumberField
              disabled={!settings.scte35PlanningEnabled}
              label="SCTE-35 PID"
              onChange={(value) => update("scte35Pid", Math.min(8_190, Math.max(32, value)))}
              value={settings.scte35Pid}
            />
            <NumberField
              disabled={!settings.scte35PlanningEnabled}
              label={tr("Предварительная подача (мс)", "Pre-roll (ms)")}
              onChange={(value) => update("scte35PreRollMs", Math.min(60_000, value))}
              value={settings.scte35PreRollMs}
            />
            <NumberField
              disabled={!settings.scte35PlanningEnabled}
              label={tr("Длительность блока по умолчанию (с)", "Default break (sec)")}
              onChange={(value) => update("scte35DefaultBreakDuration", Math.min(86_400, Math.max(1, value)))}
              value={settings.scte35DefaultBreakDuration}
            />
          </div>
          <div className="two-column-fields">
            <SelectField
              disabled={!settings.scte35PlanningEnabled}
              label={tr("Тип UPID", "UPID type")}
              onChange={(value) => update("scte35UpidType", value)}
              options={["Ad-ID", "UUID", "URI", "None"]}
              value={settings.scte35UpidType}
            />
            <TextField
              disabled={!settings.scte35PlanningEnabled || settings.scte35UpidType === "None"}
              label={tr("UPID по умолчанию", "Default UPID")}
              onChange={(value) => update("scte35DefaultUpid", value)}
              value={settings.scte35DefaultUpid}
            />
          </div>
          <SelectField
            disabled={!settings.scte35PlanningEnabled || !settings.repeatSchedule}
            label={tr("Event ID при повторе плейлиста", "Event IDs when playlist repeats")}
            onChange={(value) => update("scte35LoopEventStrategy", value)}
            options={["Increment each loop", "Reuse playlist Event IDs"]}
            value={settings.scte35LoopEventStrategy}
          />
          <div className={`scte35-runtime-note ${settings.protocol.startsWith("RTMP") ? "warning" : ""}`}>
            <FlagTriangleRight size={15} />
            <span>
              {settings.protocol.startsWith("RTMP")
                ? tr("RTMP/FLV не передаёт PID SCTE-35 в MPEG-TS. Для доставки cue используйте UDP или SRT MPEG-TS.", "RTMP/FLV does not carry the MPEG-TS SCTE-35 PID. Use UDP or SRT MPEG-TS for cue delivery.")
                : tr("FFmpeg передаёт CBR MPEG-TS через инжектор TSDuck. Выходная PMT объявляет PID SCTE-35, а каждая метка выдаётся дважды перед временем события.", "FFmpeg sends CBR MPEG-TS through the TSDuck injector. The output PMT announces the SCTE-35 PID and each marker is emitted twice before its event time.")}
            </span>
          </div>
        </SettingsCard>
      </section>

      <EncodingMonitor />
    </main>
  );
});

function UdpFields({
  networkInterfaces,
  settings,
  update,
}: {
  networkInterfaces: NetworkInterfaceInfo[];
  settings: BroadcastSettings;
  update: SettingsUpdater;
}) {
  const disabled = !settings.streamingEnabled;
  const autoTransportBitrate = calculateAutoTransportBitrateMbps(settings);
  return (
    <>
      <div className="two-column-fields">
        <TextField
          disabled={disabled}
          label="Destination host / multicast"
          onChange={(value) => update("udpHost", value)}
          value={settings.udpHost}
        />
        <NumberField
          disabled={disabled}
          label="Port"
          onChange={(value) => update("udpPort", value)}
          value={settings.udpPort}
        />
      </div>
      <div className="two-column-fields">
        <NumberField
          disabled={disabled}
          label="TS packet size"
          onChange={(value) => update("udpPacketSize", value)}
          value={settings.udpPacketSize}
        />
        <NumberField
          disabled={disabled}
          label="Multicast TTL"
          onChange={(value) => update("udpTtl", value)}
          value={settings.udpTtl}
        />
      </div>
      <SelectField
        disabled={disabled}
        label="Network output interface"
        onChange={(value) => update("udpLocalAddress", value)}
        options={[
          { label: "Automatic routing", value: "" },
          ...networkInterfaces.map((entry) => ({
            label: `${entry.name} — ${entry.address} (${entry.family}${entry.internal ? ", loopback" : ""})`,
            value: entry.address,
          })),
        ]}
        value={settings.udpLocalAddress}
      />
      <div className="udp-section-label">MPEG-TS service</div>
      <div className="two-column-fields">
        <TextField
          disabled={disabled}
          label="Service name"
          onChange={(value) => update("udpServiceName", value)}
          value={settings.udpServiceName}
        />
        <TextField
          disabled={disabled}
          label="Provider"
          onChange={(value) => update("udpProviderName", value)}
          value={settings.udpProviderName}
        />
      </div>
      <div className="two-column-fields">
        <NumberField
          disabled={disabled}
          label="Service number / ID"
          onChange={(value) => update("udpServiceId", value)}
          value={settings.udpServiceId}
        />
        <SelectField
          disabled={disabled}
          label="Input stream type"
          onChange={(value) => update("udpServiceType", value)}
          options={mpegTsServiceTypeOptions}
          value={settings.udpServiceType}
        />
      </div>
      <div className="three-column-fields">
        <NumberField
          disabled={disabled}
          label="Video PID"
          onChange={(value) => update("udpVideoPid", value)}
          value={settings.udpVideoPid}
        />
        <NumberField
          disabled={disabled}
          label="Audio PID"
          onChange={(value) => update("udpAudioPid", value)}
          value={settings.udpAudioPid}
        />
        <NumberField
          disabled={disabled}
          label="PCR interval (ms)"
          onChange={(value) => update("udpPcrPeriodMs", value)}
          value={settings.udpPcrPeriodMs}
        />
      </div>
      <NumberField
        disabled={disabled}
        label={`Transport bitrate (Mbps, 0 = Auto ${autoTransportBitrate.toFixed(1)})`}
        onChange={(value) => update("udpTransportBitrate", value)}
        step={0.5}
        value={settings.udpTransportBitrate}
      />
      <p className="transport-setting-note">
        Target Bitrate controls the video elementary stream. Transport bitrate is the final
        constant MPEG-TS rate including audio, PSI/SI and PID 0x1FFF stuffing. PCR interval is
        enforced on the final UDP stream, including when SCTE-35 is disabled. The applied TS
        payload rate is shown in Encoding Monitor; UDP/IP/Ethernet line rate can be higher.
      </p>
    </>
  );
}

function calculateAutoTransportBitrateMbps(settings: BroadcastSettings): number {
  const videoPeakMbps = settings.rateControl === "CBR"
    ? settings.targetBitrate
    : settings.rateControl === "VBR"
      ? settings.maxBitrate
      : settings.targetBitrate * 2;
  const payloadKbps = videoPeakMbps * 1_000 + settings.audioBitrate;
  return Math.ceil(Math.max(1_000, payloadKbps * 1.18 + 256) / 100) / 10;
}

function SrtFields({
  settings,
  update,
}: {
  settings: BroadcastSettings;
  update: SettingsUpdater;
}) {
  const disabled = !settings.streamingEnabled;
  return (
    <>
      <div className="two-column-fields">
        <TextField
          disabled={disabled}
          label="Host"
          onChange={(value) => update("srtHost", value)}
          value={settings.srtHost}
        />
        <NumberField
          disabled={disabled}
          label="Port"
          onChange={(value) => update("srtPort", value)}
          value={settings.srtPort}
        />
      </div>
      <div className="two-column-fields">
        <SelectField
          disabled={disabled}
          label="Connection mode"
          onChange={(value) => update("srtMode", value)}
          options={["caller", "listener", "rendezvous"]}
          value={settings.srtMode}
        />
        <NumberField
          disabled={disabled}
          label="Latency (ms)"
          onChange={(value) => update("srtLatencyMs", value)}
          value={settings.srtLatencyMs}
        />
      </div>
      <SecretField
        disabled={disabled}
        label="Passphrase (optional)"
        onChange={(value) => update("srtPassphrase", value)}
        value={settings.srtPassphrase}
      />
      <TextField
        disabled={disabled}
        label="Stream ID (optional)"
        onChange={(value) => update("srtStreamId", value)}
        value={settings.srtStreamId}
      />
    </>
  );
}

function EncodingMonitor() {
  // Единственный узел экрана, которому нужен живой статус целиком.
  const status = usePlayoutStatus();
  const [liveAudioLevelDbfs, setLiveAudioLevelDbfs] = useState<number | null>(null);
  const active = status
    ? ["starting", "running", "stopping"].includes(status.state)
    : false;
  const previewUrl = active && status?.previewPath
    ? mediaApiUrl(status.previewPath)
    : null;
  const postTransportPreview = status?.previewPath?.includes("transport-index.m3u8") ?? false;
  const progress = status?.progressPercent ?? 0;
  const remainingSeconds = Math.max(
    0,
    (status?.totalDurationSeconds ?? 0) - (status?.outTimeSeconds ?? 0),
  );
  const clipProgress = status?.currentItemProgressPercent ?? 0;
  const clipRemainingSeconds = Math.max(
    0,
    (status?.currentItemDurationSeconds ?? 0) - (status?.currentItemElapsedSeconds ?? 0),
  );
  const measuredAudioLevelDbfs = liveAudioLevelDbfs ?? status?.audioLevelDbfs;
  const audioLevelDbfs = measuredAudioLevelDbfs ?? -60;
  const audioLevelPercent = Math.max(0, Math.min(100, (audioLevelDbfs + 60) / 60 * 100));

  useEffect(() => {
    if (!active) {
      setLiveAudioLevelDbfs(null);
      return;
    }
    let cancelled = false;
    let requestInFlight = false;
    const refresh = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const level = await getPlayoutAudioLevel();
        if (!cancelled) setLiveAudioLevelDbfs(level);
      } catch {
        // The regular playout status remains the fallback meter source.
      } finally {
        requestInFlight = false;
      }
    };
    void refresh();
    // 100 мс — это 10 запросов в секунду к media-service, который во время
    // эфира и так занят процессами FFmpeg. При любой долгой операции на сервере
    // очередь этих запросов росла, а интерфейс переставал отвечать. 250 мс
    // для индикатора уровня достаточно, а в скрытой вкладке опрос не нужен вовсе.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refresh();
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active]);

  return (
    <aside className="encoding-monitor">
      <div className="monitor-heading">
        <h2>Encoding Monitor</h2>
        <span className={`live-pill ${active ? "" : "inactive"}`}>
          {status?.state ?? "Idle"}
        </span>
      </div>

      <div className="monitor-preview-card">
        <div className="monitor-preview-layout">
        <div className="monitor-preview">
          <LivePreview
            active={active}
            key={`${status?.sessionId ?? "idle"}:${status?.previewPath ?? "none"}`}
            source={previewUrl}
          />
          <span className="decoding-status">
            <i /> {active
              ? postTransportPreview ? "Post-TSDuck TS Monitor" : "Final Program Monitor"
              : "Preview Idle"}
          </span>
          <span className="monitor-resolution">
            {status?.endpointLabel ?? "No endpoint selected"}
          </span>
          {status?.repeatPlaylist ? (
            <span className="monitor-loop">
              <Repeat2 size={12} /> Loop {(status.loopCount ?? 0) + 1}
            </span>
          ) : null}
          <strong>{formatMonitorTime(status?.outTimeSeconds ?? 0)}</strong>
          <span className="monitor-remaining">
            Remaining {formatMonitorTime(remainingSeconds)}
          </span>
        </div>
        <div
          aria-label="Live programme audio level"
          aria-valuemax={0}
          aria-valuemin={-60}
          aria-valuenow={Math.max(-60, audioLevelDbfs)}
          className="live-audio-meter"
          role="meter"
        >
          <span>LEVEL</span>
          <div><i style={{ height: `${audioLevelPercent}%` }} /></div>
          <strong>{measuredAudioLevelDbfs == null ? "−∞" : audioLevelDbfs.toFixed(1)}</strong>
          <small>dBFS</small>
        </div>
        </div>
        <div className="monitor-preview-meta">
          <strong>{status?.currentItemName ?? "Waiting for playout"}</strong>
          <span className="speed-tag">×{(status?.speed ?? 0).toFixed(2)} Speed</span>
        </div>
      </div>

      <div className="monitor-details-scroll">
      <MonitorCard
        action={<span className="muted">{status?.totalItems ?? 0} clips</span>}
        title="Playlist Progress"
      >
        <div className="encoding-jobs">
          <div className="encoding-job">
            <div>
              <strong>{status?.currentItemName ?? "No active clip"}</strong>
              <b>{progress.toFixed(1)}%</b>
            </div>
            <div
              className="job-progress"
              aria-label="Playlist progress"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progress}
              role="progressbar"
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="job-meta">
              <span>Clip {(status?.currentItemIndex ?? 0) + 1} / {status?.totalItems ?? 0}</span>
              <span>Remaining {formatMonitorTime(remainingSeconds)}</span>
            </div>
          </div>
        </div>
      </MonitorCard>

      <MonitorCard
        action={<span className="muted">{formatMonitorTime(clipRemainingSeconds)} left</span>}
        title="Clip Progress"
      >
        <div className="encoding-jobs">
          <div className="encoding-job">
            <div>
              <strong>{status?.currentItemName ?? "No active clip"}</strong>
              <b>{clipProgress.toFixed(1)}%</b>
            </div>
            <div
              className="job-progress"
              aria-label="Clip progress"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={clipProgress}
              role="progressbar"
            >
              <span style={{ width: `${clipProgress}%` }} />
            </div>
            <div className="job-meta">
              <span>{formatMonitorTime(status?.currentItemElapsedSeconds ?? 0)}</span>
              <span>{formatMonitorTime(status?.currentItemDurationSeconds ?? 0)}</span>
            </div>
          </div>
        </div>
      </MonitorCard>

      <MonitorCard
        action={<span className="muted">Current frame: {status?.frame ?? 0}</span>}
        title="Real-time Stats"
      >
        <div className="stats-list">
          <Stat label="Encoding speed" value={`×${(status?.speed ?? 0).toFixed(2)}`} />
          <Stat label="Output FPS" value={(status?.fps ?? 0).toFixed(2)} />
          <Stat label="Elapsed" value={formatMonitorTime(status?.outTimeSeconds ?? 0)} />
          <Stat label="Remaining" value={formatMonitorTime(remainingSeconds)} />
          <Stat label="Total" value={formatMonitorTime(status?.totalDurationSeconds ?? 0)} />
          <Stat
            label="Schedule phase"
            value={status?.schedulePhase === "future" ? "Promoted Future" : "Current"}
          />
          <Stat label="Future queued" value={`${status?.queuedFutureItems ?? 0} clips`} />
          {status?.transportBitrateBps != null ? (
            <>
              <Stat
                label="Applied TS bitrate"
                value={`${(status.transportBitrateBps / 1_000_000).toFixed(3)} Mbps (${status.transportBitrateMode ?? "—"})`}
              />
              <Stat label="Internal CC errors" value={String(status.continuityErrors)} />
            </>
          ) : null}
          {status?.repeatPlaylist ? (
            <Stat label="Repeat cycle" value={String((status.loopCount ?? 0) + 1)} />
          ) : null}
          <div className="bitrate-stat">
            <span>FFmpeg reported bitrate (kbps)</span>
            <strong>{(status?.bitrateKbps ?? 0).toFixed(0)}</strong>
            <div><span style={{ width: `${Math.min(100, progress)}%` }} /></div>
          </div>
        </div>
      </MonitorCard>

      {status?.scte35.enabled ? (
        <MonitorCard
          action={(
            <span className={status.scte35.state === "running" ? "live-text" : "muted"}>
              {status.scte35.state}
            </span>
          )}
          title="SCTE-35 Injector"
        >
          <div className="stats-list scte35-monitor-stats">
            <Stat label="TS PID" value={status.scte35.pid == null ? "—" : String(status.scte35.pid)} />
            <Stat
              label="Observed cues"
              value={`${status.scte35.observedEvents} / ${status.scte35.plannedEvents}`}
            />
            <Stat label="Last Event ID" value={status.scte35.lastEventId == null ? "—" : String(status.scte35.lastEventId)} />
            <Stat label="Next Event ID" value={status.scte35.nextEventId == null ? "—" : String(status.scte35.nextEventId)} />
            <Stat
              label="Time to next cue"
              value={status.scte35.nextEventInSeconds == null
                ? "—"
                : formatMonitorTime(status.scte35.nextEventInSeconds)}
            />
            {status.scte35.error ? (
              <span className="scte35-monitor-error">{status.scte35.error}</span>
            ) : null}
          </div>
        </MonitorCard>
      ) : null}

      {status?.subtitles.enabled ? (
        <MonitorCard
          action={(
            <span className={status.subtitles.state === "running" ? "live-text" : "muted"}>
              {status.subtitles.state}
            </span>
          )}
          title="DVB Subtitles"
        >
          <div className="stats-list scte35-monitor-stats">
            <Stat label="TS PID" value={status.subtitles.pid == null ? "—" : String(status.subtitles.pid)} />
            <Stat label="Language" value={status.subtitles.language ?? "—"} />
            <Stat label="SRT source clips" value={String(status.subtitles.sourceItems)} />
            <Stat label="Planned cues" value={String(status.subtitles.plannedCues)} />
            <Stat label="Observed subtitle PES" value={String(status.subtitles.observedPes)} />
            <Stat
              label="Last subtitle PTS"
              value={status.subtitles.lastPtsMs == null
                ? "—"
                : formatMonitorTime(status.subtitles.lastPtsMs / 1_000)}
            />
            <Stat
              label="Video PTS origin"
              value={status.subtitles.videoPtsOriginMs == null
                ? "Waiting…"
                : formatMonitorTime(status.subtitles.videoPtsOriginMs / 1_000)}
            />
            <Stat
              label="Subtitle clock"
              value={formatSubtitleClockStatus(
                status.subtitles.clockSynchronized,
                status.subtitles.clockErrorMs,
              )}
            />
            {status.subtitles.error ? (
              <span className="scte35-monitor-error">{status.subtitles.error}</span>
            ) : null}
          </div>
        </MonitorCard>
      ) : null}

      <MonitorCard
        action={<span className={active ? "live-text" : "muted"}>{status?.state ?? "Idle"}</span>}
        title="Log Output"
      >
        <div className="log-output">
          {status?.logs.length ? status.logs.slice(-30).map((line, index) => (
            <span key={`${index}-${line}`}>{line}</span>
          )) : <span>Waiting for FFmpeg session…</span>}
        </div>
      </MonitorCard>
      </div>
    </aside>
  );
}

function LivePreview({ active, source }: { active: boolean; source: string | null }) {
  const { tr } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "playing" | "error">(
    active && source ? "loading" : "idle",
  );
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active || !source) {
      return;
    }
    setPreviewState("loading");
    setPreviewError(null);
    return attachHlsVideo(video, source, {
      live: true,
      onError: (message) => {
        setPreviewState("error");
        setPreviewError(message);
      },
      onPlaying: () => {
        setPreviewState("playing");
        setPreviewError(null);
      },
      onWaiting: () => setPreviewState("loading"),
      retryLimit: 900,
    });
  }, [active, source]);

  // До старта и при эфире без расписания в мониторе стоят цветные полосы — то
  // же самое, что в этот момент уходит в линию.
  if (!active || !source) {
    return <ColourBars title={tr("Эфир не запущен", "Playout is not running")} />;
  }
  return (
    <>
      <video autoPlay muted playsInline ref={videoRef} />
      {previewState !== "playing" ? (
        <span className={`live-preview-state ${previewState}`} role={previewError ? "alert" : undefined}>
          {previewState === "error" ? previewError : "Preparing live preview…"}
        </span>
      ) : null}
    </>
  );
}

function SettingsCard({
  children,
  headerAction,
  icon,
  title,
}: {
  children: React.ReactNode;
  headerAction?: React.ReactNode;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <section className="settings-card">
      <div className="settings-card-heading">
        <h2>
          {icon}
          {title}
        </h2>
        {headerAction}
      </div>
      <div className="settings-fields">{children}</div>
    </section>
  );
}

function MonitorCard({
  action,
  children,
  title,
}: {
  action: React.ReactNode;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="monitor-card">
      <div className="monitor-card-heading">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function SelectField({
  disabled = false,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  value: string;
}) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <select
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => {
          const optionValue = typeof option === "string" ? option : option.value;
          const optionLabel = typeof option === "string" ? option : option.label;
          return (
            <option key={`${optionValue}-${optionLabel}`} value={optionValue}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </div>
  );
}

type SelectOption = string | { label: string; value: string };

const mpegTsServiceTypeOptions: SelectOption[] = [
  { label: "Digital television", value: "digital_tv" },
  { label: "Digital radio", value: "digital_radio" },
  { label: "Teletext", value: "teletext" },
  { label: "Advanced codec digital radio", value: "advanced_codec_digital_radio" },
  { label: "MPEG-2 digital HDTV", value: "mpeg2_digital_hdtv" },
  { label: "Advanced codec digital SDTV", value: "advanced_codec_digital_sdtv" },
  { label: "Advanced codec digital HDTV", value: "advanced_codec_digital_hdtv" },
  { label: "HEVC digital HDTV", value: "hevc_digital_hdtv" },
];

function NumberField({
  disabled = false,
  label,
  max,
  min = 0,
  onChange,
  step = 1,
  value,
}: {
  disabled?: boolean;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input
        disabled={disabled}
        id={id}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="number"
        value={value}
      />
    </div>
  );
}

function gopStructureSummary(settings: BroadcastSettings): string {
  const frameRate = Number.parseFloat(settings.frameRate) || 25;
  const duration = settings.gopSize / frameRate;
  const pattern = settings.bFrames === 0
    ? "I P P P …"
    : `I ${Array.from({ length: settings.bFrames }, () => "B").join(" ")} P …`;
  return `${pattern} · ${settings.gopSize} frames / ${duration.toFixed(2)} s · ` +
    `${settings.closedGop ? "no references between GOPs" : "inter-GOP references allowed"}`;
}

function SecretField({
  disabled = false,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <div className="input-with-action">
        <input
          disabled={disabled}
          id={id}
          onChange={(event) => onChange(event.target.value)}
          type={visible ? "text" : "password"}
          value={value}
        />
        <button
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

function TextField({
  actionLabel,
  disabled = false,
  label,
  onAction,
  onChange,
  value,
}: {
  actionLabel?: string;
  disabled?: boolean;
  label: string;
  onAction?: () => void;
  onChange: (value: string) => void;
  value: string;
}) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      {actionLabel ? (
        <div className="input-with-text-action">
          <input
            disabled={disabled}
            id={id}
            onChange={(event) => onChange(event.target.value)}
            type="text"
            value={value}
          />
          <button disabled={disabled} onClick={onAction} type="button">
            {actionLabel}
          </button>
        </div>
      ) : (
        <input
          disabled={disabled}
          id={id}
          onChange={(event) => onChange(event.target.value)}
          type="text"
          value={value}
        />
      )}
    </div>
  );
}

function RangeField({
  label,
  max,
  min,
  onChange,
  step = 1,
  suffix,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  suffix: string;
  value: number;
}) {
  return (
    <div className="range-field">
      <label>
        <span>{label}</span>
        <strong>{suffix}</strong>
      </label>
      <input
        aria-label={label}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </div>
  );
}

function ToggleField({
  checked,
  compact = false,
  label,
  onChange,
}: {
  checked: boolean;
  compact?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`toggle-field ${compact ? "compact" : ""}`}>
      <span>{label}</span>
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <i aria-hidden="true" />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function presetLabel(value: number): string {
  if (value < 20) return "Medium";
  if (value < 45) return "Slow";
  if (value < 75) return "Slower";
  return "Veryslow";
}

function codecOptions(capabilities: FfmpegCapabilities | null): string[] {
  if (!capabilities) {
    return ["H.264", "H.265", "MPEG-2 Video"];
  }
  const options: string[] = [];
  if (capabilities.supports.h264) options.push("H.264");
  if (capabilities.supports.h265) options.push("H.265");
  if (capabilities.supports.mpeg2) options.push("MPEG-2 Video");
  return options.length ? options : ["H.264"];
}

function formatMonitorTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const remaining = whole % 60;
  return [hours, minutes, remaining]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function formatSubtitleClockStatus(
  synchronized: boolean | null,
  clockErrorMs: number | null,
): string {
  if (synchronized == null || clockErrorMs == null) return "Waiting…";
  const sign = clockErrorMs > 0 ? "+" : "";
  return `${synchronized ? "Aligned" : "Mismatch"} · ${sign}${clockErrorMs} ms`;
}
