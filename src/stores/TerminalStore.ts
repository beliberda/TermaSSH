import { makeAutoObservable, runInAction } from 'mobx';
import type { ConnectionStatusPayload, TerminalTab, WorkspaceView } from '@/types';
import type { SessionConfig } from '@/types';
import type { AppError } from '@i18n/types';
import { getIpcErrorPayload } from '@ipc/client';
import * as terminalIpc from '@ipc/terminal';
import { listenTerminalOutput } from '@ipc/events';
import type { SessionStore } from './SessionStore';
import type { VaultStore } from './VaultStore';
import type { WorkspaceStore } from './WorkspaceStore';

export type TerminalHandle = {
  write: (data: Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
  focus: () => void;
  clear: () => void;
};

export type PendingConnect = {
  sessionId: string;
  passphraseRetry?: boolean;
  reconnectTabId?: string;
};

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isSessionNotFoundError(error: AppError): boolean {
  return error.code === 'session.notFound';
}

function shouldPromptPassphrase(
  authType: string | undefined,
  password: string | undefined,
  error: AppError,
): boolean {
  if (authType !== 'privateKey') return false;
  if (error.code === 'ssh.keyLoadFailed') return true;
  if (!password && error.code === 'ssh.passwordRequired') return true;
  return false;
}

function shouldPromptPassword(
  authType: string | undefined,
  error: AppError,
): boolean {
  return authType === 'password' && error.code === 'ssh.passwordRequired';
}

export class TerminalStore {
  tabs: TerminalTab[] = [];
  activeTabId: string | null = null;
  pendingConnect: PendingConnect | null = null;
  private sessionStore: SessionStore | null = null;
  private vaultStore: VaultStore | null = null;
  private workspaceStore: WorkspaceStore | null = null;
  private listenersInitialized = false;
  private terminalHandles = new Map<string, TerminalHandle>();
  private unlistenFns: Array<() => void> = [];

  constructor() {
    makeAutoObservable(this);
  }

  setSessionStore(sessionStore: SessionStore) {
    this.sessionStore = sessionStore;
  }

  setVaultStore(vaultStore: VaultStore) {
    this.vaultStore = vaultStore;
  }

  setWorkspaceStore(workspaceStore: WorkspaceStore) {
    this.workspaceStore = workspaceStore;
  }

  clearStalePendingConnect(validSessionIds: Set<string>) {
    if (
      this.pendingConnect &&
      !validSessionIds.has(this.pendingConnect.sessionId)
    ) {
      this.pendingConnect = null;
    }
  }

  private resolveSession(
    sessionId: string | undefined,
    session?: SessionConfig,
  ): SessionConfig | undefined {
    if (!sessionId) return session;
    return session ?? this.sessionStore?.getSessionById(sessionId);
  }

  private schedulePassphrasePrompt(sessionId: string, tabId: string) {
    this.tabs = this.tabs.filter((t) => t.id !== tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs[this.tabs.length - 1]?.id ?? null;
    }
    this.pendingConnect = { sessionId, passphraseRetry: true };
  }

  private schedulePassphrasePromptReconnect(sessionId: string, tabId: string) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.status = 'error';
      tab.connectionId = undefined;
    }
    this.pendingConnect = {
      sessionId,
      passphraseRetry: true,
      reconnectTabId: tabId,
    };
  }

  get activeTab(): TerminalTab | null {
    if (!this.activeTabId) return null;
    return this.tabs.find((t) => t.id === this.activeTabId) ?? null;
  }

  get activeConnectionId(): string | null {
    return this.activeTab?.connectionId ?? null;
  }

  getTabByConnectionId(connectionId: string): TerminalTab | undefined {
    return this.tabs.find((t) => t.connectionId === connectionId);
  }

  canReconnect(tab: TerminalTab): boolean {
    return tab.status === 'error' || tab.status === 'disconnected';
  }

  registerTerminal(tabId: string, handle: TerminalHandle) {
    this.terminalHandles.set(tabId, handle);
  }

  unregisterTerminal(tabId: string) {
    this.terminalHandles.delete(tabId);
  }

  routeOutput(connectionId: string, data: Uint8Array) {
    const tab = this.getTabByConnectionId(connectionId);
    if (!tab) return;
    this.terminalHandles.get(tab.id)?.write(data);
  }

  async initListeners() {
    if (this.listenersInitialized) return;
    this.listenersInitialized = true;

    const unlistenOutput = await listenTerminalOutput((payload) => {
      const bytes = base64ToBytes(payload.data);
      this.routeOutput(payload.connectionId, bytes);
    });

    this.unlistenFns.push(unlistenOutput);
  }

  requestConnect(sessionId: string, session?: SessionConfig) {
    void this.beginConnect(sessionId, session);
  }

  private async beginConnect(sessionId: string, session?: SessionConfig) {
    await this.sessionStore?.flushPersist();
    const resolved = this.resolveSession(sessionId, session);
    if (!resolved) {
      runInAction(() => {
        this.pendingConnect = null;
        if (this.sessionStore) {
          this.sessionStore.error = { code: 'session.notFoundInList' };
        }
      });
      return;
    }

    if (resolved.authType === 'password') {
      if (this.vaultStore?.isUnlocked) {
        await this.openTab(sessionId, undefined, resolved);
        return;
      }
      runInAction(() => {
        this.pendingConnect = { sessionId };
      });
      return;
    }

    await this.openTab(sessionId, undefined, resolved);
  }

  cancelPendingConnect() {
    this.pendingConnect = null;
  }

  async openTab(sessionId: string, password?: string, session?: SessionConfig) {
    await this.sessionStore?.flushPersist();
    const resolved = this.resolveSession(sessionId, session);
    if (!resolved) {
      runInAction(() => {
        this.pendingConnect = null;
        if (this.sessionStore) {
          this.sessionStore.error = { code: 'session.notFoundInList' };
        }
      });
      return;
    }

    const tabId = crypto.randomUUID();
    const title = `${resolved.name} (${resolved.host})`;

    const tab: TerminalTab = {
      id: tabId,
      kind: 'ssh',
      sessionId,
      title,
      status: 'connecting',
      connectStartedAt: performance.now(),
      workspaceView: resolved.protocol === 'sftp' ? 'files' : 'terminal',
    };

    runInAction(() => {
      this.tabs.push(tab);
      this.activeTabId = tabId;
      this.pendingConnect = null;
      this.sessionStore?.selectSession(sessionId);
      this.workspaceStore?.setActiveTerminalTab(tabId);
    });

    await this.connectTab(tabId, sessionId, password, resolved);
  }

  async openLocalShellTab(shellId: string, label: string) {
    const tabId = crypto.randomUUID();

    const tab: TerminalTab = {
      id: tabId,
      kind: 'local',
      shellId,
      title: label,
      status: 'connecting',
      connectStartedAt: performance.now(),
      workspaceView: 'terminal',
    };

    runInAction(() => {
      this.tabs.push(tab);
      this.activeTabId = tabId;
      this.workspaceStore?.setActiveTerminalTab(tabId);
    });

    await this.connectLocalTab(tabId, shellId);
  }

  private async connectLocalTab(tabId: string, shellId: string) {
    try {
      const { connectionId } = await terminalIpc.localShellConnect(shellId);
      const tabStillOpen = this.tabs.some((x) => x.id === tabId);
      if (!tabStillOpen) {
        void terminalIpc.terminalDisconnect(connectionId).catch((err) => {
          console.error('[TerminalStore] orphan disconnect failed:', err);
        });
        return;
      }
      runInAction(() => {
        const t = this.tabs.find((x) => x.id === tabId);
        if (t) {
          t.connectionId = connectionId;
          t.reconnecting = false;
        }
      });
    } catch (e) {
      const error = getIpcErrorPayload(e);
      runInAction(() => {
        const t = this.tabs.find((x) => x.id === tabId);
        if (t) {
          t.connectionId = undefined;
          t.status = 'error';
          t.error = error;
          t.reconnecting = false;
        }
      });
    }
  }

  async reconnectTab(tabId: string, password?: string) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab || !this.canReconnect(tab)) return;

    if (tab.kind === 'local') {
      const oldConnectionId = tab.connectionId;
      if (oldConnectionId) {
        void terminalIpc.terminalDisconnect(oldConnectionId).catch((e) => {
          console.error('[TerminalStore] disconnect before reconnect failed:', e);
        });
      }

      this.terminalHandles.get(tabId)?.clear();

      runInAction(() => {
        tab.status = 'connecting';
        tab.connectionId = undefined;
        tab.error = undefined;
        tab.connectStartedAt = performance.now();
        tab.reconnecting = true;
        this.activeTabId = tabId;
      });

      await this.connectLocalTab(tabId, tab.shellId!);
      return;
    }

    await this.sessionStore?.flushPersist();
    const sessionId = tab.sessionId;
    if (!sessionId) return;
    const resolved = this.resolveSession(sessionId);
    if (!resolved) {
      runInAction(() => {
        this.pendingConnect = null;
        if (this.sessionStore) {
          this.sessionStore.error = { code: 'session.notFoundInList' };
        }
      });
      return;
    }

    if (resolved.authType === 'password' && !password) {
      if (!this.vaultStore?.isUnlocked) {
        runInAction(() => {
          this.pendingConnect = { sessionId, reconnectTabId: tabId };
        });
        return;
      }
    }

    const oldConnectionId = tab.connectionId;
    if (oldConnectionId) {
      void terminalIpc.terminalDisconnect(oldConnectionId).catch((e) => {
        console.error('[TerminalStore] disconnect before reconnect failed:', e);
      });
    }

    this.terminalHandles.get(tabId)?.clear();

    runInAction(() => {
      tab.status = 'connecting';
      tab.connectionId = undefined;
      tab.error = undefined;
      tab.connectStartedAt = performance.now();
      tab.reconnecting = true;
      this.pendingConnect = null;
      this.activeTabId = tabId;
      this.sessionStore?.selectSession(sessionId);
    });

    await this.connectTab(tabId, sessionId, password, resolved, true);
  }

  private async connectTab(
    tabId: string,
    sessionId: string,
    password: string | undefined,
    resolved: SessionConfig,
    isReconnect = false,
  ) {
    try {
      const { connectionId } = await terminalIpc.terminalConnect(
        sessionId,
        password,
      );
      const tabStillOpen = this.tabs.some((x) => x.id === tabId);
      if (!tabStillOpen) {
        void terminalIpc.terminalDisconnect(connectionId).catch((err) => {
          console.error('[TerminalStore] orphan disconnect failed:', err);
        });
        return;
      }
      runInAction(() => {
        const t = this.tabs.find((x) => x.id === tabId);
        if (t) {
          t.connectionId = connectionId;
          t.reconnecting = false;
        }
      });
    } catch (e) {
      const error = getIpcErrorPayload(e);

      if (shouldPromptPassphrase(resolved.authType, password, error)) {
        runInAction(() => {
          if (isReconnect) {
            this.schedulePassphrasePromptReconnect(sessionId, tabId);
          } else {
            this.schedulePassphrasePrompt(sessionId, tabId);
          }
        });
        return;
      }

      if (shouldPromptPassword(resolved.authType, error)) {
        runInAction(() => {
          if (isReconnect) {
            this.pendingConnect = {
              sessionId,
              reconnectTabId: tabId,
            };
            const t = this.tabs.find((x) => x.id === tabId);
            if (t) {
              t.status = 'error';
              t.connectionId = undefined;
              t.reconnecting = false;
            }
          } else {
            this.tabs = this.tabs.filter((t) => t.id !== tabId);
            if (this.activeTabId === tabId) {
              this.activeTabId = this.tabs[this.tabs.length - 1]?.id ?? null;
            }
            this.pendingConnect = { sessionId };
          }
        });
        return;
      }

      if (isSessionNotFoundError(error)) {
        await this.sessionStore?.load();
        runInAction(() => {
          if (isReconnect) {
            const t = this.tabs.find((x) => x.id === tabId);
            if (t) {
              t.connectionId = undefined;
              t.status = 'error';
              t.error = error;
              t.reconnecting = false;
            }
          } else {
            this.tabs = this.tabs.filter((t) => t.id !== tabId);
            if (this.activeTabId === tabId) {
              this.activeTabId = this.tabs[this.tabs.length - 1]?.id ?? null;
            }
          }
          this.pendingConnect = null;
          if (this.sessionStore) {
            this.sessionStore.error = { code: 'session.notFoundReloaded' };
          }
        });
        return;
      }

      runInAction(() => {
        const t = this.tabs.find((x) => x.id === tabId);
        if (t) {
          t.connectionId = undefined;
          t.status = 'error';
          t.error = error;
          t.reconnecting = false;
        }
      });
    }
  }

  async closeTabsForMissingSessions(validSessionIds: Set<string>) {
    const orphanTabIds = this.tabs
      .filter((tab) => tab.sessionId !== undefined && !validSessionIds.has(tab.sessionId))
      .map((tab) => tab.id);

    for (const tabId of orphanTabIds) {
      await this.closeTab(tabId);
    }
  }

  closeTab(tabId: string) {
    const tab = this.tabs.find((t) => t.id === tabId);
    const connectionId = tab?.connectionId;

    runInAction(() => {
      this.tabs = this.tabs.filter((t) => t.id !== tabId);
      if (this.activeTabId === tabId) {
        const next = this.tabs[this.tabs.length - 1];
        this.activeTabId = next?.id ?? null;
        if (next) {
          this.workspaceStore?.setActiveTerminalTab(next.id);
        } else {
          this.workspaceStore?.clearIfTab(tabId);
        }
      }
    });

    this.unregisterTerminal(tabId);

    if (connectionId) {
      void terminalIpc.terminalDisconnect(connectionId).catch((e) => {
        console.error('[TerminalStore] disconnect failed:', e);
      });
    }
  }

  setActiveTab(tabId: string) {
    const tab = this.tabs.find((t) => t.id === tabId);
    runInAction(() => {
      this.activeTabId = tabId;
      if (tab) {
        if (tab.sessionId) {
          this.sessionStore?.selectSession(tab.sessionId);
        }
        this.workspaceStore?.setActiveTerminalTab(tabId);
      }
    });
  }

  async writeToTab(tabId: string, data: Uint8Array) {
    const tab = this.tabs.find((t) => t.id === tabId);
    const connectionId = tab?.connectionId;
    if (!connectionId) return;

    let binary = '';
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    const base64 = btoa(binary);
    try {
      await terminalIpc.terminalWrite(connectionId, base64);
    } catch (e) {
      console.error('[TerminalStore] write failed:', e);
    }
  }

  async resizeTab(tabId: string, cols: number, rows: number) {
    const tab = this.tabs.find((t) => t.id === tabId);
    const connectionId = tab?.connectionId;
    if (!connectionId || tab.status !== 'connected') return;

    try {
      await terminalIpc.terminalResize(connectionId, cols, rows);
    } catch (e) {
      console.error('[TerminalStore] resize failed:', e);
    }
  }

  setWorkspaceView(tabId: string, view: WorkspaceView) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.workspaceView = view;
    }
  }

  toggleWorkspaceView(tabId: string) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    tab.workspaceView = tab.workspaceView === 'files' ? 'terminal' : 'files';
  }

  handleConnectionStatus(payload: ConnectionStatusPayload) {
    runInAction(() => {
      if (payload.status === 'error' && payload.error) {
        const connectingTab =
          this.tabs.find(
            (t) =>
              !t.connectionId &&
              t.status === 'connecting' &&
              t.id === this.activeTabId,
          ) ??
          this.tabs.find((t) => !t.connectionId && t.status === 'connecting');

        if (connectingTab && connectingTab.sessionId) {
          const sessionId = connectingTab.sessionId;
          const session = this.resolveSession(sessionId);
          if (
            session &&
            shouldPromptPassphrase(session.authType, undefined, payload.error)
          ) {
            if (connectingTab.reconnecting) {
              this.schedulePassphrasePromptReconnect(sessionId, connectingTab.id);
            } else {
              this.schedulePassphrasePrompt(sessionId, connectingTab.id);
            }
            return;
          }
        }
      }

      let tab = this.tabs.find(
        (t) => t.connectionId === payload.connectionId,
      );
      if (!tab && payload.status === 'connected') {
        tab = this.tabs.find(
          (t) => !t.connectionId && t.status === 'connecting',
        );
        if (tab) {
          tab.connectionId = payload.connectionId;
        }
      }
      if (!tab) return;

      if (payload.status === 'error' || payload.status === 'disconnected') {
        tab.connectionId = undefined;
      } else if (payload.status === 'connected') {
        tab.connectionId = payload.connectionId;
      }

      tab.status = payload.status;
      if (payload.error) {
        tab.error = payload.error;
      } else if (payload.status === 'connected') {
        tab.error = undefined;
        if (tab.connectStartedAt !== undefined) {
          tab.connectLatencyMs = Math.round(
            performance.now() - tab.connectStartedAt,
          );
        }
      }
    });
  }
}
