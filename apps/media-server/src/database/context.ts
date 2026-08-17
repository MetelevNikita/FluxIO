import type { PrismaClient } from "../generated/prisma/client.js";
import type { SecretCipher } from "./secrets.js";

/** Всё, что нужно операции: подключение Prisma и шифр для секретов endpoint. */
export interface DatabaseContext {
  readonly client: PrismaClient;
  readonly secrets: SecretCipher;
}

export type TransactionClient = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];
