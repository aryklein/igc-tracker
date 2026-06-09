export function getBlobOptions() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return { token: process.env.BLOB_READ_WRITE_TOKEN };
  }

  if (process.env.BLOB_STORE_ID) {
    return { storeId: process.env.BLOB_STORE_ID };
  }

  throw new Error(
    "Blob storage is not configured. Deploy to Vercel with a connected Blob store or add BLOB_READ_WRITE_TOKEN locally.",
  );
}
