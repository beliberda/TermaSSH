import { makeAutoObservable, runInAction } from "mobx";
import type { ConnectionStatus, SessionConfig, SftpEntry } from "@/types";
import { getSessionLocalPath, getSessionRemotePath } from "@/types/session";
import type { AppError } from "@i18n/types";
import { i18n } from "@i18n/index";
import { getIpcErrorPayload } from "@ipc/client";
import * as sftpIpc from "@ipc/sftp";
import * as localIpc from "@ipc/local";
import { joinRemotePath, parentRemotePath, remotePathsEquivalent } from "@utils/filePaths";
import { copyPathWithNotify } from "@utils/copyPathNotify";
import { openInEditor } from "@utils/openInEditor";
import {
  isSyncBrowseEnabled,
  isSyncBrowseGuarded,
  mapRemoteToLocal,
  pathsEqual,
  runSyncBrowseAction,
} from "@utils/syncBrowse";
import type { LocalBrowserStore } from "./LocalBrowserStore";
import type { SettingsStore } from "./SettingsStore";

function mapFileError(e: unknown, fallbackCode: string): AppError {
  const payload = getIpcErrorPayload(e);
  return payload.code === "unknown" ? { code: fallbackCode } : payload;
}

export type RemoteBindSource = {
  connectionId: string | null;
  sessionId: string | null;
  session: SessionConfig | null;
  status: ConnectionStatus | null;
  protocol: "sftp" | "ftp" | null;
};

export class RemoteBrowserStore {
  connectionId: string | null = null;
  sessionId: string | null = null;
  session: SessionConfig | null = null;
  protocol: "sftp" | "ftp" | null = null;
  connectionStatus: ConnectionStatus | null = null;
  cwd = "/";
  entries: SftpEntry[] = [];
  isLoading = false;
  error: AppError | null = null;
  selectedPaths = new Set<string>();
  lastSelectedPath: string | null = null;
  renameTargetPath: string | null = null;
  renameDraft = "";
  focused = false;
  private settingsStore: SettingsStore | null = null;
  private localBrowserStore: LocalBrowserStore | null = null;
  private loadDirGeneration = 0;
  private localPaneInitialized = false;

  constructor() {
    makeAutoObservable(this);
  }

  setSettingsStore(settingsStore: SettingsStore) {
    this.settingsStore = settingsStore;
  }

  setLocalBrowserStore(localBrowserStore: LocalBrowserStore) {
    this.localBrowserStore = localBrowserStore;
  }

