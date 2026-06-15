import { invoke } from '@tauri-apps/api/core';
import { parseIpcError } from '@i18n/ipcErrors';
import type { IpcErrorPayload } from '@i18n/types';
import * as commands from './commands';

export class IpcInvokeError extends Error {
  readonly payload: IpcErrorPayload;

  constructor(payload: IpcErrorPayload) {
    super(JSON.stringify(payload));
    this.name = 'IpcInvokeError';
    this.payload = payload;
  }
}

export function getIpcErrorPayload(error: unknown): IpcErrorPayload {
  if (error instanceof IpcInvokeError) {
    return error.payload;
  }
  return parseIpcError(error);
}

export function getIpcErrorMessage(error: unknown): string {
  const payload = getIpcErrorPayload(error);
  return JSON.stringify(payload);
}

export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const payload = getIpcErrorPayload(error);
    console.error(`[IPC] ${command} failed:`, payload, error);
    throw new IpcInvokeError(payload);
  }
}

export async function invokePing(): Promise<string> {
  return commands.ping();
}
