import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useStores } from '@stores/index';
import { formatShortcutLabel } from '@utils/shortcuts';
import styles from './FileTransferToolbar.module.css';

function shortcutSuffix(binding: string): string {
  const label = formatShortcutLabel(binding);
  return label ? ` (${label})` : '';
}

export const FileTransferToolbar = observer(function FileTransferToolbar() {
  const { t } = useTranslation();
  const {
    localBrowserStore,
    remoteBrowserStore,
    transferStore,
    settingsStore,
  } = useStores();

  const shortcuts = settingsStore.settings.shortcuts;

  return (
    <div className={styles.toolbar}>
      <button
        type="button"
        className={styles.btn}
        title={t('fileTransfer.shortcuts.refresh')}
        onClick={() => {
          localBrowserStore.refresh();
          remoteBrowserStore.refresh();
        }}
      >
        {t('common.refresh')}
        {shortcutSuffix(shortcuts.fileRefresh)}
      </button>
      <button
        type="button"
        className={styles.btn}
        title={t('fileTransfer.shortcuts.upload')}
        onClick={() => transferStore.uploadSelected()}
        disabled={localBrowserStore.selectedEntries.length === 0}
      >
        {t('common.upload')}
        {shortcutSuffix(shortcuts.fileUpload)}
      </button>
      <button
        type="button"
        className={styles.btn}
        title={t('fileTransfer.shortcuts.download')}
        onClick={() => transferStore.downloadSelected()}
        disabled={transferStore.isDownloadSelectionDisabled()}
      >
        {t('fileTransfer.download')}
        {shortcutSuffix(shortcuts.fileDownload)}
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={() => {
          const name = window.prompt(t('files.mkdir.prompt'));
          if (name) void remoteBrowserStore.mkdir(name);
        }}
      >
        {t('fileTransfer.remoteMkdir')}
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={() => remoteBrowserStore.manualSyncBrowse()}
      >
        {t('fileTransfer.syncBrowse')}
      </button>
    </div>
  );
});
