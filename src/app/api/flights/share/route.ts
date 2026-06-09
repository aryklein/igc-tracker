import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getBlobOptions } from "@/lib/blobConfig";
import { parseIgcFile } from "@/lib/igcParser";
import { generateShareId, getIgcBlobPath, getMetadataBlobPath, getShareExpiresAt } from "@/lib/sharedFlights";

const MAX_IGC_BYTES = 2 * 1024 * 1024;

type ShareRequest = {
  filename?: unknown;
  content?: unknown;
  title?: unknown;
};

export async function POST(request: Request) {
  let payload: ShareRequest;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid share request." }, { status: 400 });
  }

  if (typeof payload.content !== "string" || payload.content.trim().length === 0) {
    return NextResponse.json({ error: "Missing IGC content." }, { status: 400 });
  }

  const contentBytes = new TextEncoder().encode(payload.content).byteLength;

  if (contentBytes > MAX_IGC_BYTES) {
    return NextResponse.json({ error: "This IGC file is too large to share." }, { status: 413 });
  }

  const filename = typeof payload.filename === "string" && payload.filename.trim() ? payload.filename.trim() : "flight.igc";
  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : filename;

  try {
    parseIgcFile(payload.content, filename);
  } catch {
    return NextResponse.json({ error: "This IGC file could not be parsed." }, { status: 400 });
  }

  const id = generateShareId();
  const expiresAt = getShareExpiresAt(id);

  if (!expiresAt) {
    return NextResponse.json({ error: "Could not create share link." }, { status: 500 });
  }

  try {
    const blobOptions = getBlobOptions();

    await put(getIgcBlobPath(id), payload.content, {
      access: "public",
      addRandomSuffix: false,
      contentType: "text/plain; charset=utf-8",
      ...blobOptions,
    });
    await put(
      getMetadataBlobPath(id),
      JSON.stringify({ filename, title, createdAt: new Date().toISOString(), expiresAt: expiresAt.toISOString() }),
      {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json; charset=utf-8",
        ...blobOptions,
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not store this shared flight." },
      { status: 500 },
    );
  }

  return NextResponse.json({ id, url: `/f/${id}`, expiresAt: expiresAt.toISOString() });
}
