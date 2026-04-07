// src/utils/fileUtils.ts
import fs from "fs";
import path from "path";

const fsp = fs.promises;

export async function ensureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true });
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function readJson<T = unknown>(filePath: string): Promise<T | null> {
  try {
    const content = await fsp.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return null; // file not found
    }
    throw err;
  }
}
