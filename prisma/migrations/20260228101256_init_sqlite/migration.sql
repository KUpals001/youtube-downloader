-- CreateTable
CREATE TABLE "video_metadata" (
    "youtube_id" TEXT NOT NULL PRIMARY KEY,
    "youtube_title" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "upload_date" TEXT,
    "normalized_artist" TEXT NOT NULL,
    "normalized_title" TEXT NOT NULL,
    "album" TEXT,
    "year" TEXT,
    "track_number" TEXT,
    "genre" TEXT,
    "source" TEXT NOT NULL,
    "fullMetadata" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "video_metadata_normalized_artist_normalized_title_idx" ON "video_metadata"("normalized_artist", "normalized_title");

-- CreateIndex
CREATE INDEX "video_metadata_youtube_title_idx" ON "video_metadata"("youtube_title");

-- CreateIndex
CREATE INDEX "video_metadata_channel_idx" ON "video_metadata"("channel");
