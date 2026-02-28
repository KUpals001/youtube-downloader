import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getMetadata } from "../../../lib/metadata";

/**
 * GET handler for fetching track metadata from external sources.
 * 
 * @param req - The Next.js request object.
 * @returns Response containing MetadataResult.
 */
export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get("title");
  const channel = req.nextUrl.searchParams.get("channel") || "";
  const uploadDate = req.nextUrl.searchParams.get("uploadDate") || "";
  const mbId = req.nextUrl.searchParams.get("mbId") || undefined;
  const discogsId = req.nextUrl.searchParams.get("discogsId") || undefined;
  const deezerId = req.nextUrl.searchParams.get("deezerId") || undefined;

  if (!title) {
    return Response.json({ error: "Title required" }, { status: 400 });
  }

  try {
    const meta = await getMetadata(
      title,
      channel,
      uploadDate,
      mbId,
      discogsId,
      deezerId,
    );
    return Response.json(meta);
  } catch (e) {
    logger.error("[metadata] error:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
