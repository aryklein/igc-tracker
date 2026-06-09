import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getBlobOptions } from "@/lib/blobConfig";
import { getMetadataBlobPath, getShareIdFromPath, isShareExpired, SHARED_FLIGHT_PREFIX } from "@/lib/sharedFlights";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deleted: string[] = [];
  let cursor: string | undefined;

  try {
    const blobOptions = getBlobOptions();

    do {
      const result = await list({ cursor, limit: 1000, prefix: SHARED_FLIGHT_PREFIX, ...blobOptions });
      const expiredPaths = result.blobs
        .map((blob) => {
          const id = getShareIdFromPath(blob.pathname);

          return id && isShareExpired(id) ? [blob.pathname, getMetadataBlobPath(id)] : [];
        })
        .flat();

      if (expiredPaths.length > 0) {
        await del(expiredPaths, blobOptions);
        deleted.push(...expiredPaths);
      }

      cursor = result.cursor;
    } while (cursor);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not clean up shared flights." },
      { status: 500 },
    );
  }

  return NextResponse.json({ deletedCount: deleted.length });
}
