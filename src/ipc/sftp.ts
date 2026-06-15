import type { ListDirResponse, RecursiveFileEntry } from '@/types';
import { safeInvoke } from './client';

export async function sftpListDir(
  connectionId: string,
  path: string,
): Promise<ListDirResponse> {
  return safeInvoke<ListDirResponse>('sftp_list_dir', { connectionId, path });
}

export async function sftpUpload(
  connectionId: string,
  localPath: string,
  remotePath: string,
  transferId?: string,
): Promise<void> {
  await safeInvoke('sftp_upload', {
    connectionId,
    localPath,
    remotePath,
    transferId: transferId ?? null,
  });
}

export async function sftpDownload(
  connectionId: string,
  remotePath: string,
  localPath: string,
  isDirectory: boolean,
  transferId?: string,
): Promise<void> {
  await safeInvoke('sftp_download', {
    connectionId,
    remotePath,
    localPath,
    isDirectory,
    transferId: transferId ?? null,
  });
}

export async function sftpMkdir(
  connectionId: string,
  remotePath: string,
): Promise<void> {
  await safeInvoke('sftp_mkdir', { connectionId, remotePath });
}

export async function sftpDelete(
  connectionId: string,
  remotePath: string,
  isDirectory: boolean,
): Promise<void> {
  await safeInvoke('sftp_delete', { connectionId, remotePath, isDirectory });
}

export async function sftpRename(
  connectionId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  await safeInvoke('sftp_rename', { connectionId, oldPath, newPath });
}

export interface FetchToCacheResponse {
  localPath: string;
}

export interface CountFilesResponse {
  count: number;
}

export async function sftpFetchToCache(
  connectionId: string,
  remotePath: string,
): Promise<FetchToCacheResponse> {
  return safeInvoke<FetchToCacheResponse>('sftp_fetch_to_cache', {
    connectionId,
    remotePath,
  });
}

export async function sftpCountFiles(
  connectionId: string,
  remotePath: string,
): Promise<CountFilesResponse> {
  return safeInvoke<CountFilesResponse>('sftp_count_files', {
    connectionId,
    remotePath,
  });
}

export async function sftpListRecursive(
  connectionId: string,
  remotePath: string,
): Promise<RecursiveFileEntry[]> {
  return safeInvoke<RecursiveFileEntry[]>('sftp_list_recursive', {
    connectionId,
    remotePath,
  });
}
