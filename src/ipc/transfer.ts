import { safeInvoke } from './client';

export async function cancelTransfer(transferId: string): Promise<void> {
  await safeInvoke('transfer_cancel', { transferId });
}

export async function cancelAllTransfers(connectionId: string): Promise<void> {
  await safeInvoke('transfer_cancel_all', { connectionId });
}
