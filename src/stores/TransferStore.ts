import { makeAutoObservable, runInAction } from 'mobx';
import type { FileConflictPolicy, SessionConfig } from '@/types';
import type {
  FileConflictInfo,
  TransferProgressPayload,
  TransferTask,
} from '@/types/transfer';
import { MAX_CONCURRENT_TRANSFERS_DEFAULT } from '@/types/settings';
import * as localIpc from '@ipc/local';
import * as sftpIpc from '@ipc/sftp';
import * as transferIpc from '@ipc/transfer';
import { getIpcErrorPayload } from '@ipc/client';
import { listenTransferProgress } from '@ipc/events';
import { joinLocalPath, joinRemotePath } from '@utils/filePaths';
import { bytesToBase64 } from '@utils/base64';
import type { LocalBrowserStore } from './LocalBrowserStore';
import type { RemoteBrowserStore } from './RemoteBrowserStore';
import type { SessionStore } from './SessionStore';
import type { SettingsStore } from './SettingsStore';

// Files dropped in from outside the app (e.g. Explorer) go through the
// browser File API: read into memory, base64'd across IPC, staged to disk,
// then uploaded through the normal path-based pipeline. That round trip
// isn't something we want for huge files, so cap it well below what people
// would drag in as a convenience rather than a bulk transfer.
export const MAX_OS_DROP_UPLOAD_BYTES = 200 * 1024 * 1024;

export interface PreparingDownload {
  remotePath: string;
  label: string;
}

export interface PreparingUpload {
  localPath: string;
  label: string;
}

function joinLocalRelative(base: string, relativePath: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  const parts = relativePath.split('/').filter(Boolean);
  let result = base.replace(/[/\\]+$/, '');
  for (const part of parts) {
    result = `${result}${sep}${part}`;
  }
  return result;
}

function joinRemoteRelative(base: string, relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean);
  let result = base.replace(/\/+$/, '') || '/';
  for (const part of parts) {
    result = joinRemotePath(result, part);
  }
  return result;
}

export class TransferStore {
  tasks: TransferTask[] = [];
  queueExpanded = true;
  processing = false;
  queueDrainPending = false;
  preparingDownloads = new Map<string, PreparingDownload>();
  preparingUploads = new Map<string, PreparingUpload>();
  pendingConflict: FileConflictInfo | null = null;
  private conflictResolve: ((value: 'skip' | 'replace') => void) | null = null;
  private sessionOverridePolicy: FileConflictPolicy | null = null;
  private listenersInitialized = false;
  private unlistenFns: Array<() => void> = [];
  private localBrowserStore: LocalBrowserStore | null = null;
  private remoteBrowserStore: RemoteBrowserStore | null = null;
  private sessionStore: SessionStore | null = null;
  private settingsStore: SettingsStore | null = null;
  private activeWorkers = 0;
  private conflictSession: SessionConfig | null = null;
  private cancelledIds = new Set<string>();
  private conflictMutex: Promise<void> = Promise.resolve();

  constructor() {
    makeAutoObservable(this);
  }

  wire(
    localBrowserStore: LocalBrowserStore,
    remoteBrowserStore: RemoteBrowserStore,
    sessionStore: SessionStore,
    settingsStore: SettingsStore,
  ) {
    this.localBrowserStore = localBrowserStore;
    this.remoteBrowserStore = remoteBrowserStore;
    this.sessionStore = sessionStore;
    this.settingsStore = settingsStore;
  }

  async initListeners() {
    if (this.listenersInitialized) return;
    this.listenersInitialized = true;
    const unlisten = await listenTransferProgress((payload) => {
      this.handleProgress(payload);
    });
    this.unlistenFns.push(unlisten);
  }

  get preparingCount(): number {
    return this.preparingDownloads.size;
  }

  get activeCount(): number {
    return (
      this.tasks.filter(
        (t) => t.status === 'running' || t.status === 'queued',
      ).length + this.preparingCount
    );
  }

  get runningCount(): number {
    return this.tasks.filter((t) => t.status === 'running').length;
  }

  get hasActiveTransfers(): boolean {
    return this.activeCount > 0;
  }

