CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "OutputProtocol" AS ENUM ('UDP', 'SRT', 'RTMP');
CREATE TYPE "BroadcastSessionState" AS ENUM ('STARTING', 'RUNNING', 'STOPPING', 'COMPLETED', 'FAILED', 'STOPPED');

CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "filePath" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationSeconds" DOUBLE PRECISION NOT NULL,
    "videoCodec" TEXT NOT NULL,
    "videoProfile" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "frameRate" DOUBLE PRECISION NOT NULL,
    "bitrate" BIGINT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "pixelFormat" TEXT NOT NULL,
    "colorSpace" TEXT NOT NULL,
    "hasAudio" BOOLEAN NOT NULL,
    "audioCodec" TEXT,
    "audioSampleRate" INTEGER,
    "audioChannels" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Playlist" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistItem" (
    "id" UUID NOT NULL,
    "playlistId" UUID NOT NULL,
    "mediaAssetId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "trimInSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trimOutSeconds" DOUBLE PRECISION,
    CONSTRAINT "PlaylistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EncodingProfile" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EncodingProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutputEndpoint" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" "OutputProtocol" NOT NULL,
    "configuration" JSONB NOT NULL,
    "encryptedSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutputEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BroadcastSession" (
    "id" UUID NOT NULL,
    "runtimeSessionId" UUID,
    "state" "BroadcastSessionState" NOT NULL,
    "playlistId" UUID,
    "profileId" UUID,
    "endpointId" UUID,
    "requestSnapshot" JSONB NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BroadcastSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BroadcastConfiguration" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "playlistId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BroadcastConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaAsset_filePath_key" ON "MediaAsset"("filePath");
CREATE INDEX "MediaAsset_name_idx" ON "MediaAsset"("name");
CREATE INDEX "Playlist_updatedAt_idx" ON "Playlist"("updatedAt");
CREATE INDEX "PlaylistItem_mediaAssetId_idx" ON "PlaylistItem"("mediaAssetId");
CREATE UNIQUE INDEX "PlaylistItem_playlistId_position_key" ON "PlaylistItem"("playlistId", "position");
CREATE UNIQUE INDEX "EncodingProfile_name_key" ON "EncodingProfile"("name");
CREATE UNIQUE INDEX "OutputEndpoint_name_key" ON "OutputEndpoint"("name");
CREATE INDEX "OutputEndpoint_protocol_idx" ON "OutputEndpoint"("protocol");
CREATE UNIQUE INDEX "BroadcastSession_runtimeSessionId_key" ON "BroadcastSession"("runtimeSessionId");
CREATE INDEX "BroadcastSession_state_startedAt_idx" ON "BroadcastSession"("state", "startedAt");
CREATE INDEX "BroadcastSession_playlistId_idx" ON "BroadcastSession"("playlistId");
CREATE UNIQUE INDEX "BroadcastConfiguration_name_key" ON "BroadcastConfiguration"("name");
CREATE INDEX "BroadcastConfiguration_updatedAt_idx" ON "BroadcastConfiguration"("updatedAt");

ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BroadcastSession" ADD CONSTRAINT "BroadcastSession_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BroadcastSession" ADD CONSTRAINT "BroadcastSession_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "EncodingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BroadcastSession" ADD CONSTRAINT "BroadcastSession_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "OutputEndpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BroadcastConfiguration" ADD CONSTRAINT "BroadcastConfiguration_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BroadcastConfiguration" ADD CONSTRAINT "BroadcastConfiguration_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "EncodingProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BroadcastConfiguration" ADD CONSTRAINT "BroadcastConfiguration_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "OutputEndpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
