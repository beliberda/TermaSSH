import type { ShellInfo } from '@/types';
import { safeInvoke } from './client';

export interface ConnectResponse {
  connectionId: string;
}

export async function terminalConnect(
  sessionId: string,
  password?: string,
): Promise<ConnectResponse> {
  return safeInvoke<ConnectResponse>('terminal_connect', {
    sessionId,
    password: password ?? null,
  });
}

export async function terminalDisconnect(connectionId: string): Promise<void> {
  await safeInvoke('terminal_disconnect', { connectionId });
}

export async function terminalWrite(
  connectionId: string,
  data: string,
): Promise<void> {
  await safeInvoke('terminal_write', { connectionId, data });
}

export async function terminalResize(
  connectionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  await safeInvoke('terminal_resize', {
    connectionId,
    cols,
    rows,
  });
}

export async function localShellList(): Promise<ShellInfo[]> {
  return safeInvoke<ShellInfo[]>('local_shell_list');
}

export async function localShellConnect(shellId: string): Promise<ConnectResponse> {
  return safeInvoke<ConnectResponse>('local_shell_connect', { shellId });
}
