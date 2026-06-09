import { get } from "@vercel/blob";
import Link from "next/link";
import { FlightApp } from "@/components/FlightApp";
import { getBlobOptions } from "@/lib/blobConfig";
import { parseIgcFile } from "@/lib/igcParser";
import { getIgcBlobPath, getMetadataBlobPath, isShareExpired, isValidShareId } from "@/lib/sharedFlights";
import type { ParsedFlight } from "@/types/flight";

type SharedFlightPageProps = {
  params: Promise<{ id: string }>;
};

async function readBlobText(pathname: string) {
  const blob = await get(pathname, { access: "public", ...getBlobOptions() });

  if (!blob?.stream) {
    return null;
  }

  return new Response(blob.stream).text();
}

async function readSharedFilename(id: string) {
  try {
    const metadataText = await readBlobText(getMetadataBlobPath(id));

    if (!metadataText) {
      return "shared-flight.igc";
    }

    const metadata = JSON.parse(metadataText) as { filename?: unknown; title?: unknown };

    return typeof metadata.title === "string" && metadata.title.trim()
      ? metadata.title.trim()
      : typeof metadata.filename === "string" && metadata.filename.trim()
        ? metadata.filename.trim()
        : "shared-flight.igc";
  } catch {
    return "shared-flight.igc";
  }
}

function SharedFlightMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="shared-flight-message">
      <section>
        <p className="eyebrow">IGC Tracker</p>
        <h1>{title}</h1>
        <p>{children}</p>
        <Link href="/">Open the viewer</Link>
      </section>
    </main>
  );
}

export default async function SharedFlightPage({ params }: SharedFlightPageProps) {
  const { id } = await params;

  if (!isValidShareId(id)) {
    return <SharedFlightMessage title="Invalid share link">This flight link is not valid.</SharedFlightMessage>;
  }

  if (isShareExpired(id)) {
    return <SharedFlightMessage title="Flight link expired">Shared flights are available for 24 hours.</SharedFlightMessage>;
  }

  const content = await readBlobText(getIgcBlobPath(id));

  if (!content) {
    return <SharedFlightMessage title="Flight not found">This shared flight is no longer available.</SharedFlightMessage>;
  }

  const filename = await readSharedFilename(id);
  let flight: ParsedFlight;

  try {
    flight = parseIgcFile(content, filename);
  } catch {
    return <SharedFlightMessage title="Could not load flight">This shared IGC file could not be parsed.</SharedFlightMessage>;
  }

  return <FlightApp initialFlight={flight} initialSourceText={content} />;
}
