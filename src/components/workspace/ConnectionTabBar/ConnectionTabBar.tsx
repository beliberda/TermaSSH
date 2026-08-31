import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useStores } from '@stores/index';
import type { ConnectionStatus, ShellInfo } from '@/types';
import { AnchorPopup } from '@components/ui/AnchorPopup/AnchorPopup';
import menuStyles from '@components/ui/AnchorPopup/AnchorPopup.module.css';
import * as terminalIpc from '@ipc/terminal';
import styles from './ConnectionTabBar.module.css';

const NewConsoleMenu = observer(function NewConsoleMenu() {
  const { t } = useTranslation();
  const { terminalStore } = useStores();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [shells, setShells] = useState<ShellInfo[] | null>(null);

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setAnchor({ x: rect.left, y: rect.bottom });
    void terminalIpc.localShellList().then(setShells);
  };

  return (
    <>
      <button
        type="button"
        className={styles.newConsoleBtn}
        title={t('terminal.tabs.newConsole')}
        aria-haspopup="menu"
        onClick={openMenu}
      >
        +
      </button>
      {anchor && (
        <AnchorPopup anchor={anchor} onClose={() => setAnchor(null)}>
          {shells === null && (
            <span className={menuStyles.menuItem}>{t('common.loading')}</span>
          )}
          {shells?.length === 0 && (
            <span className={menuStyles.menuItem}>{t('terminal.consoles.empty')}</span>
          )}
          {shells?.map((shell) => (
            <button
              key={shell.id}
              type="button"
              className={menuStyles.menuItem}
              onClick={() => {
                void terminalStore.openLocalShellTab(
                  shell.id,
                  t(`terminal.consoles.${shell.id}`, { defaultValue: shell.label }),
                );
                setAnchor(null);
              }}
            >
              {t(`terminal.consoles.${shell.id}`, { defaultValue: shell.label })}
            </button>
          ))}
        </AnchorPopup>
      )}
    </>
  );
});

function statusClass(status: ConnectionStatus): string {
  switch (status) {
    case 'connecting':
      return styles.statusConnecting;
    case 'connected':
      return styles.statusConnected;
    case 'error':
      return styles.statusError;
    default:
      return styles.statusDisconnected;
  }
}

export const ConnectionTabBar = observer(function ConnectionTabBar() {
  const { t } = useTranslation();
  const {
    terminalStore,
    fileConnectionStore,
    sessionStore,
    workspaceStore,
  } = useStores();

  const statusLabels = useMemo(
    (): Record<ConnectionStatus, string> => ({
      connecting: t('terminal.status.connecting'),
      connected: t('terminal.status.connected'),
      disconnected: t('terminal.status.disconnected'),
      error: t('terminal.status.error'),
    }),
    [t],
  );

  const hasTabs =
    terminalStore.tabs.length > 0 || fileConnectionStore.tabs.length > 0;

  if (!hasTabs) {
    return (
      <div className={styles.tabBar}>
        <span className={styles.empty}>{t('terminal.tabs.empty')}</span>
        <NewConsoleMenu />
      </div>
    );
  }

  return (
    <div className={styles.tabBar}>
      {terminalStore.tabs.map((tab) => {
        const session = sessionStore.sessions.find((s) => s.id === tab.sessionId);
        const isSftp = session?.protocol === 'sftp';
        const isActive =
          workspaceStore.active?.kind === 'terminal' &&
          workspaceStore.active.tabId === tab.id;

        return (
          <div
            key={tab.id}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
          >
            <button
              type="button"
              className={styles.tabMain}
              onClick={() => terminalStore.setActiveTab(tab.id)}
            >
              <span
                className={`${styles.statusDot} ${statusClass(tab.status)}`}
                title={statusLabels[tab.status]}
              />
              <span className={styles.tabTitle}>{tab.title}</span>
            </button>
            {isSftp && tab.status === 'connected' && (
              <div className={styles.viewToggle}>
                <button
                  type="button"
                  className={`${styles.viewBtn} ${tab.workspaceView === 'files' ? styles.viewBtnActive : ''}`}
                  title={t('fileTransfer.view.files')}
                  onClick={() => terminalStore.setWorkspaceView(tab.id, 'files')}
                >
                  {t('fileTransfer.view.filesShort')}
                </button>
                <button
                  type="button"
                  className={`${styles.viewBtn} ${tab.workspaceView !== 'files' ? styles.viewBtnActive : ''}`}
                  title={t('fileTransfer.view.terminal')}
                  onClick={() =>
                    terminalStore.setWorkspaceView(tab.id, 'terminal')
                  }
                >
                  {t('fileTransfer.view.terminalShort')}
                </button>
              </div>
            )}
            <button
              type="button"
              className={styles.closeBtn}
              title={t('terminal.tabs.close')}
              aria-label={t('terminal.tabs.closeTab', { title: tab.title })}
              onClick={() => void terminalStore.closeTab(tab.id)}
            >
              ×
            </button>
          </div>
        );
      })}
      {fileConnectionStore.tabs.map((tab) => {
        const isActive =
          workspaceStore.active?.kind === 'ftp' &&
          workspaceStore.active.tabId === tab.id;

        return (
          <div
            key={tab.id}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
          >
            <button
              type="button"
              className={styles.tabMain}
              onClick={() => fileConnectionStore.setActiveTab(tab.id)}
            >
              <span
                className={`${styles.statusDot} ${statusClass(tab.status)}`}
                title={statusLabels[tab.status]}
              />
              <span className={styles.tabTitle}>{tab.title}</span>
            </button>
            <button
              type="button"
              className={styles.closeBtn}
              title={t('terminal.tabs.close')}
              aria-label={t('terminal.tabs.closeTab', { title: tab.title })}
              onClick={() => void fileConnectionStore.closeTab(tab.id)}
            >
              ×
            </button>
          </div>
        );
      })}
      <NewConsoleMenu />
    </div>
  );
});
