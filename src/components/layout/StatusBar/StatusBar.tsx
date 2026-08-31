import { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useStores } from '@stores/index';
import type { ConnectionStatus } from '@/types';
import styles from './StatusBar.module.css';

export const StatusBar = observer(function StatusBar() {
  const { t } = useTranslation();
  const {
    terminalStore,
    fileConnectionStore,
    sessionStore,
    workspaceStore,
    localBrowserStore,
    remoteBrowserStore,
    transferStore,
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

  const fileMode = workspaceStore.isFileMode(
    terminalStore,
    fileConnectionStore,
    sessionStore,
  );

  let host = t('common.empty');
  let status: ConnectionStatus = 'disconnected';
  let latency: number | undefined;

  if (workspaceStore.active?.kind === 'ftp') {
    const tab = fileConnectionStore.activeTab;
    const session = tab
      ? sessionStore.sessions.find((s) => s.id === tab.sessionId)
      : null;
    if (session) {
      host = `${session.username}@${session.host}:${session.port}`;
    }
    status = tab?.status ?? 'disconnected';
    latency = tab?.connectLatencyMs;
  } else if (terminalStore.activeTab) {
    if (terminalStore.activeTab.kind === 'local') {
      host = terminalStore.activeTab.title;
    } else {
      const session = sessionStore.sessions.find(
        (s) => s.id === terminalStore.activeTab!.sessionId,
      );
      if (session) {
        host = `${session.username}@${session.host}:${session.port}`;
      }
    }
    status = terminalStore.activeTab.status;
    latency = terminalStore.activeTab.connectLatencyMs;
  }

  return (
    <footer className={styles.statusBar}>
      <span className={styles.item}>
        <span className={styles.label}>{t('common.host')}:</span>
        <span className={styles.value}>{host}</span>
      </span>
      <span className={styles.item}>
        <span className={styles.label}>{t('common.status')}:</span>
        <span className={styles.value}>
          {statusLabels[status] ?? status}
        </span>
      </span>
      <span className={styles.item}>
        <span className={styles.label}>{t('common.connect')}:</span>
        <span className={styles.value}>
          {latency !== undefined ? `${latency} ms` : t('common.empty')}
        </span>
      </span>
      {fileMode && (
        <>
          <span className={styles.item}>
            <span className={styles.label}>{t('fileTransfer.status.local')}:</span>
            <span className={styles.valuePath} title={localBrowserStore.cwd}>
              {localBrowserStore.cwd || t('common.empty')}
            </span>
          </span>
          <span className={styles.item}>
            <span className={styles.label}>{t('fileTransfer.status.remote')}:</span>
            <span className={styles.valuePath} title={remoteBrowserStore.cwd}>
              {remoteBrowserStore.cwd}
            </span>
          </span>
        </>
      )}
      {transferStore.hasActiveTransfers && (
        <span className={styles.item}>
          <span className={styles.label}>{t('fileTransfer.transfers.active')}:</span>
          <span className={styles.value}>
            {transferStore.activeCount}
          </span>
        </span>
      )}
    </footer>
  );
});
