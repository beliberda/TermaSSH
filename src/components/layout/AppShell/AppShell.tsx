import { useEffect } from 'react';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Sidebar } from '@components/sidebar/Sidebar/Sidebar';
import { ConnectionWorkspace } from '@components/workspace/ConnectionWorkspace/ConnectionWorkspace';
import { StatusBar } from '@components/layout/StatusBar/StatusBar';
import { ConnectPasswordModal } from '@components/terminal/ConnectPasswordModal/ConnectPasswordModal';
import { VaultUnlockModal } from '@components/vault/VaultUnlockModal/VaultUnlockModal';
import { VaultSetupModal } from '@components/vault/VaultSetupModal/VaultSetupModal';
import { SettingsPage } from '@components/settings/SettingsPage/SettingsPage';
import { FileConflictModal } from '@components/fileTransfer/FileConflictModal/FileConflictModal';
import { useStores } from '@stores/index';
import { useAppShortcuts } from '@hooks/useAppShortcuts';
import { listenConnectionStatus } from '@ipc/events';
import styles from './AppShell.module.css';

export const AppShell = observer(function AppShell() {
  const {
    sessionStore,
    terminalStore,
    fileBrowserStore,
    fileConnectionStore,
    remoteBrowserStore,
    workspaceStore,
    transferStore,
    appStore,
    settingsStore,
    vaultStore,
  } = useStores();

  useAppShortcuts();

  useEffect(() => {
    sessionStore.load();
    void settingsStore.load();
    void vaultStore.init();
    void terminalStore.initListeners();
    void transferStore.initListeners();

    void listenConnectionStatus((payload) => {
      terminalStore.handleConnectionStatus(payload);
      fileConnectionStore.handleConnectionStatus(payload);
    });
  }, [
    sessionStore,
    terminalStore,
    fileConnectionStore,
    transferStore,
    settingsStore,
    vaultStore,
  ]);

  useEffect(() => {
    const disposeBind = reaction(
      () => [
        terminalStore.activeConnectionId,
        terminalStore.activeTab?.status,
        terminalStore.activeTab?.sessionId,
        terminalStore.activeTab?.workspaceView,
        fileConnectionStore.activeTabId,
        fileConnectionStore.activeTab?.status,
        fileConnectionStore.activeTab?.connectionId,
        workspaceStore.active,
      ],
      () => {
        fileBrowserStore.bind(
          terminalStore,
          sessionStore,
          fileConnectionStore,
        );

        const bindSource = workspaceStore.resolveRemoteBind(
          terminalStore,
          fileConnectionStore,
          sessionStore,
        );
        remoteBrowserStore.bind(bindSource);
      },
      { fireImmediately: true },
    );

    const disposeRefresh = reaction(
      () => [appStore.sidebarTab, workspaceStore.active] as const,
      ([tab]) => {
        if (tab !== 'files') return;
        if (
          workspaceStore.isFileMode(
            terminalStore,
            fileConnectionStore,
            sessionStore,
          )
        ) {
          return;
        }
        fileBrowserStore.refresh();
      },
    );

    return () => {
      disposeBind();
      disposeRefresh();
    };
  }, [
    appStore,
    sessionStore,
    terminalStore,
    fileBrowserStore,
    fileConnectionStore,
    remoteBrowserStore,
    workspaceStore,
  ]);

  if (appStore.activeView === 'settings') {
    return <SettingsPage />;
  }

  return (
    <div className={styles.shell}>
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.main}>
          <ConnectionWorkspace />
        </main>
      </div>
      <StatusBar />
      <ConnectPasswordModal />
      <VaultUnlockModal />
      <VaultSetupModal />
      <FileConflictModal />
    </div>
  );
});
