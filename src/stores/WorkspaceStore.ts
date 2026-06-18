import { makeAutoObservable } from 'mobx';
import type { RemoteBindSource } from './RemoteBrowserStore';
import type { FileConnectionStore } from './FileConnectionStore';
import type { SessionStore } from './SessionStore';
import type { TerminalStore } from './TerminalStore';

export type ActiveWorkspace =
  | { kind: 'terminal'; tabId: string }
  | { kind: 'ftp'; tabId: string }
  | null;

export class WorkspaceStore {
  active: ActiveWorkspace = null;

  constructor() {
    makeAutoObservable(this);
  }

  get showsFileTransfer(): boolean {
    if (!this.active) return false;
    if (this.active.kind === 'ftp') return true;
    return false;
  }

  isFileMode(
    terminalStore: TerminalStore,
    fileConnectionStore: FileConnectionStore,
    sessionStore: SessionStore,
  ): boolean {
    if (!this.active) return false;
    if (this.active.kind === 'ftp') {
      const tab = fileConnectionStore.tabs.find((t) => t.id === this.active!.tabId);
      return Boolean(tab);
    }
    const tab = terminalStore.tabs.find((t) => t.id === this.active!.tabId);
    if (!tab) return false;
    const session = sessionStore.sessions.find((s) => s.id === tab.sessionId);
    return session?.protocol === 'sftp' && tab.workspaceView === 'files';
  }

  isTerminalMode(
    terminalStore: TerminalStore,
    _fileConnectionStore: FileConnectionStore,
    sessionStore: SessionStore,
  ): boolean {
    if (!this.active) return false;
    if (this.active.kind === 'ftp') return false;
    const tab = terminalStore.tabs.find((t) => t.id === this.active!.tabId);
    if (!tab) return false;
    const session = sessionStore.sessions.find((s) => s.id === tab.sessionId);
    if (session?.protocol === 'sftp') {
      return tab.workspaceView !== 'files';
    }
    return true;
  }

  setActiveTerminalTab(tabId: string) {
    this.active = { kind: 'terminal', tabId };
  }

  setActiveFtpTab(tabId: string) {
    this.active = { kind: 'ftp', tabId };
  }

  clearIfTab(tabId: string) {
    if (this.active?.tabId === tabId) {
      this.active = null;
    }
  }

  resolveRemoteBind(
    terminalStore: TerminalStore,
    fileConnectionStore: FileConnectionStore,
    sessionStore: SessionStore,
  ): RemoteBindSource {
    if (!this.active) {
      return {
        connectionId: null,
        sessionId: null,
        session: null,
        status: null,
        protocol: null,
      };
    }

    if (this.active.kind === 'ftp') {
      const tab = fileConnectionStore.tabs.find((t) => t.id === this.active!.tabId);
      const session = tab
        ? sessionStore.sessions.find((s) => s.id === tab.sessionId) ?? null
        : null;
      return {
        connectionId: tab?.connectionId ?? null,
        sessionId: tab?.sessionId ?? null,
        session,
        status: tab?.status ?? null,
        protocol: 'ftp',
      };
    }

    const tab = terminalStore.tabs.find((t) => t.id === this.active!.tabId);
    const session = tab
      ? sessionStore.sessions.find((s) => s.id === tab.sessionId) ?? null
      : null;
    return {
      connectionId: tab?.connectionId ?? null,
      sessionId: tab?.sessionId ?? null,
      session,
      status: tab?.status ?? null,
      protocol: session?.protocol === 'ftp' ? 'ftp' : 'sftp',
    };
  }

}
