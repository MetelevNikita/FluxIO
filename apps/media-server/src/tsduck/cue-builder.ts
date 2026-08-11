import type {
  Scte35Marker,
  StartPlayoutRequest,
} from "@gruber/contracts";
import type { PreparedPlayoutItem } from "../ffmpeg/command-builder.js";
import { mpegTsClockOriginSeconds } from "../transport-clock.js";

const scte35ClockRate = 90_000;
const ptsModulo = 2 ** 33;

export interface PlannedScte35Cue {
  eventId: number;
  kind: Scte35Marker["kind"];
  markerId: string;
  programTimeSeconds: number;
  pts: number;
  durationTicks: number | null;
  segmentationTypeId: number;
  upid: string;
}

export function planScte35Cues(
  request: StartPlayoutRequest,
  items: PreparedPlayoutItem[],
  loopCount = 0,
): PlannedScte35Cue[] {
  const preparedById = new Map(items.map((item) => [item.id, item]));
  const cues: PlannedScte35Cue[] = [];
  let elapsed = 0;

  for (const playlistItem of request.playlist) {
    const prepared = preparedById.get(playlistItem.id);
    if (!prepared) {
      throw new Error(`Prepared clip not found for SCTE-35 item ${playlistItem.name}`);
    }
    for (const marker of playlistItem.scte35Markers) {
      const relativeTime = marker.positionSeconds - prepared.trimInSeconds;
      if (relativeTime < 0 || relativeTime > prepared.durationSeconds) {
        throw new Error(
          `SCTE-35 marker ${marker.eventId} is outside the active trim range of ${playlistItem.name}`,
        );
      }
      const programTimeSeconds = quantizeToFrame(
        elapsed + relativeTime,
        request.video.frameRate,
      );
      const eventId = request.scte35.loopEventStrategy === "increment"
        ? (marker.eventId + loopCount) % 4_294_967_296
        : marker.eventId;
      cues.push({
        eventId,
        kind: marker.kind,
        markerId: marker.id,
        programTimeSeconds,
        pts: Math.round(
          (mpegTsClockOriginSeconds + programTimeSeconds) * scte35ClockRate,
        ) % ptsModulo,
        durationTicks: marker.durationSeconds == null
          ? null
          : Math.round(marker.durationSeconds * scte35ClockRate),
        segmentationTypeId: marker.segmentationTypeId,
        upid: marker.upid || request.scte35.defaultUpid,
      });
    }
    elapsed += prepared.durationSeconds;
  }

  return cues.sort((left, right) =>
    left.programTimeSeconds - right.programTimeSeconds || left.eventId - right.eventId
  );
}

export function buildScte35CueXml(
  request: StartPlayoutRequest,
  cues: PlannedScte35Cue[],
): string {
  const tables = cues.map((cue) => buildCueTable(request, cue)).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tsduck>\n${tables}\n</tsduck>\n`;
}

function buildCueTable(
  request: StartPlayoutRequest,
  cue: PlannedScte35Cue,
): string {
  const command = request.scte35.command === "splice_insert"
    ? buildSpliceInsert(cue)
    : `    <time_signal pts_time="${cue.pts}"/>`;
  const duration = cue.durationTicks == null
    ? ""
    : ` segmentation_duration="${cue.durationTicks}"`;
  const subSegment = [0x34, 0x36].includes(cue.segmentationTypeId)
    ? ' sub_segment_num="1" sub_segments_expected="1"'
    : "";
  const upidType = upidTypeCode(request.scte35.upidType);
  const upidHex = encodeUpid(request.scte35.upidType, cue.upid);

  return [
    '  <splice_information_table protocol_version="0" pts_adjustment="0" tier="0xFFF">',
    command,
    `    <splice_segmentation_descriptor segmentation_event_id="${cue.eventId}"${duration} segmentation_type_id="0x${cue.segmentationTypeId.toString(16).padStart(2, "0")}" segment_num="1" segments_expected="1"${subSegment}>`,
    `      <segmentation_upid type="0x${upidType.toString(16).padStart(2, "0")}">${upidHex}</segmentation_upid>`,
    "    </splice_segmentation_descriptor>",
    "  </splice_information_table>",
  ].join("\n");
}

function buildSpliceInsert(cue: PlannedScte35Cue): string {
  const outOfNetwork = cue.kind === "break-start";
  const duration = cue.durationTicks == null
    ? ""
    : `\n      <break_duration auto_return="true" duration="${cue.durationTicks}"/>`;
  return `    <splice_insert splice_event_id="${cue.eventId}" splice_event_cancel="false" out_of_network="${outOfNetwork}" splice_immediate="false" pts_time="${cue.pts}" unique_program_id="${cue.eventId % 65_536}" avail_num="1" avails_expected="1">${duration}\n    </splice_insert>`;
}

function encodeUpid(
  type: StartPlayoutRequest["scte35"]["upidType"],
  value: string,
): string {
  if (type === "none" || !value) return "";
  if (type === "uuid") {
    const normalized = value.replaceAll("-", "");
    if (!/^[0-9A-Fa-f]{32}$/.test(normalized)) {
      throw new Error("SCTE-35 UUID UPID must contain 32 hexadecimal characters");
    }
    return normalized.toUpperCase();
  }
  return Buffer.from(value, "utf8").toString("hex").toUpperCase();
}

function upidTypeCode(type: StartPlayoutRequest["scte35"]["upidType"]): number {
  if (type === "ad-id") return 0x03;
  if (type === "uri") return 0x0f;
  if (type === "uuid") return 0x10;
  return 0x00;
}

function quantizeToFrame(value: number, frameRate: number): number {
  return Math.round(value * frameRate) / frameRate;
}
