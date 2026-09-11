export type ImageFormat = "jpg" | "png";

const IMAGE_SIGNATURES: Record<ImageFormat, readonly number[]> = {
  jpg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

const ZIP_END_OF_CENTRAL_DIRECTORY = [0x50, 0x4b, 0x05, 0x06];
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const TOTAL_ENTRIES_OFFSET = 10;
const ARCHIVE_TAIL_BYTES = 1_024;

export function hasSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[index] === byte);
}

export function isImageOfFormat(head: Uint8Array, format: ImageFormat): boolean {
  return hasSignature(head, IMAGE_SIGNATURES[format]);
}

/**
 * Reads the entry count out of a ZIP end-of-central-directory record.
 *
 * Only the tail of the archive is needed, so a large result never has to be
 * read back into memory just to be checked. Archives here are capped well under
 * the 65535 entries that would require ZIP64.
 */
export function readArchiveEntryCount(tail: Uint8Array): number {
  for (let offset = tail.length - END_OF_CENTRAL_DIRECTORY_SIZE; offset >= 0; offset -= 1) {
    if (hasSignature(tail.subarray(offset), ZIP_END_OF_CENTRAL_DIRECTORY)) {
      return tail[offset + TOTAL_ENTRIES_OFFSET] | (tail[offset + TOTAL_ENTRIES_OFFSET + 1] << 8);
    }
  }
  throw new Error("ไฟล์ ZIP ที่สร้างไม่สมบูรณ์ ระบบจึงหยุดดาวน์โหลดเพื่อความปลอดภัย");
}

/**
 * Checks a finished archive against the number of entries it should hold.
 *
 * Reads only the tail, so verifying a large result never pulls it back into
 * memory.
 */
export async function verifyArchiveEntryCount(blob: Blob, expectedEntries: number): Promise<void> {
  const tailSize = Math.min(blob.size, ARCHIVE_TAIL_BYTES);
  const tail = new Uint8Array(await blob.slice(blob.size - tailSize).arrayBuffer());
  const actualEntries = readArchiveEntryCount(tail);
  if (actualEntries !== expectedEntries) {
    throw new Error(
      `ไฟล์ ZIP มี ${actualEntries} ไฟล์ แต่ควรมี ${expectedEntries} ไฟล์ ระบบจึงหยุดดาวน์โหลดเพื่อความปลอดภัย`,
    );
  }
}
