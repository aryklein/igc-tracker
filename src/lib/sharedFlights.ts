export const SHARED_FLIGHT_PREFIX = "shared-flights/";
export const SHARED_FLIGHT_TTL_MS = 24 * 60 * 60 * 1000;

const SHARE_ID_PATTERN = /^(\d{8}T\d{6}Z)_[a-z0-9]{10}$/;

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

export function formatShareTimestamp(date: Date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(
    date.getUTCHours(),
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function generateShareId(now = new Date()) {
  const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 10);

  return `${formatShareTimestamp(now)}_${randomPart}`;
}

export function isValidShareId(id: string) {
  return SHARE_ID_PATTERN.test(id);
}

export function parseShareCreatedAt(id: string) {
  const match = id.match(SHARE_ID_PATTERN);

  if (!match) {
    return null;
  }

  const raw = match[1];
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6)) - 1;
  const day = Number(raw.slice(6, 8));
  const hours = Number(raw.slice(9, 11));
  const minutes = Number(raw.slice(11, 13));
  const seconds = Number(raw.slice(13, 15));

  return new Date(Date.UTC(year, month, day, hours, minutes, seconds));
}

export function getShareExpiresAt(id: string) {
  const createdAt = parseShareCreatedAt(id);

  return createdAt ? new Date(createdAt.getTime() + SHARED_FLIGHT_TTL_MS) : null;
}

export function isShareExpired(id: string, now = Date.now()) {
  const expiresAt = getShareExpiresAt(id);

  return !expiresAt || expiresAt.getTime() <= now;
}

export function getIgcBlobPath(id: string) {
  return `${SHARED_FLIGHT_PREFIX}${id}.igc`;
}

export function getMetadataBlobPath(id: string) {
  return `${SHARED_FLIGHT_PREFIX}${id}.json`;
}

export function getShareIdFromPath(pathname: string) {
  if (!pathname.startsWith(SHARED_FLIGHT_PREFIX) || !pathname.endsWith(".igc")) {
    return null;
  }

  const id = pathname.slice(SHARED_FLIGHT_PREFIX.length, -".igc".length);

  return isValidShareId(id) ? id : null;
}
