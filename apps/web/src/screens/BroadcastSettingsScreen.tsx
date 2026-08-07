import {
  AudioLines,
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
import { useEffect, useId, useRef, useState } from "react";
import type {
  FfmpegCapabilities,
  NetworkInterfaceInfo,
  PlayoutStatus,
  ScheduleStartMarker,
  WorkspaceSessionCheckpoint,
} from "@gruber/contracts";
import { attachHlsVideo } from "../hls-video";
import { mediaApiUrl, mediaPath } from "../runtime";
import type { BroadcastSettings } from "../types";

interface BroadcastSettingsScreenProps {
  capabilities: FfmpegCapabilities | null;
  networkInterfaces: NetworkInterfaceInfo[];
  onStart: () => void;
  onStartFresh: () => void;
  onStop: () => void;
  operationError: string | null;
  playlistLength: number;
  playoutStatus: PlayoutStatus | null;
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

export function BroadcastSettingsScreen({
  capabilities,
  networkInterfaces,
  onStart,
  onStartFresh,
  onStop,
  operationError,
  playlistLength,
  playoutStatus,
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
  const settingsFileInput = useRef<HTMLInputElement>(null);
  function update<Key extends keyof BroadcastSettings>(
    key: Key,
    value: BroadcastSettings[Key],
  ) {
    onSettingsChange({ ...settings, [key]: value });
  }

  const active = playoutStatus
    ? ["starting", "running", "stopping"].includes(playoutStatus.state)
    : false;
  const incompatibleScte35Output =
    settings.scte35PlanningEnabled && settings.protocol.startsWith("RTMP");

  return (
    <main className="broadcast-screen screen-body">
      <section className="settings-column">
        <div className="settings-heading settings-heading-row">
          <div>
            <h1>Encoding Settings</h1>
            <p>
              Configure video, audio, transport, and streaming parameters for
              your broadcast pipeline.
            </p>
          </div>
          <div className="playout-actions">
            <button
              aria-pressed={settings.repeatSchedule}
              className={`schedule-repeat-button ${settings.repeatSchedule ? "active" : ""}`}
              disabled={active}
              onClick={() => update("repeatSchedule", !settings.repeatSchedule)}
              title="Restart the playlist from the first clip after the last clip finishes"
              type="button"
            >
              <Repeat2 size={15} /> Repeat
            </button>
            <span className={`playout-state state-${playoutStatus?.state ?? "idle"}`}>
              {playoutStatus?.state ?? "idle"}
            </span>
            {active ? (
              <button
                className="danger-button"
                disabled={playoutStatus?.state === "stopping"}
                onClick={onStop}
                type="button"
              >
                <Square fill="currentColor" size={13} /> Stop
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={
                  playlistLength === 0 ||
                  !settings.streamingEnabled ||
                  incompatibleScte35Output
                }
                onClick={onStart}
                type="button"
              >
                <Radio size={15} /> {recoveryCheckpoint
                  ? "Resume Stream"
                  : scheduleStartMarker
                    ? "Start from Marker"
                    : "Start Stream"}
              </button>
            )}
          </div>
        </div>

        <div className="encoding-profile-toolbar">
          <div>
            <strong>Encoding settings profile</strong>
            <span title={settingsProfileMessage ?? undefined}>
              {settingsProfileMessage ?? "Portable .txt profile · passwords are never exported"}
            </span>
          </div>
          <div className="encoding-profile-actions">
            <button
              disabled={settingsProfileBusy}
              onClick={() => void onSaveSettings()}
              type="button"
            >
              <Download size={14} /> Save .TXT
            </button>
            <button
              disabled={active || settingsProfileBusy}
              onClick={() => window.gruberDesktop
                ? void onImportSettings()
                : settingsFileInput.current?.click()}
              type="button"
            >
              <Upload size={14} /> Import .TXT
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
              <strong>Interrupted playout checkpoint found</strong>
              <span>
                Clip {recoveryCheckpoint.currentItemIndex + 1}: {recoveryCheckpoint.currentItemName ?? "Unknown"}
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
              <strong><MapPin size={14} /> Schedule start clip selected</strong>
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

        <SettingsCard icon={<Video size={16} />} title="Video Codec">
          <SelectField
            label="Codec"
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
            label="Profile"
            onChange={(value) => update("profile", value)}
            options={["Main Profile", "High Profile", "Main 10"]}
            value={settings.profile}
          />
          <SelectField
            label="Level"
            onChange={(value) => update("level", value)}
            options={["4.0", "4.1", "5.0", "5.1", "5.2"]}
            value={settings.level}
          />
          <RangeField
            label="Preset"
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

        <SettingsCard icon={<Grid2X2 size={16} />} title="Resolution & Frame Rate">
          <div className="dimension-row">
            <NumberField
              label="Width"
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
              aria-label="Lock aspect ratio"
              className={`dimension-lock ${settings.dimensionsLocked ? "active" : ""}`}
              onClick={() =>
                update("dimensionsLocked", !settings.dimensionsLocked)
              }
              type="button"
            >
              <LockKeyhole size={17} />
            </button>
            <NumberField
              label="Height"
              onChange={(value) => update("height", value)}
              value={settings.height}
            />
          </div>
          <SelectField
            label="Frame Rate"
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
            label="Field Order"
            onChange={(value) => update("fieldOrder", value)}
            options={[
              { label: "Progressive", value: "progressive" },
              { label: "Upper field first (TFF)", value: "upper" },
              { label: "Lower field first (BFF)", value: "lower" },
            ]}
            value={settings.fieldOrder}
          />
          <ToggleField
            checked={settings.deinterlace}
            label="Deinterlace Filter (YADIF)"
            onChange={(checked) => update("deinterlace", checked)}
          />
        </SettingsCard>

        <SettingsCard icon={<Rows3 size={16} />} title="GOP Structure (I/P/B)">
          <div className="three-column-fields">
            <NumberField
              label="GOP length (frames)"
              max={600}
              min={1}
              onChange={(value) => update("gopSize", value)}
              value={settings.gopSize}
            />
            <NumberField
              label="Consecutive B-frames"
              max={settings.videoCodec === "MPEG-2 Video" ? 2 : 16}
              min={0}
              onChange={(value) => update("bFrames", value)}
              value={settings.bFrames}
            />
            <SelectField
              label="GOP mode"
              onChange={(value) => update("closedGop", value === "closed")}
              options={[
                { label: "Closed GOP", value: "closed" },
                { label: "Open GOP", value: "open" },
              ]}
              value={settings.closedGop ? "closed" : "open"}
            />
          </div>
          <p className="gop-setting-note">
            {gopStructureSummary(settings)}
          </p>
        </SettingsCard>

        <SettingsCard
          icon={<ChartNoAxesColumnIncreasing size={16} />}
          title="Bitrate Control"
        >
          <SelectField
            label="Rate Control Mode"
            onChange={(value) => update("rateControl", value)}
            options={["CBR", "VBR", "CRF"]}
            value={settings.rateControl}
          />
          <RangeField
            label="Target Bitrate"
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
              label="Max Bitrate (Mbps)"
              onChange={(value) => update("maxBitrate", value)}
              step={0.5}
              value={settings.maxBitrate}
            />
            <NumberField
              label="VBV Buffer (kbit)"
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

        <SettingsCard icon={<AudioLines size={16} />} title="Audio">
          <div className="two-column-fields">
            <SelectField
              label="Codec"
              onChange={(value) => update("audioCodec", value)}
              options={["AAC-LC", "MP2", "AC-3"]}
              value={settings.audioCodec}
            />
            <SelectField
              label="Sample Rate"
              onChange={(value) => update("sampleRate", value)}
              options={["44100 Hz", "48000 Hz", "96000 Hz"]}
              value={settings.sampleRate}
            />
          </div>
          <SelectField
            label="Channels"
            onChange={(value) => update("channels", value)}
            options={["Mono", "Stereo (L/R)", "5.1"]}
            value={settings.channels}
          />
          <RangeField
            label="Audio Bitrate"
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
        </SettingsCard>

        <SettingsCard
          headerAction={
            <ToggleField
              checked={settings.streamingEnabled}
              compact
              label="Enabled"
              onChange={(checked) => update("streamingEnabled", checked)}
            />
          }
          icon={<Radio size={16} />}
          title="Streaming"
        >
          <SelectField
            disabled={!settings.streamingEnabled}
            label="Protocol"
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
                label="Server URL"
                onChange={(value) => update("rtmpServerUrl", value)}
                value={settings.rtmpServerUrl}
              />
              <SecretField
                disabled={!settings.streamingEnabled}
                label="Stream Key"
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
              label="Planner"
              onChange={(checked) => update("scte35PlanningEnabled", checked)}
            />
          }
          icon={<FlagTriangleRight size={16} />}
          title="SCTE-35 Ad Markers"
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
            label="Cue command"
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
              label="Segmentation owner"
              onChange={(value) => update("scte35Owner", value)}
              options={["Provider", "Distributor"]}
              value={settings.scte35Owner}
            />
            <NumberField
              disabled={!settings.scte35PlanningEnabled}
              label="Default Event ID"
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
              label="Pre-roll (ms)"
              onChange={(value) => update("scte35PreRollMs", Math.min(60_000, value))}
              value={settings.scte35PreRollMs}
            />
            <NumberField
              disabled={!settings.scte35PlanningEnabled}
              label="Default break (sec)"
              onChange={(value) => update("scte35DefaultBreakDuration", Math.min(86_400, Math.max(1, value)))}
              value={settings.scte35DefaultBreakDuration}
            />
          </div>
          <div className="two-column-fields">
            <SelectField
              disabled={!settings.scte35PlanningEnabled}
              label="UPID type"
              onChange={(value) => update("scte35UpidType", value)}
              options={["Ad-ID", "UUID", "URI", "None"]}
              value={settings.scte35UpidType}
            />
            <TextField
              disabled={!settings.scte35PlanningEnabled || settings.scte35UpidType === "None"}
              label="Default UPID"
              onChange={(value) => update("scte35DefaultUpid", value)}
              value={settings.scte35DefaultUpid}
            />
          </div>
          <SelectField
            disabled={!settings.scte35PlanningEnabled || !settings.repeatSchedule}
            label="Event IDs when playlist repeats"
            onChange={(value) => update("scte35LoopEventStrategy", value)}
            options={["Increment each loop", "Reuse playlist Event IDs"]}
            value={settings.scte35LoopEventStrategy}
          />
          <div className={`scte35-runtime-note ${settings.protocol.startsWith("RTMP") ? "warning" : ""}`}>
            <FlagTriangleRight size={15} />
            <span>
              {settings.protocol.startsWith("RTMP")
                ? "RTMP/FLV does not carry the MPEG-TS SCTE-35 PID. Use UDP or SRT MPEG-TS for cue delivery."
                : "FFmpeg sends CBR MPEG-TS through the TSDuck injector. The output PMT announces the SCTE-35 PID and each marker is emitted twice before its event time."}
            </span>
          </div>
        </SettingsCard>
      </section>

      <EncodingMonitor status={playoutStatus} />
    </main>
  );
}

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

function EncodingMonitor({ status }: { status: PlayoutStatus | null }) {
  const active = status
    ? ["starting", "running", "stopping"].includes(status.state)
    : false;
  const previewUrl = active && status?.previewPath
    ? mediaApiUrl(status.previewPath)
    : null;
  const progress = status?.progressPercent ?? 0;
  const remainingSeconds = Math.max(
    0,
    (status?.totalDurationSeconds ?? 0) - (status?.outTimeSeconds ?? 0),
  );
  return (
    <aside className="encoding-monitor">
      <div className="monitor-heading">
        <h2>Encoding Monitor</h2>
        <span className={`live-pill ${active ? "" : "inactive"}`}>
          {status?.state ?? "Idle"}
        </span>
      </div>

      <div className="monitor-preview-card">
        <div className="monitor-preview">
          <LivePreview
            active={active}
            key={status?.sessionId ?? "idle"}
            source={previewUrl}
          />
          <span className="decoding-status">
            <i /> {active ? "Live Program Preview" : "Preview Idle"}
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
        <div className="monitor-preview-meta">
          <strong>{status?.currentItemName ?? "Waiting for playout"}</strong>
          <span className="speed-tag">×{(status?.speed ?? 0).toFixed(2)} Speed</span>
        </div>
      </div>

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
        action={<span className="muted">Current frame: {status?.frame ?? 0}</span>}
        title="Real-time Stats"
      >
        <div className="stats-list">
          <Stat label="Encoding speed" value={`×${(status?.speed ?? 0).toFixed(2)}`} />
          <Stat label="Output FPS" value={(status?.fps ?? 0).toFixed(2)} />
          <Stat label="Elapsed" value={formatMonitorTime(status?.outTimeSeconds ?? 0)} />
          <Stat label="Remaining" value={formatMonitorTime(remainingSeconds)} />
          <Stat label="Total" value={formatMonitorTime(status?.totalDurationSeconds ?? 0)} />
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
    </aside>
  );
}

function LivePreview({ active, source }: { active: boolean; source: string | null }) {
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
      retryLimit: 30,
    });
  }, [active, source]);

  if (!active || !source) {
    return <img alt="Encoding preview idle" src={mediaPath("program-preview.png")} />;
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
