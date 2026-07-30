import type { SftpEntry } from "@/types";
import { safeInvoke } from "./client";

export interface LocalStat {
  exists: boolean;
  isDirectory: boolean;
  size: number;
  modifiedAt?: string;
}

export async function localListDir(path: string): Promise<SftpEntry[]> {
  return safeInvoke<SftpEntry[]>("local_list_dir", { path });
}

export async function localStat(path: string): Promise<LocalStat> {
  return safeInvoke<LocalStat>("local_stat", { path });
}

export async function localExists(path: string): Promise<boolean> {
  return safeInvoke<boolean>("local_exists", { path });
}

export async function localMkdir(path: string): Promise<void> {
  await safeInvoke("local_mkdir", { path });
}

export async function localRename(
  oldPath: string,
  newPath: string,
): Promise<void> {
  await safeInvoke("local_rename", { oldPath, newPath });
}

export async function localDelete(
  path: string,
  isDirectory: boolean,
): Promise<void> {
  await safeInvoke("local_delete", { path, isDirectory });
}

export async function localHomeDir(): Promise<string | null> {
  const result = await safeInvoke<string | null>("local_home_dir");
  return result;
}

export async function localRevealInExplorer(path: string): Promise<void> {
  await safeInvoke("local_reveal_in_explorer", { path });
}

export interface RecursiveLocalFile {
  path: string;
  name: string;
  relativePath: string;
  size: number;
  modifiedAt?: string;
}

export async function localListRecursive(
  path: string,
): Promise<RecursiveLocalFile[]> {
  return safeInvoke<RecursiveLocalFile[]>("local_list_recursive", { path });
}

export async function localStageUpload(
  fileName: string,
  dataBase64: string,
): Promise<string> {
  return safeInvoke<string>("local_stage_upload", {
    fileName,
    dataBase64,
  });
}