  get breadcrumbs(): { label: string; path: string }[] {
    if (this.cwd === "/") {
      return [{ label: "/", path: "/" }];
    }
    const parts = this.cwd.split("/").filter(Boolean);
    const crumbs: { label: string; path: string }[] = [
      { label: "/", path: "/" },
    ];
    let acc = "";
    for (const part of parts) {
      acc += `/${part}`;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }

  get canBrowse(): boolean {
    return (
      this.connectionId !== null &&
      this.connectionId.length > 0 &&
      this.connectionStatus === "connected"
    );
  }

  get selectedEntries(): SftpEntry[] {
    return this.entries.filter((e) => this.selectedPaths.has(e.path));
  }

  bind(source: RemoteBindSource) {
    const sessionChanged = this.sessionId !== source.sessionId;

    runInAction(() => {
      this.connectionId = source.connectionId;
      this.sessionId = source.sessionId;
      this.session = source.session;
      this.protocol = source.protocol;
      this.connectionStatus = source.status;
      if (sessionChanged) {
        this.cwd = source.session ? getSessionRemotePath(source.session) : "/";
        this.entries = [];
        this.selectedPaths.clear();
        this.lastSelectedPath = null;
        this.error = null;
        this.localPaneInitialized = false;
      }
    });

    if (this.canBrowse) {
      void this.loadDir();
    } else {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  reset() {
    this.connectionId = null;
    this.sessionId = null;
    this.session = null;
    this.protocol = null;
    this.connectionStatus = null;
    this.cwd = "/";
    this.entries = [];
    this.isLoading = false;
    this.error = null;
    this.selectedPaths.clear();
    this.lastSelectedPath = null;
    this.localPaneInitialized = false;
    this.cancelRename();
  }

  async loadDir(
    path?: string,
    opts?: { sync?: boolean; soft?: boolean },
  ) {
    if (!this.connectionId || this.connectionStatus !== "connected") return;

    const generation = ++this.loadDirGeneration;
    const connectionId = this.connectionId;
    const target = path ?? this.cwd;
    const shouldSync = opts?.sync !== false && !isSyncBrowseGuarded();
    this.cancelRename();

    runInAction(() => {
      this.isLoading = true;
      if (!opts?.soft) {
        this.error = null;
      }
    });

    try {
      const { entries, resolvedPath } = await sftpIpc.sftpListDir(
        connectionId,
        target,
      );
      if (
        generation !== this.loadDirGeneration ||
        connectionId !== this.connectionId
      ) {
        return;
      }
      if (opts?.soft && !remotePathsEquivalent(target, resolvedPath)) {
        runInAction(() => {
          this.isLoading = false;
        });
        return;
      }
      runInAction(() => {
        this.cwd = resolvedPath;
        this.entries = entries;
        this.isLoading = false;
        this.error = null;
        this.selectedPaths.clear();
        this.lastSelectedPath = null;
      });
      await this.ensureLocalPaneLoaded();
      if (shouldSync) {
        this.syncLocalBrowse(resolvedPath);
      }
    } catch (e) {
      if (
        generation !== this.loadDirGeneration ||
        connectionId !== this.connectionId
      ) {
        return;
      }
      if (opts?.soft) {
        runInAction(() => {
          this.isLoading = false;
        });
        return;
      }
      runInAction(() => {
        this.error = mapFileError(e, "files.listFailed");
        this.isLoading = false;
      });
    }
  }

  private async ensureLocalPaneLoaded(): Promise<void> {
    if (this.localPaneInitialized || !this.localBrowserStore) return;
    if (this.session && isSyncBrowseEnabled(this.session)) return;

    this.localPaneInitialized = true;
    const localStart = this.session
      ? getSessionLocalPath(this.session)
      : undefined;
    await this.localBrowserStore.init(localStart);
  }

  syncLocalBrowse(remotePath: string) {
    void runSyncBrowseAction(() => this.doSyncLocalBrowse(remotePath));
  }

  private async doSyncLocalBrowse(remotePath: string): Promise<void> {
    if (!this.session || !isSyncBrowseEnabled(this.session)) return;
    if (!this.localBrowserStore) return;

    const mapped = mapRemoteToLocal(remotePath, this.session);
    if (!mapped) return;
    if (pathsEqual(this.localBrowserStore.cwd, mapped)) return;

    const exists = await localIpc.localExists(mapped);
    if (exists) {
      await this.localBrowserStore.loadDir(mapped, { skipRemoteSync: true });
    }
  }

  navigateTo(path: string) {
    void this.loadDir(path);
  }

  navigateUp() {
    void this.loadDir(parentRemotePath(this.cwd));
  }

  refresh() {
    if (!this.canBrowse) return;
    void this.loadDir(this.cwd);
  }

  selectEntry(
    entry: SftpEntry,
    opts?: { additive?: boolean; range?: boolean; sortedPaths?: string[] },
  ) {
    if (opts?.range && this.lastSelectedPath) {
      const paths = opts.sortedPaths ?? this.entries.map((e) => e.path);
      const start = paths.indexOf(this.lastSelectedPath);
      const end = paths.indexOf(entry.path);
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start];
        for (let i = from; i <= to; i++) {
          this.selectedPaths.add(paths[i]);
        }
        this.lastSelectedPath = entry.path;
        return;
      }
    }

    if (opts?.additive) {
      if (this.selectedPaths.has(entry.path)) {
        this.selectedPaths.delete(entry.path);
      } else {
        this.selectedPaths.add(entry.path);
      }
      this.lastSelectedPath = entry.path;
      return;
    }

    this.selectedPaths.clear();
    this.selectedPaths.add(entry.path);
    this.lastSelectedPath = entry.path;
  }

  selectAll() {
    this.entries.forEach((e) => this.selectedPaths.add(e.path));
  }

  clearSelection() {
    this.selectedPaths.clear();
    this.lastSelectedPath = null;
  }

  selectPaths(paths: string[], mode: "replace" | "add") {
    if (mode === "replace") {
      this.selectedPaths.clear();
    }
    for (const path of paths) {
      this.selectedPaths.add(path);
    }
    if (paths.length > 0) {
      this.lastSelectedPath = paths[paths.length - 1];
    }
  }

  setFocused(value: boolean) {
    this.focused = value;
  }

  startRename(entry: SftpEntry) {
    this.renameTargetPath = entry.path;
    this.renameDraft = entry.name;
  }

  cancelRename() {
    this.renameTargetPath = null;
    this.renameDraft = "";
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
    const parent = parentRemotePath(targetPath);
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
        this.error = mapFileError(e, "files.renameFailed");
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
    if (!this.connectionId || !this.settingsStore) {
      this.error = { code: "files.settingsNotInit" };
      return;
    }
    try {
      const { localPath } = await sftpIpc.sftpFetchToCache(
        this.connectionId,
        entry.path,
      );
      await openInEditor(
        localPath,
        this.settingsStore.settings.defaultEditorPath,
      );
    } catch (e) {
      runInAction(() => {
        this.error = mapFileError(e, "files.openFailed");
      });
    }
  }

  async deleteEntry(entry: SftpEntry) {
    if (!this.connectionId) return;
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
          i18n.t("files.confirm.deleteDir", {
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
          this.error = mapFileError(e, "files.deleteFailed");
          this.isLoading = false;
        });
      }
      return;
    }

    if (
      !window.confirm(i18n.t("files.confirm.deleteFile", { name: entry.name }))
    ) {
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
        this.error = mapFileError(e, "files.deleteFailed");
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
        this.error = mapFileError(e, "files.mkdirFailed");
        this.isLoading = false;
      });
    }
  }

  manualSyncBrowse() {
    void runSyncBrowseAction(async () => {
      await this.doSyncLocalBrowse(this.cwd);
      if (this.localBrowserStore?.cwd) {
        await this.localBrowserStore.doSyncRemoteBrowse(
          this.localBrowserStore.cwd,
        );
      }
    });
  }
}
