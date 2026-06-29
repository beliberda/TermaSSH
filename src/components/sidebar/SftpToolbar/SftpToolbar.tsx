import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useStores } from '@stores/index';
import styles from './SftpToolbar.module.css';

export const SftpToolbar = observer(function SftpToolbar() {
  const { t } = useTranslation();
  const { fileBrowserStore } = useStores();
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');

  const handleMkdirSubmit = () => {
    const name = mkdirName.trim();
    if (!name) return;
    void fileBrowserStore.mkdir(name);
    setMkdirName('');
    setMkdirOpen(false);
  };

  return (
    <div className={styles.toolbar}>
      <button
        type="button"
        className={styles.button}
        onClick={() => fileBrowserStore.refresh()}
        disabled={fileBrowserStore.isLoading}
      >
        {t('common.refresh')}
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => fileBrowserStore.upload().catch(console.error)}
        disabled={fileBrowserStore.isLoading}
      >
        {t('common.upload')}
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => setMkdirOpen((v) => !v)}
        disabled={fileBrowserStore.isLoading}
      >
        {t('common.folder')}
      </button>
      {mkdirOpen && (
        <div className={styles.mkdirRow}>
          <input
            className={styles.mkdirInput}
            type="text"
            placeholder={t('files.toolbar.folderName')}
            value={mkdirName}
            onChange={(e) => setMkdirName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleMkdirSubmit();
              if (e.key === 'Escape') setMkdirOpen(false);
            }}
          />
          <button
            type="button"
            className={styles.mkdirSubmit}
            onClick={handleMkdirSubmit}
          >
            {t('common.ok')}
          </button>
        </div>
      )}
    </div>
  );
});
