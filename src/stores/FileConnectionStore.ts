import { makeAutoObservable, runInAction } from 'mobx';
import type { ConnectionStatus, ConnectionStatusPayload } from '@/types';
import type { AppError } from '@i18n/types';
import { getIpcErrorPayload } from '@ipc/client';
import * as ftpIpc from '@ipc/ftp';
import type { SessionStore } from './SessionStore';
import type { VaultStore } from './VaultStore';
import type { WorkspaceStore } from './WorkspaceStore';

export interface FtpConnectionState {
  connectionId: string;
  status: ConnectionStatus;
  error?: AppError;
  connectLatencyMs?: number;
}

export interface FileTab {
  id: string;
  sessionId: string;
  connectionId?: string;
  title: string;
  status: ConnectionStatus;
  error?: AppError;
  connectLatencyMs?: number;
  reconnecting?: boolean;
}

export class FileConnectionStore {
  connections = new Map<string, FtpConnectionState>();
  tabs: FileTab[] = [];
  activeTabId: string | null = null;
  activeSessionId: string | null = null;
  pendingConnect: { sessionId: string; reconnectTabId?: string } | null = null;
  private sessionStore: SessionStore | null = null;
  private vaultStore: VaultStore | null = null;
  private workspaceStore: WorkspaceStore | null = null;

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

  get activeTab(): FileTab | null {
    if (!this.activeTabId) return null;
    return this.tabs.find((t) => t.id === this.activeTabId) ?? null;
  }

  get activeConnection(): FtpConnectionState | null {
    if (!this.activeSessionId) return null;
    return this.connections.get(this.activeSessionId) ?? null;
  }

  canReconnect(tab: FileTab): boolean {
    return tab.status === 'error' || tab.status === 'disconnected';
  }

  requestConnect(sessionId: string) {
    if (this.vaultStore?.isUnlocked) {
      void this.openTab(sessionId);
      return;
    }
    this.pendingConnect = { sessionId };
  }

  cancelPendingConnect() {
    this.pendingConnect = null;
  }

