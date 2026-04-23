import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";
import type { ClioTokens } from "./oauth.js";

const TOKEN_DIR = path.join(os.homedir(), ".clio-mcp");
const TOKEN_FILE = path.join(TOKEN_DIR, "tokens.enc");

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) throw new Error("ENCRYPTION_KEY is not set in .env!");
  if (keyHex.length !== 64)
    throw new Error(`ENCRYPTION_KEY must be 64 hex chars (32 bytes for AES-256). Got ${keyHex.length}.`);
  return Buffer.from(keyHex, "hex");
}

export async function saveTokens(tokens: ClioTokens): Promise<void> {
  await fs.mkdir(TOKEN_DIR, { recursive: true });

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(tokens);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, authTag, encrypted]);
  await fs.writeFile(TOKEN_FILE, combined);
}

export async function loadTokens(): Promise<ClioTokens | null> {
  let combined: Buffer;
  try {
    combined = await fs.readFile(TOKEN_FILE);
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }

  try {
    const key = getEncryptionKey();
    const iv = combined.subarray(0, 16);
    const authTag = combined.subarray(16, 32);
    const encrypted = combined.subarray(32);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf8")) as ClioTokens;
  } catch (err: any) {
    console.error(
      `[tokenStorage] WARNING: Token file exists but decryption failed. ` +
      `File may be corrupt or ENCRYPTION_KEY has changed. Detail: ${err.message}`
    );
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  try {
    await fs.unlink(TOKEN_FILE);
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err; // ENOENT = already gone, that's fine
  }
}