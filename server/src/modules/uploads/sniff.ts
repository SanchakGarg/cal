// Image format detection from the leading bytes.
/**
 * Magic bytes per format. A file is accepted only when its first bytes match one
 * of these, so a script renamed to .png cannot be stored and later served.
 */
const SIGNATURES: Array<{ ext: string; test: (bytes: Buffer) => boolean }> = [
  { ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", test: (b) => b.subarray(0, 6).toString("latin1").startsWith("GIF8") },
  {
    ext: "webp",
    test: (b) =>
      b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

/**
 * The format the bytes actually are, or null. The declared content type is never
 * consulted: a script renamed to .png must not be stored and later served back.
 */
export function sniffImage(bytes: Buffer): { ext: string } | null {
  const match = SIGNATURES.find((candidate) => candidate.test(bytes));
  // Return only the extension; the predicate is an implementation detail.
  return match ? { ext: match.ext } : null;
}
