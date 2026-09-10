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
  Plus,
  Radio,
  Trash2,
  PowerCircle,
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
  PlayoutEndpoint,
  PlayoutStatus,
  PlayoutStream,
  ScheduleStartMarker,
  WorkspaceSessionCheckpoint,
} from "@gruber/contracts";
import { attachHlsVideo } from "../hls-video";
import { usePlayoutStatus } from "../playout-status";
import {
  getPlayoutAudioLevel,
  startPlayoutStream,
  stopPlayoutStream,
} from "../media-api";
import { mediaApiUrl } from "../runtime";
import { useI18n } from "../i18n";
import {
  audioCodecOptionsFor,
  audioCodecFromLabel,
  audioCodecLabels,
  outputCapabilitiesOf,
  settingsForOutputProtocol,
  videoCodecFromLabel,
  videoCodecLabels,
  videoCodecOptionsFor,
} from "../output-capabilities";
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
  // Что несёт выбранный транспорт. Матрица одна на службу и на экран: пока её
  // не было, планировщик SCTE-35 при RTMP спокойно раскладывал метки, которых
  // FLV не переносит, и снаружи это выглядело как «метки не дошли».
  const outputCapabilities = outputCapabilitiesOf(
    settings.protocol === "UDP" || settings.protocol === "SRT" ||
      settings.outputStreams.some((stream) => stream.endpoint.protocol !== "rtmp")
      ? "SRT"
      : settings.protocol,
  );
  const programProtocol = outputCapabilities.mpegTs ? "SRT" : settings.protocol;
  const programVideoCodecs = codecOptions(capabilities, programProtocol);
  const programAudioCodecs = audioCodecOptionsFor(programProtocol);
  const scte35Editable = settings.scte35PlanningEnabled && outputCapabilities.scte35;
  const incompatibleScte35Output =
    settings.scte35PlanningEnabled && !outputCapabilities.scte35;
  const incompatibleSubtitleOutput =
    settings.subtitleOutputMode === "DVB Subtitles" && !outputCapabilities.dvbSubtitles;

  return (
    <main className="broadcast-screen screen-body">
      <section className="settings-column">
        <div className="settings-card">
          <label htmlFor="reserve-file">{tr("Резервная заставка", "Reserve clip")}</label>
          <input id="reserve-file" value={settings.reserveFilePath} readOnly placeholder={tr("Цветные полосы", "Colour bars")} />
          <button type="button" disabled={active || !window.gruberDesktop} onClick={async () => {
            const files = await window.gruberDesktop?.selectMediaFiles();
            if (files?.[0]) update("reserveFilePath", files[0]);
          }}>{tr("Загрузить резервную заставку", "Load reserve clip")}</button>
          <button type="button" disabled={active || !settings.reserveFilePath} onClick={() => update("reserveFilePath", "")}>
            {tr("Использовать цветные полосы", "Use colour bars")}
          </button>
          <p>{tr("Повторяется при пустом Future до запуска следующего расписания. Путь сохраняется в сессии.", "Loops when Future is empty until the next schedule starts. The path is saved in the session.")}</p>
        </div>

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
            {/* Станция без оператора: машина перезагрузилась, FluxIO стартовал
                сам, расписание пошло дальше с того места, где оборвалось.
                Перед подъёмом эфира даётся обратный отсчёт с отменой — иначе
                машина, перезагруженная ради обслуживания, ушла бы в линию. */}
            <button
              aria-pressed={settings.autoResumeOnLaunch}
              className={`schedule-repeat-button ${settings.autoResumeOnLaunch ? "active" : ""}`}
              onClick={() => update("autoResumeOnLaunch", !settings.autoResumeOnLaunch)}
              title={tr(
                "После запуска программы поднять эфир с того места, где он оборвался. Перед стартом даётся обратный отсчёт с возможностью отменить.",
                "After the app launches, resume playout where it was interrupted. A countdown with a cancel button runs first.",
              )}
              type="button"
            >
              <PowerCircle size={15} /> {tr("Автостарт", "Auto-resume")}
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
                  (!settings.streamingEnabled && !settings.outputStreams.some(
                    (stream) => stream.enabled,
                  )) ||
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
            disabled={programVideoCodecs.length === 1}
            label={tr("Кодек", "Codec")}
            onChange={(value) => onSettingsChange({
              ...settings,
              videoCodec: value,
              bFrames: value === "MPEG-2 Video"
                ? Math.min(2, settings.bFrames)
                : settings.bFrames,
            })}
            options={programVideoCodecs}
            value={settings.videoCodec}
          />
          {/* Аппаратное кодирование — не оптимизация: на 2160 программный
              кодировщик не укладывается в реальное время. Список строится по
              тому, что реально есть в сборке FFmpeg на этой машине. */}
          <SelectField
            label={tr("Кодирование", "Encoding")}
            onChange={(value) => onSettingsChange({
              ...settings,
              videoHardware: (hardwareOptions(capabilities)
                .find((option) => option.label === value)?.value ?? "off") as BroadcastSettings["videoHardware"],
            })}
            options={hardwareOptions(capabilities).map((option) => option.label)}
            value={hardwareOptions(capabilities)
              .find((option) => option.value === settings.videoHardware)?.label ?? "Программное"}
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
            disabled={!settings.streamingEnabled || !outputCapabilities.dvbSubtitles}
            label={tr("Режим выдачи", "Delivery mode")}
            onChange={(value) => update(
              "subtitleOutputMode",
              value as BroadcastSettings["subtitleOutputMode"],
            )}
            options={outputCapabilities.dvbSubtitles
              ? ["Burn-in", "DVB Subtitles"]
              : ["Burn-in"]}
            value={outputCapabilities.dvbSubtitles ? settings.subtitleOutputMode : "Burn-in"}
          />
          <p className="transport-setting-note">
            Burn-in draws enabled SRT files into the video. DVB Subtitles creates a separate,
            receiver-selectable bitmap PID for UDP/SRT MPEG-TS; the original video stays clean.
          </p>
          {outputCapabilities.dvbSubtitles ? null : (
            <div className="scte35-runtime-note locked">
              <Captions size={15} />
              <span>
                {tr(
                  "Выбран RTMP: FLV не несёт отдельного PID субтитров, поэтому режим заперт на вжигании. Для отдельного PID выберите UDP или SRT.",
                  "RTMP is selected: FLV carries no separate subtitle PID, so the mode is locked to burn-in. Choose UDP or SRT for a separate PID.",
                )}
              </span>
            </div>
          )}
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
              disabled={programAudioCodecs.length === 1}
              label={tr("Кодек", "Codec")}
              onChange={(value) => update("audioCodec", value)}
              options={programAudioCodecs}
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
            onChange={(value) => onSettingsChange(settingsForOutputProtocol(settings, value))}
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
          {outputCapabilities.mpegTsService ? (
            <MpegTsServiceFields settings={settings} update={update} />
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

        <AdditionalOutputs
          active={active}
          networkInterfaces={networkInterfaces}
          onChange={onSettingsChange}
          settings={settings}
        />

        <SettingsCard
          headerAction={
            <ToggleField
              checked={settings.scte35PlanningEnabled && outputCapabilities.scte35}
              compact
              disabled={!outputCapabilities.scte35}
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
            disabled={!scte35Editable}
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
              disabled={!scte35Editable}
              label={tr("Владелец сегментации", "Segmentation owner")}
              onChange={(value) => update("scte35Owner", value)}
              options={["Provider", "Distributor"]}
              value={settings.scte35Owner}
            />
            <NumberField
              disabled={!scte35Editable}
              label={tr("Event ID по умолчанию", "Default Event ID")}
              onChange={(value) => update("scte35DefaultEventId", Math.min(4_294_967_295, value))}
              value={settings.scte35DefaultEventId}
            />
          </div>
          <div className="three-column-fields">
            <NumberField
              disabled={!scte35Editable}
              label="SCTE-35 PID"
              onChange={(value) => update("scte35Pid", Math.min(8_190, Math.max(32, value)))}
              value={settings.scte35Pid}
            />
            <NumberField
              disabled={!scte35Editable}
              label={tr("Предварительная подача (мс)", "Pre-roll (ms)")}
              onChange={(value) => update("scte35PreRollMs", Math.min(60_000, value))}
              value={settings.scte35PreRollMs}
            />
            <NumberField
              disabled={!scte35Editable}
              label={tr("Длительность блока по умолчанию (с)", "Default break (sec)")}
              onChange={(value) => update("scte35DefaultBreakDuration", Math.min(86_400, Math.max(1, value)))}
              value={settings.scte35DefaultBreakDuration}
            />
          </div>
          <div className="two-column-fields">
            <SelectField
              disabled={!scte35Editable}
              label={tr("Тип UPID", "UPID type")}
              onChange={(value) => update("scte35UpidType", value)}
              options={["Ad-ID", "UUID", "URI", "None"]}
              value={settings.scte35UpidType}
            />
            <TextField
              disabled={!scte35Editable || settings.scte35UpidType === "None"}
              label={tr("UPID по умолчанию", "Default UPID")}
              onChange={(value) => update("scte35DefaultUpid", value)}
              value={settings.scte35DefaultUpid}
            />
          </div>
          <SelectField
            disabled={!scte35Editable || !settings.repeatSchedule}
            label={tr("Event ID при повторе плейлиста", "Event IDs when playlist repeats")}
            onChange={(value) => update("scte35LoopEventStrategy", value)}
            options={["Increment each loop", "Reuse playlist Event IDs"]}
            value={settings.scte35LoopEventStrategy}
          />
          <div className={`scte35-runtime-note ${outputCapabilities.scte35 ? "" : "locked"}`}>
            <FlagTriangleRight size={15} />
            <span>
              {!outputCapabilities.scte35
                ? tr("Выбран RTMP: FLV не несёт PID SCTE-35, поэтому планировщик заперт и выключен. Для доставки cue выберите UDP или SRT.", "RTMP is selected: FLV carries no SCTE-35 PID, so the planner is locked off. Choose UDP or SRT for cue delivery.")
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
    </>
  );
}

/**
 * Настройки службы MPEG-TS.
 *
 * Живут отдельно от полей сети намеренно: их несут оба MPEG-TS транспорта, а
 * раньше они стояли внутри полей UDP и до SRT не доходили вовсе — инженер
 * правил имя службы и PID, а в эфир уходили умолчания. FLV полей PMT не имеет,
 * поэтому при RTMP карточки нет.
 */
function MpegTsServiceFields({
  settings,
  update,
}: {
  settings: BroadcastSettings;
  update: SettingsUpdater;
}) {
  const disabled = !settings.streamingEnabled;
  const autoTransportBitrate = calculateAutoTransportBitrateMbps(settings);
  return (
    <>
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
        enforced on the final MPEG-TS stream — over UDP and over SRT alike — including when
        SCTE-35 is disabled. The applied TS payload rate is shown in Encoding Monitor; the
        UDP/IP/Ethernet line rate can be higher.
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

function AdditionalOutputs({
  active,
  networkInterfaces,
  onChange,
  settings,
}: {
  active: boolean;
  networkInterfaces: NetworkInterfaceInfo[];
  onChange: (settings: BroadcastSettings) => void;
  settings: BroadcastSettings;
}) {
  const { tr } = useI18n();
  const replace = (stream: PlayoutStream) => {
    const next = {
      ...settings,
      outputStreams: settings.outputStreams.map((item) => item.id === stream.id ? stream : item),
    };
    onChange(settingsForOutputProtocol(next, next.protocol));
  };
  const remove = (id: string) => {
    const next = {
      ...settings,
      outputStreams: settings.outputStreams.filter((stream) => stream.id !== id),
    };
    onChange(settingsForOutputProtocol(next, next.protocol));
  };
  const add = () => {
    const number = [2, 3].find(
      (candidate) => !settings.outputStreams.some((stream) => stream.id === `output-${candidate}`),
    );
    if (!number) return;
    onChange({
      ...settings,
      outputStreams: [
        ...settings.outputStreams,
        {
          id: `output-${number}`,
          name: `${tr("Поток", "Output")} ${number}`,
          enabled: true,
          endpoint: additionalEndpoint(settings, undefined, undefined, number - 1),
          transcode: null,
        },
      ],
    });
  };

  return (
    <SettingsCard
      headerAction={(
        <button
          className="stream-add-button"
          disabled={active || settings.outputStreams.length >= 2}
          onClick={add}
          type="button"
        >
          <Plus size={14} /> {tr("Добавить поток", "Add output")}
        </button>
      )}
      icon={<Rows3 size={16} />}
      title={tr("Дополнительные потоки", "Additional outputs")}
    >
      <p className="transport-setting-note">
        {tr(
          "Основной поток настраивается выше. Дополнительный выход без своего профиля использует готовую программу; отдельное транскодирование создаёт ещё один FFmpeg и заметно увеличивает CPU.",
          "The primary output is configured above. An extra output without its own profile reuses the programme; separate transcoding starts another FFmpeg process and materially increases CPU use.",
        )}
      </p>
      {settings.outputStreams.length === 0 ? (
        <span className="stream-empty-note">
          {tr("Сейчас настроен один поток. Можно добавить ещё два.", "One output is configured. You can add two more.")}
        </span>
      ) : settings.outputStreams.map((stream) => (
        <AdditionalOutputEditor
          active={active}
          key={stream.id}
          networkInterfaces={networkInterfaces}
          onChange={replace}
          onRemove={() => remove(stream.id)}
          settings={settings}
          stream={stream}
        />
      ))}
    </SettingsCard>
  );
}

function AdditionalOutputEditor({
  active,
  networkInterfaces,
  onChange,
  onRemove,
  settings,
  stream,
}: {
  active: boolean;
  networkInterfaces: NetworkInterfaceInfo[];
  onChange: (stream: PlayoutStream) => void;
  onRemove: () => void;
  settings: BroadcastSettings;
  stream: PlayoutStream;
}) {
  const { tr } = useI18n();
  const updateEndpoint = (endpoint: PlayoutEndpoint) => onChange({ ...stream, endpoint });
  const changeProtocol = (protocol: string) => {
    const endpoint = additionalEndpoint(settings, protocol, stream.endpoint);
    const capabilities = outputCapabilitiesOf(protocol);
    const transcode = stream.transcode && {
      video: {
        ...stream.transcode.video,
        codec: capabilities.videoCodecs.includes(stream.transcode.video.codec)
          ? stream.transcode.video.codec
          : capabilities.videoCodecs[0] ?? "h264",
      },
      audio: {
        ...stream.transcode.audio,
        codec: capabilities.audioCodecs.includes(stream.transcode.audio.codec)
          ? stream.transcode.audio.codec
          : capabilities.audioCodecs[0] ?? "aac",
      },
    };
    onChange({ ...stream, endpoint, transcode });
  };

  return (
    <section className="stream-editor">
      <div className="stream-editor-heading">
        <TextField
          disabled={active}
          label={tr("Название потока", "Output name")}
          onChange={(name) => onChange({ ...stream, name })}
          value={stream.name}
        />
        <ToggleField
          checked={stream.enabled}
          compact
          disabled={active}
          label={tr("Стартовать со всеми", "Start with all")}
          onChange={(enabled) => onChange({ ...stream, enabled })}
        />
        <button
          aria-label={tr("Удалить поток", "Remove output")}
          className="stream-remove-button"
          disabled={active}
          onClick={onRemove}
          type="button"
        >
          <Trash2 size={15} />
        </button>
      </div>
      <SelectField
        disabled={active}
        label={tr("Протокол", "Protocol")}
        onChange={changeProtocol}
        options={[
          { label: "SRT", value: "srt" },
          { label: "UDP", value: "udp" },
          { label: "RTMP / RTMPS", value: "rtmp" },
        ]}
        value={stream.endpoint.protocol}
      />
      <AdditionalEndpointFields
        disabled={active}
        endpoint={stream.endpoint}
        networkInterfaces={networkInterfaces}
        onChange={updateEndpoint}
      />
      <ToggleField
        checked={stream.transcode !== null}
        disabled={active}
        label={tr("Собственный профиль транскодирования", "Separate transcoding profile")}
        onChange={(enabled) => onChange({
          ...stream,
          transcode: enabled ? additionalTranscode(settings, stream.endpoint) : null,
        })}
      />
      {stream.transcode ? (
        <AdditionalTranscodeFields
          disabled={active}
          onChange={(transcode) => onChange({ ...stream, transcode })}
          protocol={stream.endpoint.protocol}
          transcode={stream.transcode}
        />
      ) : null}
    </section>
  );
}

function AdditionalEndpointFields({
  disabled,
  endpoint,
  networkInterfaces,
  onChange,
}: {
  disabled: boolean;
  endpoint: PlayoutEndpoint;
  networkInterfaces: NetworkInterfaceInfo[];
  onChange: (endpoint: PlayoutEndpoint) => void;
}) {
  if (endpoint.protocol === "rtmp") {
    return (
      <div className="two-column-fields">
        <TextField disabled={disabled} label="Server URL" onChange={(serverUrl) => onChange({ ...endpoint, serverUrl })} value={endpoint.serverUrl} />
        <SecretField disabled={disabled} label="Stream key" onChange={(streamKey) => onChange({ ...endpoint, streamKey })} value={endpoint.streamKey} />
      </div>
    );
  }

  return (
    <>
      <div className="two-column-fields">
        <TextField disabled={disabled} label="Host" onChange={(host) => onChange({ ...endpoint, host })} value={endpoint.host} />
        <NumberField disabled={disabled} label="Port" max={65_535} min={1} onChange={(port) => onChange({ ...endpoint, port })} value={endpoint.port} />
      </div>
      {endpoint.protocol === "srt" ? (
        <>
          <div className="two-column-fields">
            <SelectField disabled={disabled} label="Mode" onChange={(mode) => onChange({ ...endpoint, mode: mode as typeof endpoint.mode })} options={["caller", "listener", "rendezvous"]} value={endpoint.mode} />
            <NumberField disabled={disabled} label="Latency (ms)" min={20} max={8_000} onChange={(latencyMs) => onChange({ ...endpoint, latencyMs })} value={endpoint.latencyMs} />
          </div>
          <SecretField disabled={disabled} label="Passphrase (10–79 chars)" onChange={(passphrase) => onChange({ ...endpoint, passphrase })} value={endpoint.passphrase} />
          <TextField disabled={disabled} label="Stream ID" onChange={(streamId) => onChange({ ...endpoint, streamId })} value={endpoint.streamId} />
        </>
      ) : (
        <div className="three-column-fields">
          <NumberField disabled={disabled} label="Packet size" min={188} max={65_507} onChange={(packetSize) => onChange({ ...endpoint, packetSize })} value={endpoint.packetSize} />
          <NumberField disabled={disabled} label="TTL" min={1} max={255} onChange={(ttl) => onChange({ ...endpoint, ttl })} value={endpoint.ttl} />
          <SelectField
            disabled={disabled}
            label="Network interface"
            onChange={(localAddress) => onChange({ ...endpoint, localAddress })}
            options={[{ label: "Automatic", value: "" }, ...networkInterfaces.map((entry) => ({ label: `${entry.name} — ${entry.address}`, value: entry.address }))]}
            value={endpoint.localAddress}
          />
        </div>
      )}
      <AdditionalMpegTsFields
        disabled={disabled}
        mpegTs={endpoint.mpegTs}
        onChange={(mpegTs) => onChange({ ...endpoint, mpegTs })}
      />
    </>
  );
}

function AdditionalMpegTsFields({
  disabled,
  mpegTs,
  onChange,
}: {
  disabled: boolean;
  mpegTs: Extract<PlayoutEndpoint, { protocol: "udp" }>["mpegTs"];
  onChange: (mpegTs: Extract<PlayoutEndpoint, { protocol: "udp" }>["mpegTs"]) => void;
}) {
  return (
    <>
      <div className="udp-section-label">MPEG-TS service</div>
      <div className="two-column-fields">
        <TextField disabled={disabled} label="Service name" onChange={(serviceName) => onChange({ ...mpegTs, serviceName })} value={mpegTs.serviceName} />
        <TextField disabled={disabled} label="Provider" onChange={(providerName) => onChange({ ...mpegTs, providerName })} value={mpegTs.providerName} />
      </div>
      <div className="three-column-fields">
        <NumberField disabled={disabled} label="Service ID" min={1} max={65_535} onChange={(serviceId) => onChange({ ...mpegTs, serviceId })} value={mpegTs.serviceId} />
        <NumberField disabled={disabled} label="Video PID" min={32} max={8_190} onChange={(videoPid) => onChange({ ...mpegTs, videoPid })} value={mpegTs.videoPid} />
        <NumberField disabled={disabled} label="Audio PID" min={32} max={8_190} onChange={(audioPid) => onChange({ ...mpegTs, audioPid })} value={mpegTs.audioPid} />
      </div>
      <div className="three-column-fields">
        <SelectField disabled={disabled} label="Service type" onChange={(serviceType) => onChange({ ...mpegTs, serviceType: serviceType as typeof mpegTs.serviceType })} options={mpegTsServiceTypeOptions} value={mpegTs.serviceType} />
        <NumberField disabled={disabled} label="PCR (ms)" min={1} max={1_000} onChange={(pcrPeriodMs) => onChange({ ...mpegTs, pcrPeriodMs })} value={mpegTs.pcrPeriodMs} />
        <NumberField disabled={disabled} label="TS bitrate (kbps, 0 = Auto)" min={0} onChange={(transportBitrateKbps) => onChange({ ...mpegTs, transportBitrateKbps })} value={mpegTs.transportBitrateKbps} />
      </div>
    </>
  );
}

type StreamTranscode = NonNullable<PlayoutStream["transcode"]>;

function AdditionalTranscodeFields({
  disabled,
  onChange,
  protocol,
  transcode,
}: {
  disabled: boolean;
  onChange: (transcode: StreamTranscode) => void;
  protocol: PlayoutEndpoint["protocol"];
  transcode: StreamTranscode;
}) {
  const protocolLabel = protocol.toUpperCase();
  return (
    <div className="stream-transcode-fields">
      <div className="three-column-fields">
        <SelectField disabled={disabled} label="Video codec" onChange={(value) => onChange({ ...transcode, video: { ...transcode.video, codec: videoCodecFromLabel(value) } })} options={videoCodecOptionsFor(protocolLabel)} value={videoCodecLabels[transcode.video.codec]} />
        <NumberField disabled={disabled} label="Width" min={16} max={16_384} onChange={(width) => onChange({ ...transcode, video: { ...transcode.video, width } })} value={transcode.video.width} />
        <NumberField disabled={disabled} label="Height" min={16} max={16_384} onChange={(height) => onChange({ ...transcode, video: { ...transcode.video, height } })} value={transcode.video.height} />
      </div>
      <div className="three-column-fields">
        <NumberField disabled={disabled} label="Video bitrate (kbps)" min={1} onChange={(targetBitrateKbps) => onChange({ ...transcode, video: { ...transcode.video, targetBitrateKbps, maxBitrateKbps: Math.max(targetBitrateKbps, transcode.video.maxBitrateKbps) } })} value={transcode.video.targetBitrateKbps} />
        <NumberField disabled={disabled} label="Frame rate" min={1} max={120} step={0.001} onChange={(frameRate) => onChange({ ...transcode, video: { ...transcode.video, frameRate } })} value={transcode.video.frameRate} />
        <SelectField disabled={disabled} label="Field order" onChange={(fieldOrder) => onChange({ ...transcode, video: { ...transcode.video, fieldOrder: fieldOrder as typeof transcode.video.fieldOrder } })} options={["progressive", "upper", "lower"]} value={transcode.video.fieldOrder} />
      </div>
      <div className="three-column-fields">
        <SelectField disabled={disabled} label="Audio codec" onChange={(value) => onChange({ ...transcode, audio: { ...transcode.audio, codec: audioCodecFromLabel(value) } })} options={audioCodecOptionsFor(protocolLabel)} value={audioCodecLabels[transcode.audio.codec]} />
        <NumberField disabled={disabled} label="Audio bitrate (kbps)" min={32} max={1_536} onChange={(bitrateKbps) => onChange({ ...transcode, audio: { ...transcode.audio, bitrateKbps } })} value={transcode.audio.bitrateKbps} />
        <SelectField disabled={disabled} label="Channels" onChange={(channels) => onChange({ ...transcode, audio: { ...transcode.audio, channels: Number(channels) as 1 | 2 | 6 } })} options={[{ label: "Mono", value: "1" }, { label: "Stereo", value: "2" }, { label: "5.1", value: "6" }]} value={String(transcode.audio.channels)} />
      </div>
      <p className="transport-setting-note">Software FFmpeg · CPU and memory appear per output in Encoding Monitor.</p>
    </div>
  );
}

function additionalEndpoint(
  settings: BroadcastSettings,
  protocol = settings.protocol.toLowerCase(),
  previous?: PlayoutEndpoint,
  portOffset = 1,
): PlayoutEndpoint {
  const mpegTs = previous && previous.protocol !== "rtmp"
    ? previous.mpegTs
    : {
        serviceName: settings.udpServiceName.trim() || "FluxIO",
        serviceId: Math.min(65_535, Math.max(1, Math.trunc(settings.udpServiceId))),
        providerName: settings.udpProviderName.trim() || "FluxIO",
        videoPid: Math.min(8_190, Math.max(32, Math.trunc(settings.udpVideoPid))),
        audioPid: Math.min(8_190, Math.max(32, Math.trunc(settings.udpAudioPid))),
        serviceType: (mpegTsServiceTypeOptions.some((option) => typeof option !== "string" && option.value === settings.udpServiceType)
          ? settings.udpServiceType
          : "digital_tv") as Extract<PlayoutEndpoint, { protocol: "udp" }>["mpegTs"]["serviceType"],
        pcrPeriodMs: Math.min(1_000, Math.max(1, Math.trunc(settings.udpPcrPeriodMs))),
        transportBitrateKbps: settings.udpTransportBitrate > 0
          ? Math.round(settings.udpTransportBitrate * 1_000)
          : 0,
      };
  if (protocol === "udp") {
    return {
      protocol: "udp",
      host: previous?.protocol === "udp" ? previous.host : settings.udpHost,
      port: previous?.protocol === "udp" ? previous.port : settings.udpPort + portOffset,
      packetSize: previous?.protocol === "udp" ? previous.packetSize : settings.udpPacketSize,
      ttl: previous?.protocol === "udp" ? previous.ttl : settings.udpTtl,
      localAddress: previous?.protocol === "udp" ? previous.localAddress : settings.udpLocalAddress,
      mpegTs,
    };
  }
  if (protocol.startsWith("rtmp")) {
    return {
      protocol: "rtmp",
      serverUrl: previous?.protocol === "rtmp" ? previous.serverUrl : settings.rtmpServerUrl,
      streamKey: previous?.protocol === "rtmp" ? previous.streamKey : "",
    };
  }
  return {
    protocol: "srt",
    host: previous?.protocol === "srt" ? previous.host : settings.srtHost,
      port: previous?.protocol === "srt" ? previous.port : settings.srtPort + portOffset,
    mode: previous?.protocol === "srt" ? previous.mode : "caller",
    latencyMs: previous?.protocol === "srt" ? previous.latencyMs : settings.srtLatencyMs,
    passphrase: previous?.protocol === "srt" ? previous.passphrase : "",
    streamId: previous?.protocol === "srt" ? previous.streamId : "",
    mpegTs,
  };
}

function additionalTranscode(
  settings: BroadcastSettings,
  endpoint: PlayoutEndpoint,
): StreamTranscode {
  const capabilities = outputCapabilitiesOf(endpoint.protocol.toUpperCase());
  const videoCodec = videoCodecFromLabel(settings.videoCodec);
  const audioCodec = audioCodecFromLabel(settings.audioCodec);
  return {
    video: {
      codec: capabilities.videoCodecs.includes(videoCodec) ? videoCodec : capabilities.videoCodecs[0] ?? "h264",
      hardware: "off",
      vaapiDevice: "/dev/dri/renderD128",
      width: settings.width,
      height: settings.height,
      frameRate: Number.parseFloat(settings.frameRate) || 25,
      rateControl: settings.rateControl.toLowerCase() === "crf" ? "crf" : settings.rateControl.toLowerCase() === "vbr" ? "vbr" : "cbr",
      targetBitrateKbps: Math.round(settings.targetBitrate * 1_000),
      maxBitrateKbps: Math.round(settings.maxBitrate * 1_000),
      bufferSizeKbps: settings.bufferSize,
      crf: settings.crf,
      preset: settings.preset < 12 ? "ultrafast" : settings.preset < 24 ? "veryfast" : settings.preset < 40 ? "fast" : settings.preset < 58 ? "medium" : settings.preset < 76 ? "slow" : settings.preset < 90 ? "slower" : "veryslow",
      profile: settings.profile,
      level: settings.level,
      deinterlace: settings.deinterlace,
      fieldOrder: settings.fieldOrder === "upper" || settings.fieldOrder === "lower" ? settings.fieldOrder : "progressive",
      gopSize: Math.max(1, Math.min(600, Math.round(settings.gopSize))),
      bFrames: Math.max(0, Math.min(16, Math.round(settings.bFrames))),
      closedGop: settings.closedGop,
    },
    audio: {
      codec: capabilities.audioCodecs.includes(audioCodec) ? audioCodec : capabilities.audioCodecs[0] ?? "aac",
      sampleRate: Number.parseInt(settings.sampleRate, 10) || 48_000,
      channels: settings.channels === "Mono" ? 1 : settings.channels === "5.1" ? 6 : 2,
      bitrateKbps: settings.audioBitrate,
      loudnessNormalization: {
        enabled: settings.loudnessNormalizationEnabled,
        targetLufs: settings.loudnessTargetLufs,
        truePeakDbtp: -1,
        loudnessRangeLufs: 7,
      },
    },
  };
}

function EncodingMonitor() {
  // Единственный узел экрана, которому нужен живой статус целиком.
  const { tr } = useI18n();
  const status = usePlayoutStatus();
  const [liveAudioLevelDbfs, setLiveAudioLevelDbfs] = useState<number | null>(null);
  const [streamActionId, setStreamActionId] = useState<string | null>(null);
  const [streamActionError, setStreamActionError] = useState<string | null>(null);
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

  const switchStream = async (id: string, start: boolean) => {
    setStreamActionId(id);
    setStreamActionError(null);
    try {
      await (start ? startPlayoutStream(id) : stopPlayoutStream(id));
    } catch (reason) {
      setStreamActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStreamActionId(null);
    }
  };

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

      <MonitorCard
        action={<span className="muted">{status?.streams.length ?? 0} / 3</span>}
        title={tr("Потоки и ресурсы", "Outputs and resources")}
      >
        <div className="stream-runtime-list">
          {status?.streams.some((stream) => stream.mode !== "program") ? (
            <StreamResourceRow
              label={tr("Общая программа", "Shared programme")}
              mode="program"
              resources={status.programResources}
              state={status.state}
            />
          ) : null}
          {status?.streams.map((stream) => (
            <StreamResourceRow
              action={stream.mode === "program" ? null : (
                <button
                  disabled={streamActionId === stream.id || status.state !== "running" || stream.state === "stopping"}
                  onClick={() => void switchStream(
                    stream.id,
                    stream.state === "idle" || stream.state === "failed",
                  )}
                  type="button"
                >
                  {stream.state === "idle" || stream.state === "failed"
                    ? tr("Старт", "Start")
                    : tr("Стоп", "Stop")}
                </button>
              )}
              endpoint={stream.endpointLabel}
              error={stream.error}
              key={stream.id}
              label={stream.name}
              mode={stream.mode}
              resources={stream.resources}
              state={stream.state}
            />
          ))}
          {!status?.streams.length ? (
            <span className="stream-empty-note">{tr("Потоки появятся после старта эфира.", "Outputs appear after playout starts.")}</span>
          ) : null}
          {streamActionError ? <span className="scte35-monitor-error">{streamActionError}</span> : null}
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

function StreamResourceRow({
  action,
  endpoint,
  error,
  label,
  mode,
  resources,
  state,
}: {
  action?: React.ReactNode;
  endpoint?: string | null;
  error?: string | null;
  label: string;
  mode: string;
  resources: { cpuPercent: number; memoryMb: number; processes: number };
  state: string;
}) {
  return (
    <div className={`stream-runtime-row state-${state}`}>
      <div>
        <strong>{label}</strong>
        <span>{mode} · {endpoint ?? state}</span>
        {error ? <small>{error}</small> : null}
      </div>
      <span className="stream-resource-value">CPU {resources.cpuPercent.toFixed(1)}%</span>
      <span className="stream-resource-value">RAM {resources.memoryMb.toFixed(0)} MB</span>
      <span className="stream-resource-value">{resources.processes} proc.</span>
      <b>{state}</b>
      {action}
    </div>
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
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  compact?: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`toggle-field ${compact ? "compact" : ""} ${disabled ? "disabled" : ""}`}>
      <span>{label}</span>
      <input
        checked={checked}
        disabled={disabled}
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

/**
 * Ускорители, которые реально есть в этой сборке FFmpeg.
 *
 * Показывать недоступные бессмысленно: оператор выберет, а откажет preflight
 * уже перед стартом. «Авто» остаётся всегда — он сам найдёт первый доступный.
 */
function hardwareOptions(
  capabilities: FfmpegCapabilities | null,
): { value: string; label: string }[] {
  const encoders = new Set(capabilities?.videoEncoders ?? []);
  const present = (...names: string[]) => names.some((name) => encoders.has(name));
  const options = [{ value: "off", label: "Программное" }];
  if (!capabilities) return options;
  if (present("h264_nvenc", "hevc_nvenc")) options.push({ value: "nvenc", label: "NVIDIA NVENC" });
  if (present("h264_qsv", "hevc_qsv")) options.push({ value: "qsv", label: "Intel Quick Sync" });
  if (present("h264_amf", "hevc_amf")) options.push({ value: "amf", label: "AMD AMF" });
  if (present("h264_vaapi", "hevc_vaapi")) options.push({ value: "vaapi", label: "VAAPI" });
  if (present("h264_videotoolbox", "hevc_videotoolbox")) {
    options.push({ value: "videotoolbox", label: "Apple VideoToolbox" });
  }
  if (options.length > 1) options.splice(1, 0, { value: "auto", label: "Авто" });
  return options;
}

/**
 * Кодек обязан пройти оба сита: сборку FFmpeg на этой машине и контейнер
 * выбранного выхода. FLV не несёт MPEG-2 вовсе — муксер отказывается писать
 * заголовок, и выяснялось бы это на старте эфира.
 */
function codecOptions(capabilities: FfmpegCapabilities | null, protocol: string): string[] {
  const carried = videoCodecOptionsFor(protocol);
  if (!capabilities) return carried;
  const options: string[] = [];
  if (capabilities.supports.h264) options.push("H.264");
  if (capabilities.supports.h265) options.push("H.265");
  if (capabilities.supports.mpeg2) options.push("MPEG-2 Video");
  const available = options.filter((option) => carried.includes(option));
  return available.length ? available : [carried[0] ?? "H.264"];
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
