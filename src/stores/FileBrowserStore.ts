import { makeAutoObservable, runInAction } from 'mobx';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { ConnectionStatus, SftpEntry } from '@/types';
import type { AppError } from '@i18n/types';
import { i18n } from '@i18n/index';
import { getIpcErrorPayload } from '@ipc/client';
import * as sftpIpc from '@ipc/sftp';
import { copyPathWithNotify } from '@utils/copyPathNotify';
import { openInEditor } from '@utils/openInEditor';
import type { TerminalStore } from './TerminalStore';
import type { SessionStore } from './SessionStore';
import type { FileConnectionStore } from './FileConnectionStore';
import type { SettingsStore } from './SettingsStore';
import type { WorkspaceStore } from './WorkspaceStore';

function joinRemotePath(parent: string, name: string): string {
  const base = parent === '/' ? '' : parent.replace(/\/$/, '');
  const combined = `${base}/${name}`.replace(/\/+/g, '/');
  return combined.startsWith('/') ? combined : `/${combined}`;
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function joinLocalPath(dir: string, name: string): string {
  const separator = dir.includes('\\') ? '\\' : '/';
  const trimmed = dir.replace(/[/\\]+$/, '');
  return `${trimmed}${separator}${name}`;
}

function mapFileError(e: unknown, fallbackCode: string): AppError {
  const payload = getIpcErrorPayload(e);
  return payload.code === 'unknown' ? { code: fallbackCode } : payload;
}

export class FileBrowserStore {
  connectionId: string | null = null;
  sessionId: string | null = null;
  protocol: 'ssh' | 'sftp' | 'ftp' | null = null;
  cwd = '/';
  entries: SftpEntry[] = [];
  isLoading = false;
  error: AppError | null = null;
  selectedEntry: SftpEntry | null = null;
  renameTargetPath: string | null = null;
  renameDraft = '';
  private connectionStatus: ConnectionStatus | null = null;
  private settingsStore: SettingsStore | null = null;
  private workspaceStore: WorkspaceStore | null = null;
  /** Remote browse delegated to FileTransferWorkspace (double panel). */
  private remoteBrowseSuspended = false;

  constructor() {
    makeAutoObservable(this);
  }

  setSettingsStore(settingsStore: SettingsStore) {
    this.settingsStore = settingsStore;
  }

  setWorkspaceStore(workspaceStore: WorkspaceStore) {
    this.workspaceStore = workspaceStore;
  }

  get breadcrumbs(): { label: string; path: string }[] {
    if (this.cwd === '/') {
      return [{ label: '/', path: '/' }];
    }

    const parts = this.cwd.split('/').filter(Boolean);
    const crumbs: { label: string; path: string }[] = [{ label: '/', path: '/' }];
    let acc = '';

    for (const part of parts) {
      acc += `/${part}`;
      crumbs.push({ label: part, path: acc });
    }

    return crumbs;
  }

  get canBrowse(): boolean {
    return (
      !this.remoteBrowseSuspended &&
      this.connectionId !== null &&
      this.connectionId.length > 0 &&
      this.connectionStatus === 'connected'
    );
  }

  bind(
    terminalStore: TerminalStore,
    sessionStore: SessionStore,
    fileConnectionStore: FileConnectionStore,
  ) {
    const fileTransferMode =
      this.workspaceStore?.isFileMode(
        terminalStore,
        fileConnectionStore,
        sessionStore,
      ) ?? false;

    if (fileTransferMode) {
      this.bindFileTransferPlaceholder(
        terminalStore,
        sessionStore,
        fileConnectionStore,
      );
      return;
    }

    this.remoteBrowseSuspended = false;

    const ftpConn = fileConnectionStore.activeConnection;
    if (
      this.workspaceStore?.active?.kind === 'ftp' &&
      fileConnectionStore.activeSessionId &&
      ftpConn &&
      (ftpConn.status === 'connected' || ftpConn.status === 'connecting')
    ) {
      this.bindFtp(fileConnectionStore.activeSessionId, ftpConn, sessionStore);
      return;
    }

    const activeTab = terminalStore.activeTab;
    if (!activeTab || activeTab.kind === 'local') {
      this.reset();
      return;
    }

    const session = sessionStore.sessions.find((s) => s.id === activeTab.sessionId);

    runInAction(() => {
      this.connectionStatus = activeTab.status;
      this.protocol = session?.protocol === 'ftp' ? 'ftp' : session?.protocol ?? 'ssh';
    });

    if (activeTab.status !== 'connected' || !activeTab.connectionId) {
      runInAction(() => {
        this.connectionId = activeTab.connectionId ?? null;
        this.sessionId = activeTab.sessionId ?? null;
        this.entries = [];
        this.selectedEntry = null;
        if (activeTab.status !== 'connecting') {
          this.error = null;
        }
      });
      return;
    }

    const rawDefault = session?.defaultPath?.trim();
    const defaultPath =
      rawDefault && rawDefault.length > 0
        ? rawDefault.startsWith('/')
          ? rawDefault
          : `/${rawDefault}`
        : '/';

    const connectionChanged =
      this.connectionId !== activeTab.connectionId ||
      this.sessionId !== activeTab.sessionId;

    runInAction(() => {
      this.connectionId = activeTab.connectionId!;
      this.sessionId = activeTab.sessionId ?? null;
      this.connectionStatus = activeTab.status;
      this.protocol = session?.protocol === 'sftp' ? 'sftp' : 'ssh';
      if (connectionChanged) {
        this.cwd = defaultPath;
        this.selectedEntry = null;
        this.error = null;
        this.entries = [];
      }
    });

    void this.loadDir();
  }

  private bindFileTransferPlaceholder(
    terminalStore: TerminalStore,
    sessionStore: SessionStore,
    fileConnectionStore: FileConnectionStore,
  ) {
    this.remoteBrowseSuspended = true;

    if (this.workspaceStore?.active?.kind === 'ftp') {
      const tab = fileConnectionStore.activeTab;
      const session = tab
        ? sessionStore.sessions.find((s) => s.id === tab.sessionId)
        : null;
      const rawDefault = session?.defaultPath?.trim();
      const defaultPath =
        rawDefault && rawDefault.length > 0
          ? rawDefault.startsWith('/')
            ? rawDefault
            : `/${rawDefault}`
          : '/';

      runInAction(() => {
        this.sessionId = tab?.sessionId ?? null;
        this.protocol = 'ftp';
        this.connectionStatus = tab?.status ?? null;
        this.connectionId = tab?.connectionId ?? null;
        this.cwd = defaultPath;
        this.entries = [];
        this.selectedEntry = null;
        this.error = tab?.error ?? null;
        this.isLoading = false;
      });
      return;
    }

    const activeTab = terminalStore.activeTab;
    if (!activeTab) {
      this.reset();
      return;
    }

    const session = sessionStore.sessions.find((s) => s.id === activeTab.sessionId);
    const rawDefault = session?.defaultPath?.trim();
    const defaultPath =
      rawDefault && rawDefault.length > 0
        ? rawDefault.startsWith('/')
          ? rawDefault
          : `/${rawDefault}`
        : '/';

    runInAction(() => {
      this.connectionId = activeTab.connectionId ?? null;
      this.sessionId = activeTab.sessionId ?? null;
      this.connectionStatus = activeTab.status;
      this.protocol = session?.protocol === 'sftp' ? 'sftp' : 'ssh';
      this.cwd = defaultPath;
      this.entries = [];
      this.selectedEntry = null;
      this.error = activeTab.error ?? null;
      this.isLoading = false;
    });
  }

  private bindFtp(
    sessionId: string,
    ftpConn: NonNullable<FileConnectionStore['activeConnection']>,
    sessionStore: SessionStore,
  ) {
    const session = sessionStore.sessions.find((s) => s.id === sessionId);
    const rawDefault = session?.defaultPath?.trim();
    const defaultPath =
      rawDefault && rawDefault.length > 0
        ? rawDefault.startsWith('/')
          ? rawDefault
          : `/${rawDefault}`
        : '/';

    const connectionChanged =
      this.connectionId !== ftpConn.connectionId ||
      this.sessionId !== sessionId;

    runInAction(() => {
      this.sessionId = sessionId;
      this.protocol = 'ftp';
      this.connectionStatus = ftpConn.status;
      this.connectionId = ftpConn.connectionId || null;
      if (connectionChanged) {
        this.cwd = defaultPath;
        this.selectedEntry = null;
        this.error = ftpConn.error ?? null;
        this.entries = [];
      }
    });

    if (ftpConn.status === 'connected' && ftpConn.connectionId) {
      void this.loadDir();
    }
  }

  async loadDir(path?: string) {
    if (this.remoteBrowseSuspended) return;
    if (!this.connectionId) return;

    const target = path ?? this.cwd;
    this.cancelRename();

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const { entries, resolvedPath } = await sftpIpc.sftpListDir(
        this.connectionId,
        target,
      );
      runInAction(() => {
        this.cwd = resolvedPath;
        this.entries = entries;
        this.isLoading = false;
      });
    } catch (e) {
      runInAction(() => {
        const payload = getIpcErrorPayload(e);
        this.error =
          payload.code === 'unknown' ? { code: 'files.listFailed' } : payload;
        this.isLoading = false;
      });
    }
  }

  navigateTo(path: string) {
    void this.loadDir(path);
  }

  navigateUp() {
    if (this.cwd === '/') return;

    const parts = this.cwd.split('/').filter(Boolean);
    parts.pop();
    const parent = parts.length === 0 ? '/' : `/${parts.join('/')}`;
    void this.loadDir(parent);
  }

  refresh() {
    if (!this.canBrowse) return;
    void this.loadDir(this.cwd);
  }

  selectEntry(entry: SftpEntry | null) {
    this.selectedEntry = entry;
  }

  startRename(entry: SftpEntry) {
    this.renameTargetPath = entry.path;
    this.renameDraft = entry.name;
  }

  cancelRename() {
    this.renameTargetPath = null;
    this.renameDraft = '';
  }

  async commitRename() {
    if (!this.connectionId) return;

    const targetPath = this.renameTargetPath;
    if (!targetPath) return;

    const nextName = this.renameDraft.trim();
    if (!nextName) {
      this.cancelRename();
      return;
    }

    const parent =
      targetPath.split('/').slice(0, -1).join('/') || '/';
    const newPath = joinRemotePath(parent, nextName);

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      await sftpIpc.sftpRename(this.connectionId, targetPath, newPath);
      await this.loadDir(this.cwd);
    } catch (e) {
      runInAction(() => {
        this.error = mapFileError(e, 'files.renameFailed');
        this.isLoading = false;
      });
    } finally {
      this.cancelRename();
    }
  }

  async copyPath(path: string) {
    await copyPathWithNotify(path);
  }

  async openEntry(entry: SftpEntry) {
    if (entry.isDirectory) {
      this.navigateTo(entry.path);
      return;
    }

    if (!this.connectionId) return;
    if (!this.settingsStore) {
      this.error = { code: 'files.settingsNotInit' };
      return;
    }

    runInAction(() => {
      this.error = null;
    });

    try {
      const { localPath } = await sftpIpc.sftpFetchToCache(
        this.connectionId,
        entry.path,
      );
      await openInEditor(localPath, this.settingsStore.settings.defaultEditorPath);
    } catch (e) {
      runInAction(() => {
        this.error = mapFileError(e, 'files.openFailed');
      });
    }
  }

  async deleteEntry(entry: SftpEntry) {
    if (!this.connectionId) return;

    // Перед удалением сбрасываем inline rename, чтобы не оставлять инпут "висеть"
    // при изменении списка.
    this.cancelRename();

    if (entry.isDirectory) {
      runInAction(() => {
        this.isLoading = true;
        this.error = null;
      });

      try {
        const { count } = await sftpIpc.sftpCountFiles(
          this.connectionId,
          entry.path,
        );

        const ok = window.confirm(
          i18n.t('files.confirm.deleteDir', {
            name: entry.name,
            path: entry.path,
            count,
          }),
        );
        if (!ok) {
          runInAction(() => {
            this.isLoading = false;
          });
          return;
        }

        await sftpIpc.sftpDelete(this.connectionId, entry.path, true);
        await this.loadDir(this.cwd);
      } catch (e) {
        runInAction(() => {
          this.error = mapFileError(e, 'files.deleteFailed');
          this.isLoading = false;
        });
      }

      return;
    }

    if (!window.confirm(i18n.t('files.confirm.deleteFile', { name: entry.name }))) {
      return;
    }

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      await sftpIpc.sftpDelete(this.connectionId, entry.path, false);
      await this.loadDir(this.cwd);
    } catch (e) {
      runInAction(() => {
        this.error = mapFileError(e, 'files.deleteFailed');
        this.isLoading = false;
      });
    }
  }

  async renameEntry(entry: SftpEntry, newName?: string) {
    if (!this.connectionId) return;

    const nextName = (newName ?? '').trim();
    if (!nextName) return;

    const parent =
      entry.path.split('/').slice(0, -1).join('/') || '/';
    const newPath = joinRemotePath(parent, nextName);

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      await sftpIpc.sftpRename(this.connectionId, entry.path, newPath);
      await this.loadDir(this.cwd);
    } catch (e) {
      runInAction(() => {
        this.error = mapFileError(e, 'files.renameFailed');
        this.isLoading = false;
      });
    }
  }

  async upload() {
    if (!this.connectionId) return;

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const selected = await open({ multiple: false });
      if (!selected || Array.isArray(selected)) return;

      const remotePath = joinRemotePath(this.cwd, basename(selected));
      await sftpIpc.sftpUpload(this.connectionId, selected, remotePath);
      await this.loadDir(this.cwd);
    } catch (e) {
      runInAction(() => {
        this.error = mapFileError(e, 'files.uploadFailed');
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  async download(entry: SftpEntry) {
    if (!this.connectionId) return;

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      if (entry.isDirectory) {
        const localDir = await open({ directory: true });
        if (!localDir || Array.isArray(localDir)) {
          runInAction(() => {
            this.isLoading = false;
          });
          return;
        }

        const destPath = joinLocalPath(localDir, entry.name);
        await sftpIpc.sftpDownload(
          this.connectionId,
          entry.path,
          destPath,
          true,
        );
      } else {
        const localPath = await save({ defaultPath: entry.name });
        if (!localPath) {
          runInAction(() => {
            this.isLoading = false;
          });
          return;
        }

        await sftpIpc.sftpDownload(
          this.connectionId,
          entry.path,
          localPath,
          false,
        );
      }

      runInAction(() => {
        this.isLoading = false;
      });
    } catch (e) {
      runInAction(() => {
        this.error = mapFileError(e, 'files.downloadFailed');
        this.isLoading = false;
      });
    }
  }

  async mkdir(name: string) {
    if (!this.connectionId || !name.trim()) return;

    const remotePath = joinRemotePath(this.cwd, name.trim());

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      await sftpIpc.sftpMkdir(this.connectionId, remotePath);
      await this.loadDir(this.cwd);
    } catch (e) {
      runInAction(() => {
        this.error = mapFileError(e, 'files.mkdirFailed');
        this.isLoading = false;
      });
    }
  }

  reset() {
    this.remoteBrowseSuspended = false;
    this.connectionId = null;
    this.sessionId = null;
    this.protocol = null;
    this.connectionStatus = null;
    this.cwd = '/';
    this.entries = [];
    this.isLoading = false;
    this.error = null;
    this.selectedEntry = null;
    this.cancelRename();
  }
}
