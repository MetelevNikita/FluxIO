import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM для SRT passphrase и RTMP stream key.
 * Ключ берётся из GRUBER_SECRET_KEY; без него секреты не читаются и не пишутся.
 */
export class SecretCipher {
  #key: Buffer | null;

  constructor(secretKeyBase64?: string) {
    this.#key = parseSecretKey(secretKeyBase64);
  }

  encrypt(value: string): string {
    const key = this.#key;
    if (!key) {
      throw new Error(
        "GRUBER_SECRET_KEY (32-byte base64) is required to store SRT/RTMP secrets",
      );
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [iv, tag, encrypted].map((part) => part.toString("base64")).join(".");
  }

  decrypt(value: string): string {
    const key = this.#key;
    if (!key) {
      throw new Error("GRUBER_SECRET_KEY is required to read endpoint secrets");
    }

    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue) {
      throw new Error("Stored endpoint secret is invalid");
    }

    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}

function parseSecretKey(value: string | undefined): Buffer | null {
  if (!value) return null;

  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("GRUBER_SECRET_KEY must decode to exactly 32 bytes");
  }

  return key;
}
