import { z } from 'zod';

export const transferProgressPayloadSchema = z.object({
  transferId: z.string(),
  connectionId: z.string(),
  fileName: z.string(),
  direction: z.enum(['upload', 'download']),
  bytesDone: z.number(),
  bytesTotal: z.number(),
  status: z.enum(['running', 'done', 'error', 'cancelled']),
});

export type TransferProgressPayload = z.infer<typeof transferProgressPayloadSchema>;

export type TransferDirection = 'upload' | 'download';
export type TransferStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled';

export interface TransferTask {
  id: string;
  connectionId: string;
  fileName: string;
  direction: TransferDirection;
  localPath: string;
  remotePath: string;
  isDirectory: boolean;
  status: TransferStatus;
  bytesDone: number;
  bytesTotal: number;
  error?: string;
}

export interface FileConflictInfo {
  fileName: string;
  localPath: string;
  remotePath: string;
  localSize: number;
  remoteSize: number;
  localModifiedAt?: string;
  remoteModifiedAt?: string;
}