  get cancellableCount(): number {
    return this.tasks.filter(
      (t) => t.status === 'queued' || t.status === 'running',
    ).length;
  }

  private get maxConcurrent(): number {
    return (
      this.settingsStore?.settings.maxConcurrentTransfers ??
      MAX_CONCURRENT_TRANSFERS_DEFAULT
    );
  }

  setQueueExpanded(value: boolean) {
    this.queueExpanded = value;
  }

  isRemotePathDownloadBusy(remotePath: string, isDirectory: boolean): boolean {
    const normalized = remotePath.replace(/\/+$/, '') || '/';
    if (this.preparingDownloads.has(normalized)) return true;

    return this.tasks.some((t) => {
      if (t.direction !== 'download') return false;
      if (t.status !== 'queued' && t.status !== 'running') return false;
      if (!isDirectory) {
        return t.remotePath === normalized;
      }
      return (
        t.remotePath === normalized ||
        t.remotePath.startsWith(`${normalized}/`)
      );
    });
  }

  isDownloadSelectionDisabled(): boolean {
    const selected = this.remoteBrowserStore?.selectedEntries ?? [];
    if (selected.length === 0) return true;
    return selected.some((e) =>
      this.isRemotePathDownloadBusy(e.path, e.isDirectory),
    );
  }

  resolveConflict(action: 'skip' | 'replace' | 'replaceAll', remember?: boolean) {
    if (remember && this.remoteBrowserStore?.sessionId) {
      const policy: FileConflictPolicy =
        action === 'skip'
          ? 'replaceIfDifferentSizeOrNewer'
          : 'alwaysReplace';
      void this.sessionStore?.updateSessionPolicy(
        this.remoteBrowserStore.sessionId,
        policy,
      );
      this.sessionOverridePolicy = policy;
    }
    const result: 'skip' | 'replace' =
      action === 'skip' ? 'skip' : 'replace';
    this.pendingConflict = null;
    this.conflictResolve?.(result);
    this.conflictResolve = null;
  }

  cancelConflict() {
    this.pendingConflict = null;
    this.conflictResolve?.('skip');
    this.conflictResolve = null;
  }

  cancelTask(id: string) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;

    if (task.status === 'queued') {
      runInAction(() => {
        task.status = 'cancelled';
      });
      return;
    }

