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
import { listenTransferProgress } from '@ipc/events';
import { basename, joinLocalPath, joinRemotePath } from '@utils/filePaths';
import type { LocalBrowserStore } from './LocalBrowserStore';
import type { RemoteBrowserStore } from './RemoteBrowserStore';
import type { SessionStore } from './SessionStore';
import type { SettingsStore } from './SettingsStore';

function joinLocalRelative(base: string, relativePath: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  const parts = relativePath.split('/').filter(Boolean);
  let result = base.replace(/[/\\]+$/, '');
  for (const part of parts) {
    result = `${result}${sep}${part}`;
  }
  return result;
}

export class TransferStore {
  tasks: TransferTask[] = [];
  queueExpanded = true;
  processing = false;
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

  get activeCount(): number {
    return this.tasks.filter(
      (t) => t.status === 'running' || t.status === 'queued',
    ).length;
  }

  get runningCount(): number {
    return this.tasks.filter((t) => t.status === 'running').length;
  }

  get hasActiveTransfers(): boolean {
    return this.activeCount > 0;
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

  enqueueUpload(
    localPaths: string[],
    remoteDir: string,
    connectionId: string,
  ) {
    for (const localPath of localPaths) {
      const name = basename(localPath);
      const task: TransferTask = {
        id: crypto.randomUUID(),
        connectionId,
        fileName: name,
        direction: 'upload',
        localPath,
        remotePath: joinRemotePath(remoteDir, name),
        isDirectory: false,
        status: 'queued',
        bytesDone: 0,
        bytesTotal: 0,
      };
      this.tasks.push(task);
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
    this.enqueueUpload(
      selected.map((e) => e.path),
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
    const task = this.tasks.find((t) => t.id === payload.transferId);
    if (!task) return;
    runInAction(() => {
      task.bytesDone = payload.bytesDone;
      task.bytesTotal = payload.bytesTotal;
      if (payload.status === 'running') task.status = 'running';
      if (payload.status === 'done') task.status = 'done';
      if (payload.status === 'error') task.status = 'error';
    });
  }

  private async processQueue(session: SessionConfig | null = null) {
    if (this.processing) {
      if (session) this.conflictSession = session;
      return;
    }
    this.processing = true;
    if (session) this.conflictSession = session;

    try {
      await this.resolveDownloadConflicts();
      await this.runWorkers();
    } finally {
      runInAction(() => {
        this.processing = false;
        this.conflictSession = null;
      });
      this.remoteBrowserStore?.refresh();
      this.localBrowserStore?.refresh();

      if (this.tasks.some((t) => t.status === 'queued')) {
        void this.processQueue();
      }
    }
  }

  private async resolveDownloadConflicts() {
    const session = this.conflictSession;
    let task = this.tasks.find(
      (t) =>
        t.status === 'queued' &&
        t.direction === 'download' &&
        !t.isDirectory,
    );

    while (task) {
      const action = await this.checkConflict(task, session);
      if (action === 'skip') {
        runInAction(() => {
          task!.status = 'skipped';
        });
      }
      task = this.tasks.find(
        (t) =>
          t.status === 'queued' &&
          t.direction === 'download' &&
          !t.isDirectory,
      );
    }
  }

  private async runWorkers(): Promise<void> {
    const pump = async (): Promise<void> => {
      const started: Promise<void>[] = [];

      while (this.activeWorkers < this.maxConcurrent) {
        const task = this.tasks.find((t) => t.status === 'queued');
        if (!task) break;

        this.activeWorkers++;
        const worker = this.runTask(task).finally(() => {
          this.activeWorkers--;
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
        if (task.status === 'running') task.status = 'done';
      });
    } catch (e) {
      runInAction(() => {
        task.status = 'error';
        task.error = e instanceof Error ? e.message : String(e);
      });
    }
  }
}
