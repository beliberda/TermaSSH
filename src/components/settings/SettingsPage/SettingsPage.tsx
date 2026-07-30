import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useAppErrorMessage } from '@i18n/useAppErrorMessage';
import { useStores } from '@stores/index';
import type { AppSettings } from '@/types';
import type { SettingsGroup } from '@stores/SettingsStore';
import { SettingsGeneralSection } from './sections/SettingsGeneralSection';
import { SettingsAppearanceSection } from './sections/SettingsAppearanceSection';
import { SettingsTerminalSection } from './sections/SettingsTerminalSection';
import { SettingsConnectionsSection } from './sections/SettingsConnectionsSection';
import { SettingsPasswordManagerSection } from './sections/SettingsPasswordManagerSection';
import { SettingsShortcutsSection } from './sections/SettingsShortcutsSection';
import styles from './SettingsPage.module.css';

const GROUPS: SettingsGroup[] = [
  'general',
  'appearance',
  'terminal',
  'connections',
  'shortcuts',
  'passwordManager',
];

export const SettingsPage = observer(function SettingsPage() {
  const { t } = useTranslation();
  const { settingsStore, vaultStore } = useStores();
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const errorMessage = useAppErrorMessage(settingsStore.error);

  const values = draft ?? settingsStore.settings;

  useEffect(() => {
    return () => {
      vaultStore.clearCredentials();
    };
  }, [vaultStore]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        settingsStore.closeSettings();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsStore]);

  const update = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    setDraft({ ...values, [key]: value });
  };

  const handleSave = () => {
    void settingsStore.save(values);
    setDraft(null);
  };

  const handleBack = () => {
    settingsStore.closeSettings();
    setDraft(null);
  };

  const renderSection = () => {
    switch (settingsStore.activeGroup) {
      case 'general':
        return <SettingsGeneralSection values={values} onChange={update} />;
      case 'appearance':
        return <SettingsAppearanceSection values={values} onChange={update} />;
      case 'terminal':
        return <SettingsTerminalSection values={values} onChange={update} />;
      case 'connections':
        return (
          <SettingsConnectionsSection values={values} onChange={update} />
        );
      case 'shortcuts':
        return <SettingsShortcutsSection values={values} onChange={update} />;
      case 'passwordManager':
        return <SettingsPasswordManagerSection />;
      default:
        return null;
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={handleBack}
        >
          ← {t('settings.back')}
        </button>
        <h1 className={styles.title}>{t('settings.title')}</h1>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={handleSave}
        >
          {t('common.save')}
        </button>
      </header>
      <div className={styles.body}>
        <nav className={styles.nav}>
          {GROUPS.map((group) => (
            <button
              key={group}
              type="button"
              className={
                settingsStore.activeGroup === group
                  ? `${styles.navItem} ${styles.navItemActive}`
                  : styles.navItem
              }
              onClick={() => settingsStore.setActiveGroup(group)}
            >
              {t(`settings.groups.${group}`)}
            </button>
          ))}
        </nav>
        <div className={styles.content}>
          {errorMessage &&
            settingsStore.activeGroup !== 'passwordManager' &&
            settingsStore.activeGroup !== 'shortcuts' && (
              <p className={styles.error}>{errorMessage}</p>
            )}
          {renderSection()}
        </div>
      </div>
    </div>
  );
});