  setActiveTab(tabId: string) {
    this.activeTabId = tabId;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      this.activeSessionId = tab.sessionId;
      this.sessionStore?.selectSession(tab.sessionId);
      this.workspaceStore?.setActiveFtpTab(tabId);
    }
  }

  async openTab(sessionId: string, password?: string) {
    const session = this.sessionStore?.getSessionById(sessionId);
    if (!session) return;

    const existing = this.tabs.find((t) => t.sessionId === sessionId);
    if (existing) {
      this.setActiveTab(existing.id);
      if (existing.status === 'connected') return;
    }

    const tabId = crypto.randomUUID();
    const title = `${session.name} (${session.host})`;
    const tab: FileTab = {
      id: tabId,
      sessionId,
      title,
      status: 'connecting',
    };

    runInAction(() => {
      if (!existing) {
        this.tabs.push(tab);
      }
      this.activeTabId = existing?.id ?? tabId;
      this.activeSessionId = sessionId;
      this.pendingConnect = null;
      this.sessionStore?.selectSession(sessionId);
      this.workspaceStore?.setActiveFtpTab(existing?.id ?? tabId);
    });

    await this.connect(sessionId, password);
  }

  async connect(
    sessionId: string,
    password?: string,
    reconnectTabId?: string,
  ) {
    this.activeSessionId = sessionId;
    this.pendingConnect = null;

    const tab = this.tabs.find((t) => t.sessionId === sessionId);
    if (tab) {
      runInAction(() => {
        tab.status = 'connecting';
        tab.error = undefined;
      });
    }

    runInAction(() => {
      this.connections.set(sessionId, {
        connectionId: '',
        status: 'connecting',
      });
    });

    const startedAt = performance.now();

    try {
      const { connectionId } = await ftpIpc.ftpConnect(sessionId, password);
      runInAction(() => {
        this.connections.set(sessionId, {
          connectionId,
          status: 'connected',
          connectLatencyMs: Math.round(performance.now() - startedAt),
        });
        if (tab) {
          tab.connectionId = connectionId;
          tab.status = 'connected';
          tab.connectLatencyMs = Math.round(performance.now() - startedAt);
        }
      });
    } catch (e) {
      const error = getIpcErrorPayload(e);
      if (error.code === 'ftp.passwordRequired') {
        runInAction(() => {
          this.pendingConnect = { sessionId, reconnectTabId };
          if (tab) {
            tab.status = 'error';
            tab.error = undefined;
          }
          this.connections.delete(sessionId);
        });
        return;
      }
      runInAction(() => {
        const err =
          error.code === 'unknown'
            ? { code: 'ftp.connectFailedFrontend' }
            : error;
        this.connections.set(sessionId, {
          connectionId: '',
          status: 'error',
          error: err,
        });
        if (tab) {
          tab.status = 'error';
          tab.error = err;
        }
      });
    }
  }

  async reconnectTab(tabId: string, password?: string) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab || !this.canReconnect(tab)) return;

    const session = this.sessionStore?.getSessionById(tab.sessionId);
    if (!session) {
      runInAction(() => {
        if (this.sessionStore) {
          this.sessionStore.error = { code: 'session.notFoundInList' };
        }
      });
      return;
    }

    if (session.authType === 'password' && !password) {
      if (!this.vaultStore?.isUnlocked) {
        runInAction(() => {
          this.pendingConnect = { sessionId: tab.sessionId, reconnectTabId: tabId };
        });
        return;
      }
    }

    const oldConnectionId = tab.connectionId;
    if (oldConnectionId) {
      void ftpIpc.ftpDisconnect(oldConnectionId).catch((e) => {
        console.error('[FileConnectionStore] disconnect before reconnect failed:', e);
      });
    }

    runInAction(() => {
      tab.status = 'connecting';
      tab.connectionId = undefined;
      tab.error = undefined;
      tab.reconnecting = true;
      this.pendingConnect = null;
      this.activeTabId = tabId;
      this.activeSessionId = tab.sessionId;
      this.sessionStore?.selectSession(tab.sessionId);
      this.workspaceStore?.setActiveFtpTab(tabId);
    });

    await this.connect(tab.sessionId, password, tabId);

    runInAction(() => {
      tab.reconnecting = false;
    });
  }

  handleConnectionStatus(payload: ConnectionStatusPayload) {
    for (const [sessionId, conn] of this.connections.entries()) {
      if (conn.connectionId === payload.connectionId) {
        runInAction(() => {
          this.connections.set(sessionId, {
            ...conn,
            status: payload.status,
            error: payload.error,
          });
          const tab = this.tabs.find((t) => t.sessionId === sessionId);
          if (tab) {
            tab.status = payload.status;
            tab.error = payload.error;
            if (payload.status === 'connected') {
              tab.connectionId = payload.connectionId;
            }
            if (payload.status === 'error' || payload.status === 'disconnected') {
              tab.connectionId = undefined;
            }
          }
        });
        return;
      }
    }
  }

  async closeTab(tabId: string) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    if (tab.connectionId) {
      try {
        await ftpIpc.ftpDisconnect(tab.connectionId);
      } catch (e) {
        console.error('[FileConnectionStore] disconnect failed:', e);
      }
    }

    runInAction(() => {
      this.tabs = this.tabs.filter((t) => t.id !== tabId);
      this.connections.delete(tab.sessionId);
      if (this.activeTabId === tabId) {
        const next = this.tabs[this.tabs.length - 1];
        this.activeTabId = next?.id ?? null;
        this.activeSessionId = next?.sessionId ?? null;
        if (next) {
          this.workspaceStore?.setActiveFtpTab(next.id);
        } else {
          this.workspaceStore?.clearIfTab(tabId);
        }
      }
    });
  }

  async disconnect(sessionId: string) {
    const conn = this.connections.get(sessionId);
    if (conn?.connectionId) {
      try {
        await ftpIpc.ftpDisconnect(conn.connectionId);
      } catch (e) {
        console.error('[FileConnectionStore] disconnect failed:', e);
      }
    }

    runInAction(() => {
      this.connections.delete(sessionId);
      this.tabs = this.tabs.filter((t) => t.sessionId !== sessionId);
      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null;
        this.activeTabId = null;
      }
    });
  }
}