    if (task.status === 'running') {
      this.cancelledIds.add(id);
      void transferIpc.cancelTransfer(id);
    }
  }

  cancelAll() {
    const connectionId = this.remoteBrowserStore?.connectionId;
    for (const task of this.tasks) {
      if (task.status === 'queued') {
        runInAction(() => {
          task.status = 'cancelled';
        });
      } else if (task.status === 'running') {
        this.cancelledIds.add(task.id);
      }
    }
    if (connectionId) {
      void transferIpc.cancelAllTransfers(connectionId);
    }
  }

  async enqueueUpload(
    entries: {
      path: string;
      name: string;
      isDirectory: boolean;
    }[],
    remoteDir: string,
    connectionId: string,
  ) {
    const newTasks: TransferTask[] = [];

    for (const entry of entries) {
      if (entry.isDirectory) {
        const localKey = entry.path;
        runInAction(() => {
          this.preparingUploads.set(localKey, {
            localPath: localKey,
            label: entry.name,
          });
        });
        try {
          const files = await localIpc.localListRecursive(entry.path);
          const remoteBase = joinRemotePath(remoteDir, entry.name);
          for (const file of files) {
            newTasks.push({
              id: crypto.randomUUID(),
              connectionId,
              fileName: file.relativePath,
              direction: 'upload',
              localPath: file.path,
              remotePath: joinRemoteRelative(remoteBase, file.relativePath),
              isDirectory: false,
              status: 'queued',
              bytesDone: 0,
              bytesTotal: file.size,
            });
          }
        } catch (e) {
          newTasks.push({
            id: crypto.randomUUID(),
            connectionId,
            fileName: entry.name,
            direction: 'upload',
            localPath: entry.path,
            remotePath: joinRemotePath(remoteDir, entry.name),
            isDirectory: true,
            status: 'error',
            bytesDone: 0,
            bytesTotal: 0,
            error: e instanceof Error ? e.message : String(e),
          });
        } finally {
          runInAction(() => {
            this.preparingUploads.delete(localKey);
          });
        }
      } else {
        newTasks.push({
          id: crypto.randomUUID(),
          connectionId,
          fileName: entry.name,
          direction: 'upload',
          localPath: entry.path,
          remotePath: joinRemotePath(remoteDir, entry.name),
          isDirectory: false,
          status: 'queued',
          bytesDone: 0,
          bytesTotal: 0,
        });
      }
    }

    runInAction(() => {
      this.tasks.push(...newTasks);
    });
    void this.processQueue();
  }

  /**
   * Files dropped onto the remote pane from outside the app. Unlike
   * enqueueUpload these have no real local path yet, so each one is spooled
   * to a temp file via local_stage_upload before joining the normal queue;
   * cleanupLocalAfter marks the task to remove that temp copy once it settles.
   */
  async enqueueOsUpload(
    files: File[],
    remoteDir: string,
    connectionId: string,
  ) {
    for (const file of files) {
      const prepareKey = `${file.name}:${file.size}:${crypto.randomUUID()}`;
      runInAction(() => {
        this.preparingUploads.set(prepareKey, {
          localPath: file.name,
          label: file.name,
        });
      });

      try {
        if (file.size > MAX_OS_DROP_UPLOAD_BYTES) {
          throw new Error(
            `File too large for drag-and-drop upload (max ${Math.floor(MAX_OS_DROP_UPLOAD_BYTES / (1024 * 1024))} MB)`,
          );
        }

        const buffer = new Uint8Array(await file.arrayBuffer());
        const base64 = bytesToBase64(buffer);
        const stagedPath = await localIpc.localStageUpload(file.name, base64);

        runInAction(() => {
          this.tasks.push({
            id: crypto.randomUUID(),
            connectionId,
            fileName: file.name,
            direction: 'upload',
            localPath: stagedPath,
            remotePath: joinRemotePath(remoteDir, file.name),
            isDirectory: false,
            status: 'queued',
            bytesDone: 0,
            bytesTotal: file.size,
            cleanupLocalAfter: true,
          });
        });
      } catch (e) {
        runInAction(() => {
          this.tasks.push({
            id: crypto.randomUUID(),
            connectionId,
            fileName: file.name,
            direction: 'upload',
            localPath: file.name,
            remotePath: joinRemotePath(remoteDir, file.name),
            isDirectory: false,
            status: 'error',
            bytesDone: 0,
            bytesTotal: file.size,
            error: e instanceof Error ? e.message : String(e),
          });
        });
      } finally {
        runInAction(() => {
          this.preparingUploads.delete(prepareKey);
        });
      }
    }

    void this.processQueue();
  }

  async enqueueDownload(
    entries: {
      path: string;
      name: string;
      isDirectory: boolean;
      size: number;
      modifiedAt?: string;
    }[],
    localDir: string,
    connectionId: string,
    session?: SessionConfig | null,
  ) {
    const newTasks: TransferTask[] = [];

    for (const entry of entries) {
      if (entry.isDirectory) {
        const remoteKey = entry.path.replace(/\/+$/, '') || '/';
        runInAction(() => {
          this.preparingDownloads.set(remoteKey, {
            remotePath: remoteKey,
            label: entry.name,
          });
        });
        try {
          const files = await sftpIpc.sftpListRecursive(connectionId, entry.path);
          const dirBase = joinLocalPath(localDir, entry.name);
          for (const file of files) {
            newTasks.push({
              id: crypto.randomUUID(),
              connectionId,
              fileName: file.relativePath,
              direction: 'download',
              localPath: joinLocalRelative(dirBase, file.relativePath),
              remotePath: file.path,
              isDirectory: false,
              status: 'queued',
              bytesDone: 0,
              bytesTotal: file.size,
            });
          }
        } catch (e) {
          newTasks.push({
            id: crypto.randomUUID(),
            connectionId,
            fileName: entry.name,
            direction: 'download',
            localPath: joinLocalPath(localDir, entry.name),
            remotePath: entry.path,
            isDirectory: true,
            status: 'error',
            bytesDone: 0,
            bytesTotal: entry.size,
            error: e instanceof Error ? e.message : String(e),
          });
        } finally {
          runInAction(() => {
            this.preparingDownloads.delete(remoteKey);
          });
        }
      } else {
        newTasks.push({
          id: crypto.randomUUID(),
          connectionId,
          fileName: entry.name,
          direction: 'download',
          localPath: joinLocalPath(localDir, entry.name),
          remotePath: entry.path,
          isDirectory: false,
          status: 'queued',
          bytesDone: 0,
          bytesTotal: entry.size,
        });
      }
    }

    runInAction(() => {
      this.tasks.push(...newTasks);
    });
    void this.processQueue(session ?? null);
  }

  uploadSelected() {
    const remote = this.remoteBrowserStore;
    const local = this.localBrowserStore;
    if (!remote?.connectionId || !local) return;
    const selected = local.selectedEntries;
    if (selected.length === 0) return;
    void this.enqueueUpload(
      selected.map((e) => ({
        path: e.path,
        name: e.name,
        isDirectory: e.isDirectory,
      })),
      remote.cwd,
      remote.connectionId,
    );
  }

  downloadSelected() {
    const remote = this.remoteBrowserStore;
    const local = this.localBrowserStore;
    if (!remote?.connectionId || !local?.cwd) return;
    const selected = remote.selectedEntries;
    if (selected.length === 0) return;
    void this.enqueueDownload(
      selected.map((e) => ({
        path: e.path,
        name: e.name,
        isDirectory: e.isDirectory,
        size: e.size,
        modifiedAt: e.modifiedAt,
      })),
      local.cwd,
      remote.connectionId,
      remote.session,
    );
  }

  clearCompleted() {
    this.tasks = this.tasks.filter(
      (t) =>
        t.status !== 'done' &&
        t.status !== 'skipped' &&
        t.status !== 'cancelled',
    );
  }

  private handleProgress(payload: TransferProgressPayload) {
    if (this.cancelledIds.has(payload.transferId)) {
      const task = this.tasks.find((t) => t.id === payload.transferId);
      if (task && payload.status !== 'cancelled') {
        return;
      }
    }

    const task = this.tasks.find((t) => t.id === payload.transferId);
    if (!task) return;

    runInAction(() => {
      task.bytesDone = payload.bytesDone;
      task.bytesTotal = payload.bytesTotal;
      if (payload.status === 'running') task.status = 'running';
      if (payload.status === 'done') task.status = 'done';
      if (payload.status === 'error') {
        task.status = this.cancelledIds.has(payload.transferId)
          ? 'cancelled'
          : 'error';
      }
      if (payload.status === 'cancelled') task.status = 'cancelled';
      if (task.status === 'cancelled') {
        this.cancelledIds.delete(payload.transferId);
      }
    });
  }

  private async processQueue(session: SessionConfig | null = null) {
    if (session) this.conflictSession = session;

    if (this.processing) {
      this.queueDrainPending = true;
      return;
    }

    this.processing = true;

    try {
      await this.runWorkers();
    } finally {
      runInAction(() => {
        this.processing = false;
        this.conflictSession = null;
      });
      this.remoteBrowserStore?.refresh();
      this.localBrowserStore?.refresh();

      const needsDrain =
        this.queueDrainPending ||
        this.tasks.some((t) => t.status === 'queued');

      if (needsDrain) {
        runInAction(() => {
          this.queueDrainPending = false;
        });
        void this.processQueue();
      }
    }
  }

  private async runWorkers(): Promise<void> {
    const pump = async (): Promise<void> => {
      const started: Promise<void>[] = [];

      while (this.activeWorkers < this.maxConcurrent) {
        const task = this.tasks.find((t) => t.status === 'queued');
        if (!task) break;

        runInAction(() => {
          this.activeWorkers++;
        });

        const worker = this.runTask(task).finally(() => {
          runInAction(() => {
            this.activeWorkers--;
          });
        });
        started.push(worker);
      }

      if (started.length === 0) return;

      await Promise.all(started);

      if (this.tasks.some((t) => t.status === 'queued')) {
        await pump();
      }
    };

    await pump();
  }

  private getEffectivePolicy(session: SessionConfig | null): FileConflictPolicy {
    if (this.sessionOverridePolicy) return this.sessionOverridePolicy;
    if (session?.fileConflictPolicy) return session.fileConflictPolicy;
    return this.settingsStore?.settings.defaultFileConflictPolicy ?? 'ask';
  }

  private async checkConflictSerial(
    task: TransferTask,
    session: SessionConfig | null,
  ): Promise<'skip' | 'replace'> {
    let release!: () => void;
    const prev = this.conflictMutex;
    this.conflictMutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await this.checkConflict(task, session);
    } finally {
      release();
    }
  }

  private async checkConflict(
    task: TransferTask,
    session: SessionConfig | null,
  ): Promise<'skip' | 'replace'> {
    const localStat = await localIpc.localStat(task.localPath);
    if (!localStat.exists || localStat.isDirectory) return 'replace';

    const policy = this.getEffectivePolicy(session);
    if (policy === 'alwaysReplace') return 'replace';
    if (policy === 'replaceIfDifferentSize') {
      return localStat.size !== task.bytesTotal ? 'replace' : 'skip';
    }
    if (policy === 'replaceIfDifferentSizeOrNewer') {
      if (localStat.size !== task.bytesTotal) return 'replace';
      if (task.bytesTotal === 0) return 'skip';
      const localTime = localStat.modifiedAt
        ? new Date(localStat.modifiedAt).getTime()
        : 0;
      const remoteTime = 0;
      return remoteTime > localTime ? 'replace' : 'skip';
    }

    return new Promise<'skip' | 'replace'>((resolve) => {
      runInAction(() => {
        this.pendingConflict = {
          fileName: task.fileName,
          localPath: task.localPath,
          remotePath: task.remotePath,
          localSize: localStat.size,
          remoteSize: task.bytesTotal,
          localModifiedAt: localStat.modifiedAt,
        };
      });
      this.conflictResolve = resolve;
    });
  }

  private async runTask(task: TransferTask) {
    try {
      await this.runTaskBody(task);
    } finally {
      if (task.cleanupLocalAfter) {
        localIpc.localDelete(task.localPath, false).catch(() => {});
      }
    }
  }

  private async runTaskBody(task: TransferTask) {
    if (this.cancelledIds.has(task.id)) {
      runInAction(() => {
        task.status = 'cancelled';
        this.cancelledIds.delete(task.id);
      });
      return;
    }

    if (task.direction === 'download' && !task.isDirectory) {
      const action = await this.checkConflictSerial(
        task,
        this.conflictSession,
      );
      if (action === 'skip') {
        runInAction(() => {
          task.status = 'skipped';
        });
        return;
      }
    }

    if (this.cancelledIds.has(task.id)) {
      runInAction(() => {
        task.status = 'cancelled';
        this.cancelledIds.delete(task.id);
      });
      return;
    }

    runInAction(() => {
      task.status = 'running';
    });

    try {
      if (task.direction === 'upload') {
        await sftpIpc.sftpUpload(
          task.connectionId,
          task.localPath,
          task.remotePath,
          task.id,
        );
      } else {
        await sftpIpc.sftpDownload(
          task.connectionId,
          task.remotePath,
          task.localPath,
          task.isDirectory,
          task.id,
        );
      }
      runInAction(() => {
        if (this.cancelledIds.has(task.id)) {
          task.status = 'cancelled';
          this.cancelledIds.delete(task.id);
        } else if (task.status === 'running') {
          task.status = 'done';
        }
      });
    } catch (e) {
      const isCancelled =
        this.cancelledIds.has(task.id) ||
        getIpcErrorPayload(e).code === 'transfer.cancelled';
      runInAction(() => {
        if (isCancelled) {
          task.status = 'cancelled';
          this.cancelledIds.delete(task.id);
        } else {
          task.status = 'error';
          task.error = e instanceof Error ? e.message : String(e);
        }
      });
    }
  }
}
