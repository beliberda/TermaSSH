import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import {
  MAX_CONCURRENT_TRANSFERS_MAX,
  MAX_CONCURRENT_TRANSFERS_MIN,
} from '@/types/settings';
import type { AppSettings } from '@/types';
import styles from '../SettingsPage.module.css';

type Props = {
  values: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
};

export function SettingsConnectionsSection({ values, onChange }: Props) {
  const { t } = useTranslation();

  const handleBrowseEditor = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: t('common.executable'), extensions: ['exe'] }],
    });
    if (typeof selected === 'string') {
      onChange('defaultEditorPath', selected);
    }
  };

  return (
    <>
      <h2 className={styles.sectionTitle}>{t('settings.groups.connections')}</h2>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="settings-editor-path">
          {t('settings.editorPath')}
        </label>
        <div className={styles.keyRow}>
          <input
            id="settings-editor-path"
            type="text"
            className={styles.input}
            value={values.defaultEditorPath}
            onChange={(e) => onChange('defaultEditorPath', e.target.value)}
            placeholder={t('settings.editorPlaceholder')}
          />
          <button
            type="button"
            className={styles.browseBtn}
            onClick={() => void handleBrowseEditor()}
          >
            {t('common.browse')}
          </button>
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="settings-ssh-port">
          {t('settings.sshPort')}
        </label>
        <input
          id="settings-ssh-port"
          type="number"
          min={1}
          max={65535}
          className={styles.input}
          value={values.defaultSshPort}
          onChange={(e) =>
            onChange('defaultSshPort', Number(e.target.value) || 22)
          }
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="settings-ftp-port">
          {t('settings.ftpPort')}
        </label>
        <input
          id="settings-ftp-port"
          type="number"
          min={1}
          max={65535}
          className={styles.input}
          value={values.defaultFtpPort}
          onChange={(e) =>
            onChange('defaultFtpPort', Number(e.target.value) || 21)
          }
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="settings-max-transfers">
          {t('settings.maxConcurrentTransfers')}
        </label>
        <input
          id="settings-max-transfers"
          type="number"
          min={MAX_CONCURRENT_TRANSFERS_MIN}
          max={MAX_CONCURRENT_TRANSFERS_MAX}
          className={styles.input}
          value={values.maxConcurrentTransfers}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            const clamped = Number.isFinite(parsed)
              ? Math.min(
                  MAX_CONCURRENT_TRANSFERS_MAX,
                  Math.max(MAX_CONCURRENT_TRANSFERS_MIN, Math.round(parsed)),
                )
              : MAX_CONCURRENT_TRANSFERS_MIN;
            onChange('maxConcurrentTransfers', clamped);
          }}
        />
      </div>
    </>
  );
}
