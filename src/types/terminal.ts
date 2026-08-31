import { z } from 'zod';
import type { AppError } from '@i18n/types';
import type { ConnectionStatus } from './index';

export const ipcErrorSchema = z.object({
  code: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const connectionStatusPayloadSchema = z.object({
  connectionId: z.string(),
  status: z.enum(['connecting', 'connected', 'disconnected', 'error']),
  error: ipcErrorSchema.optional(),
});

export const terminalOutputPayloadSchema = z.object({
  connectionId: z.string(),
  data: z.string(),
});

export type WorkspaceView = 'terminal' | 'files';

export type TerminalTabKind = 'ssh' | 'local';

export interface TerminalTab {
  id: string;
  kind: TerminalTabKind;
  /** Set for kind 'ssh' — the saved session this tab connects to. */
  sessionId?: string;
  /** Set for kind 'local' — the shell id passed to local_shell_connect. */
  shellId?: string;
  connectionId?: string;
  title: string;
  status: ConnectionStatus;
  error?: AppError;
  connectStartedAt?: number;
  connectLatencyMs?: number;
  reconnecting?: boolean;
  workspaceView?: WorkspaceView;
}

export interface ShellInfo {
  id: string;
  label: string;
}

export type ConnectionStatusPayload = z.infer<typeof connectionStatusPayloadSchema>;
export type TerminalOutputPayload = z.infer<typeof terminalOutputPayloadSchema>;
