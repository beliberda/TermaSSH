import { useEffect } from 'react';
import { useStores } from '@stores/index';
import { connectSession } from '@utils/connectSession';
import { matchesShortcut } from '@utils/shortcuts';

function isTypingInInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

export function useAppShortcuts() {
  const {
    appStore,
    sessionStore,
    terminalStore,
    fileConnectionStore,
    workspaceStore,
    localBrowserStore,
    remoteBrowserStore,
    transferStore,
    settingsStore,
  } = useStores();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (appStore.activeView === 'settings') return;

      const inInput = isTypingInInput();
      const shortcuts = settingsStore.settings.shortcuts;

      const fileMode = workspaceStore.isFileMode(
        terminalStore,
        fileConnectionStore,
        sessionStore,
      );

      if (fileMode && !inInput) {
        if (matchesShortcut(e, shortcuts.fileRefresh)) {
          e.preventDefault();
          localBrowserStore.refresh();
          remoteBrowserStore.refresh();
          return;
        }
        if (matchesShortcut(e, shortcuts.fileRename)) {
          e.preventDefault();
          const entry = remoteBrowserStore.focused
            ? remoteBrowserStore.selectedEntries[0]
            : localBrowserStore.selectedEntries[0];
          if (entry) {
            if (remoteBrowserStore.focused) {
              remoteBrowserStore.startRename(entry);
            } else {
              localBrowserStore.startRename(entry);
            }
          }
          return;
        }
        if (matchesShortcut(e, shortcuts.fileUpload)) {
          e.preventDefault();
          transferStore.uploadSelected();
          return;
        }
        if (matchesShortcut(e, shortcuts.fileDownload)) {
          e.preventDefault();
          transferStore.downloadSelected();
          return;
        }
        if (matchesShortcut(e, shortcuts.focusLocalPane)) {
          e.preventDefault();
          localBrowserStore.setFocused(true);
          remoteBrowserStore.setFocused(false);
          return;
        }
        if (matchesShortcut(e, shortcuts.focusRemotePane)) {
          e.preventDefault();
          remoteBrowserStore.setFocused(true);
          localBrowserStore.setFocused(false);
          return;
        }
        if (matchesShortcut(e, shortcuts.fileSelectAll)) {
          e.preventDefault();
          if (remoteBrowserStore.focused) {
            remoteBrowserStore.selectAll();
          } else {
            localBrowserStore.selectAll();
          }
          return;
        }
        if (matchesShortcut(e, shortcuts.toggleWorkspaceView)) {
          e.preventDefault();
          const tab = terminalStore.activeTab;
          if (tab) terminalStore.toggleWorkspaceView(tab.id);
          return;
        }
      }

      if (inInput) return;

      if (matchesShortcut(e, shortcuts.connectSession)) {
        e.preventDefault();
        const selected = sessionStore.selectedId
          ? sessionStore.sessions.find((s) => s.id === sessionStore.selectedId)
          : null;
        if (selected) {
          connectSession(selected, {
            sessionStore,
            terminalStore,
            fileConnectionStore,
            appStore,
          });
        } else {
          appStore.setSidebarTab('sessions');
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.reconnectTab)) {
        if (fileMode) {
          if (workspaceStore.active?.kind === 'ftp') {
            const ftpTab = fileConnectionStore.activeTab;
            if (ftpTab && fileConnectionStore.canReconnect(ftpTab)) {
              e.preventDefault();
              void fileConnectionStore.reconnectTab(ftpTab.id);
              return;
            }
          } else {
            const tab = terminalStore.activeTab;
            if (tab && terminalStore.canReconnect(tab)) {
              e.preventDefault();
              void terminalStore.reconnectTab(tab.id);
              return;
            }
          }
        }
        const tab = terminalStore.activeTab;
        if (tab && terminalStore.canReconnect(tab)) {
          e.preventDefault();
          void terminalStore.reconnectTab(tab.id);
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.closeTab)) {
        if (
          workspaceStore.active?.kind === 'ftp' &&
          fileConnectionStore.activeTabId
        ) {
          e.preventDefault();
          void fileConnectionStore.closeTab(fileConnectionStore.activeTabId);
        } else if (terminalStore.activeTabId) {
          e.preventDefault();
          void terminalStore.closeTab(terminalStore.activeTabId);
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.toggleSidebarTab)) {
        e.preventDefault();
        appStore.setSidebarTab(
          appStore.sidebarTab === 'sessions' ? 'files' : 'sessions',
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    appStore,
    sessionStore,
    terminalStore,
    fileConnectionStore,
    workspaceStore,
    localBrowserStore,
    remoteBrowserStore,
    transferStore,
    settingsStore,
  ]);
}
