import { makeAutoObservable, runInAction } from "mobx";
import type { SftpEntry } from "@/types";
import type { AppError } from "@i18n/types";
import { getIpcErrorPayload } from "@ipc/client";
import * as localIpc from "@ipc/local";
import { parentLocalPath } from "@utils/filePaths";
import { openInEditor } from "@utils/openInEditor";
import {
  isSyncBrowseEnabled,
  isSyncBrowseGuarded,
  mapLocalToRemote,
  pathsEqual,
  runSyncBrowseAction,
} from "@utils/syncBrowse";
import type { RemoteBrowserStore } from "./RemoteBrowserStore";
import type { SettingsStore } from "./SettingsStore";

function mapLocalError(e: unknown, fallbackCode: string): AppError {
  const payload = getIpcErrorPayload(e);
  return payload.code === "unknown" ? { code: fallbackCode } : payload;
}

export class LocalBrowserStore {
  cwd = "";
  entries: SftpEntry[] = [];
  isLoading = false;
  error: AppError | null = null;
  selectedPaths = new Set<string>();
  lastSelectedPath: string | null = null;
  renameTargetPath: string | null = null;
  renameDraft = "";
  focused = false;
  private settingsStore: SettingsStore | null = null;
  private remoteBrowserStore: RemoteBrowserStore | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  setSettingsStore(settingsStore: SettingsStore) {
    this.settingsStore = settingsStore;
  }

  setRemoteBrowserStore(remoteBrowserStore: RemoteBrowserStore) {
    this.remoteBrowserStore = remoteBrowserStore;
  }

  get breadcrumbs(): { label: string; path: string }[] {
    if (!this.cwd) return [];
    const separator = this.cwd.includes("\\") ? "\\" : "/";
    const parts = this.cwd.split(/[/\\]/).filter(Boolean);
    const crumbs: { label: string; path: string }[] = [];

    if (separator === "\\" && /^[A-Za-z]:/.test(this.cwd)) {
      const drive = `${this.cwd.slice(0, 2)}${separator}`;
      crumbs.push({ label: drive, path: drive });
      let acc = drive.replace(/\\$/, "");
      for (const part of parts.slice(1)) {
        acc = `${acc}${separator}${part}`;
        crumbs.push({ label: part, path: acc });
      }
      return crumbs;
    }

    let acc = separator;
    crumbs.push({ label: separator, path: separator });
    for (const part of parts) {
      acc =
        acc === separator ? `${separator}${part}` : `${acc}${separator}${part}`;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }

  get selectedEntries(): SftpEntry[] {
    return this.entries.filter((e) => this.selectedPaths.has(e.path));
  }

  async init(startPath?: string) {
    if (startPath?.trim()) {
      await this.loadDir(startPath.trim(), { skipRemoteSync: true });
      return;
    }
    const home = await localIpc.localHomeDir();
    await this.loadDir(home ?? "C:\\", { skipRemoteSync: true });
  }

  async loadDir(path?: string, opts?: { skipRemoteSync?: boolean }) {
    const target = path ?? this.cwd;
    if (!target) return;
    this.cancelRename();

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const entries = await localIpc.localListDir(target);
      runInAction(() => {
        this.cwd = target;
        this.entries = entries;
        this.isLoading = false;
        this.selectedPaths.clear();
        this.lastSelectedPath = null;
      });
      if (!opts?.skipRemoteSync && !isSyncBrowseGuarded()) {
        this.syncRemoteBrowse(target);
      }
    } catch (e) {
      runInAction(() => {
        this.error = mapLocalError(e, "files.listFailed");
        this.isLoading = false;
      });
    }
  }

  syncRemoteBrowse(localPath: string) {
    void runSyncBrowseAction(() => this.doSyncRemoteBrowse(localPath));
  }

  async doSyncRemoteBrowse(localPath: string): Promise<void> {
    const remote = this.remoteBrowserStore;
    if (!remote?.session || !isSyncBrowseEnabled(remote.session)) return;
    if (!remote.canBrowse) return;

    const mapped = mapLocalToRemote(localPath, remote.session);
    if (!mapped) return;
    if (pathsEqual(remote.cwd, mapped)) return;

    await remote.loadDir(mapped, { soft: true, sync: false });
  }

  navigateTo(path: string) {
    void this.loadDir(path);
  }

  navigateUp() {
    if (!this.cwd) return;
    void this.loadDir(parentLocalPath(this.cwd));
  }

  refresh() {
    if (!this.cwd) return;
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
    const targetPath = this.renameTargetPath;
    if (!targetPath) return;
    const nextName = this.renameDraft.trim();
    if (!nextName) {
      this.cancelRename();
      return;
    }

    const parent = parentLocalPath(targetPath);
    const separator = targetPath.includes("\\") ? "\\" : "/";
    const trimmed = parent.replace(/[/\\]+$/, "");
    const newPath = `${trimmed}${separator}${nextName}`;

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      await localIpc.localRename(targetPath, newPath);
      await this.loadDir(this.cwd);
    } catch (e) {
      runInAction(() => {
        this.error = mapLocalError(e, "files.renameFailed");
        this.isLoading = false;
      });
    } finally {
      this.cancelRename();
    }
  }

  async deleteEntry(entry: SftpEntry) {
    this.cancelRename();
    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });
    try {
      await localIpc.localDelete(entry.path, entry.isDirectory);
      await this.loadDir(this.cwd);
    } catch (e) {
      runInAction(() => {
        this.error = mapLocalError(e, "files.deleteFailed");
        this.isLoading = false;
      });
    }
  }

  async mkdir(name: string) {
    if (!this.cwd || !name.trim()) return;
    const separator = this.cwd.includes("\\") ? "\\" : "/";
    const trimmed = this.cwd.replace(/[/\\]+$/, "");
    const path = `${trimmed}${separator}${name.trim()}`;
    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });
    try {
      await localIpc.localMkdir(path);
      await this.loadDir(this.cwd);
    } catch (e) {
      runInAction(() => {
        this.error = mapLocalError(e, "files.mkdirFailed");
        this.isLoading = false;
      });
    }
  }

  async copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
    } catch (e) {
      console.error("[LocalBrowserStore] copyPath failed:", e);
    }
  }

  async openEntry(entry: SftpEntry) {
    if (entry.isDirectory) {
      this.navigateTo(entry.path);
      return;
    }
    try {
      await openInEditor(
        entry.path,
        this.settingsStore?.settings.defaultEditorPath,
      );
    } catch (e) {
      runInAction(() => {
        this.error = mapLocalError(e, "files.openFailed");
      });
    }
  }

  async revealInExplorer(entry: SftpEntry) {
    try {
      await localIpc.localRevealInExplorer(entry.path);
    } catch (e) {
      runInAction(() => {
        this.error = mapLocalError(e, "files.openFailed");
      });
    }
  }
}
