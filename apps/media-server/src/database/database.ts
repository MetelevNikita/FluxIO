import { PrismaPg } from "@prisma/adapter-pg";
import type {
  BroadcastConfigurationSummary,
  MediaProbe,
  PlayoutStatus,
  SaveBroadcastConfigurationRequest,
  SavedBroadcastConfiguration,
  SavedWorkspaceSession,
  StartPlayoutRequest,
  WorkspaceSessionSaveRequest,
} from "@gruber/contracts";

//

import { PrismaClient } from "../generated/prisma/client.js";
import type { DatabaseContext } from "./context.js";
import { SecretCipher } from "./secrets.js";
import {
  recordSessionStart,
  syncSession,
} from "./operations/broadcastSession.js";
import { getConfiguration } from "./operations/getConfiguration.js";
import {
  deleteConfiguration,
  listConfigurations,
} from "./operations/listConfigurations.js";
import { saveConfiguration } from "./operations/saveConfiguration.js";
import {
  deleteWorkspaceSession,
  getWorkspaceSession,
  saveWorkspaceSession,
  syncWorkspaceCheckpoint,
} from "./operations/workspaceSession.js";

export {
  checkpointFromStatus,
  recoverableCheckpointFromStatus,
  sanitizeWorkspaceSnapshot,
} from "./checkpoint.js";

/**
 * Подключение к PostgreSQL. Класс держит только Prisma-клиент и шифр секретов;
 * каждая операция живёт отдельным файлом в ./operations.
 */
export class DatabaseService implements DatabaseContext {
  readonly client: PrismaClient;
  readonly secrets: SecretCipher;

  constructor(connectionString: string, secretKeyBase64?: string) {
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    this.secrets = new SecretCipher(secretKeyBase64);
  }

  static fromEnvironment(): DatabaseService | null {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return null;

    return new DatabaseService(connectionString, process.env.GRUBER_SECRET_KEY);
  }

  async connect(): Promise<void> {
    await this.client.$connect();
  }

  async disconnect(): Promise<void> {
    await this.client.$disconnect();
  }

  //
  // Broadcast configurations
  //

  async saveConfiguration(
    input: SaveBroadcastConfigurationRequest,
    probes: MediaProbe[],
  ): Promise<SavedBroadcastConfiguration> {
    return saveConfiguration(this, input, probes);
  }

  async listConfigurations(): Promise<BroadcastConfigurationSummary[]> {
    return listConfigurations(this);
  }

  async getConfiguration(id: string): Promise<SavedBroadcastConfiguration> {
    return getConfiguration(this, id);
  }

  async deleteConfiguration(id: string): Promise<void> {
    return deleteConfiguration(this, id);
  }

  //
  // Workspace session и recovery checkpoint
  //

  async saveWorkspaceSession(
    input: WorkspaceSessionSaveRequest,
    status: PlayoutStatus,
  ): Promise<SavedWorkspaceSession> {
    return saveWorkspaceSession(this, input, status);
  }

  async getWorkspaceSession(status: PlayoutStatus): Promise<SavedWorkspaceSession | null> {
    return getWorkspaceSession(this, status);
  }

  async deleteWorkspaceSession(): Promise<void> {
    return deleteWorkspaceSession(this);
  }

  async syncWorkspaceCheckpoint(status: PlayoutStatus): Promise<void> {
    return syncWorkspaceCheckpoint(this, status);
  }

  //
  // История эфирных сессий
  //

  async recordSessionStart(
    request: StartPlayoutRequest,
    status: PlayoutStatus,
  ): Promise<void> {
    return recordSessionStart(this, request, status);
  }

  async syncSession(status: PlayoutStatus): Promise<void> {
    return syncSession(this, status);
  }
}
