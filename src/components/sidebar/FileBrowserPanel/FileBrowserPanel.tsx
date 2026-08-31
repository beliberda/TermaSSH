import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useAppErrorMessage } from '@i18n/useAppErrorMessage';
import { useStores } from '@stores/index';
import { SftpToolbar } from '@components/sidebar/SftpToolbar/SftpToolbar';
import { SftpBreadcrumbs } from '@components/sidebar/SftpBreadcrumbs/SftpBreadcrumbs';
import { SftpFileList } from '@components/sidebar/SftpFileList/SftpFileList';
import styles from './FileBrowserPanel.module.css';

export const FileBrowserPanel = observer(function FileBrowserPanel() {
  const { t } = useTranslation();
  const {
    terminalStore,
    fileBrowserStore,
    fileConnectionStore,
    sessionStore,
    workspaceStore,
  } = useStores();

  const fileErrorMessage = useAppErrorMessage(fileBrowserStore.error);
  const activeTab = terminalStore.activeTab;
  const activeSession = activeTab
    ? sessionStore.sessions.find((s) => s.id === activeTab.sessionId)
    : null;

  const ftpOrSftpInMain =
    fileConnectionStore.tabs.length > 0 ||
    (activeSession?.protocol === 'sftp' &&
      workspaceStore.isFileMode(
        terminalStore,
        fileConnectionStore,
        sessionStore,
      ));

  if (ftpOrSftpInMain) {
    return (
      <div className={styles.placeholder}>
        <p className={styles.title}>{t('files.title')}</p>
        <p className={styles.hint}>{t('fileTransfer.sidebarMoved')}</p>
      </div>
    );
  }

  if (!activeTab) {
    return (
      <div className={styles.placeholder}>
        <p className={styles.title}>{t('files.title')}</p>
        <p className={styles.hint}>{t('files.noSession')}</p>
      </div>
    );
  }

  if (activeTab.kind === 'local') {
    return (
      <div className={styles.placeholder}>
        <p className={styles.title}>{t('files.title')}</p>
        <p className={styles.hint}>{t('files.localConsole')}</p>
      </div>
    );
  }

  if (activeTab.status === 'connecting') {
    return (
      <div className={styles.placeholder}>
        <p className={styles.title}>{t('files.title')}</p>
        <p className={styles.hint}>{t('files.connecting')}</p>
      </div>
    );
  }

  if (activeTab.status === 'error' || activeTab.status === 'disconnected') {
    return (
      <div className={styles.placeholder}>
        <p className={styles.title}>{t('files.title')}</p>
        <p className={styles.hint}>{t('files.notConnected')}</p>
      </div>
    );
  }

  if (fileBrowserStore.canBrowse) {
    const session = fileBrowserStore.sessionId
      ? sessionStore.sessions.find((s) => s.id === fileBrowserStore.sessionId)
      : null;

    return (
      <div className={styles.browser}>
        <p className={styles.protocol}>
          SFTP
          {session ? ` — ${session.name}` : ''}
        </p>
        <SftpToolbar />
        <SftpBreadcrumbs />
        {fileErrorMessage && (
          <p className={styles.error}>{fileErrorMessage}</p>
        )}
        <SftpFileList />
        {fileBrowserStore.isLoading && fileBrowserStore.entries.length > 0 && (
          <p className={styles.loadingBottom}>{t('files.updating')}</p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.placeholder}>
      <p className={styles.title}>{t('files.title')}</p>
      <p className={styles.hint}>{t('files.noSession')}</p>
    </div>
  );
});
