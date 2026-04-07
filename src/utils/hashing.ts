// src/utils/hashing.ts
import crypto from "crypto";

export function sha256Bytes(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
