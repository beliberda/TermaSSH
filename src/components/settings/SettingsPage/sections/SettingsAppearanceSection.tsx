import { useTranslation } from 'react-i18next';
import { OPACITY_MAX, OPACITY_MIN } from '@/types';
import type { AppSettings, PanelOpacity } from '@/types';
import styles from '../SettingsPage.module.css';

type Props = {
  values: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
};

const PANEL_KEYS: Array<keyof PanelOpacity> = [
  'sidebar',
  'panel',
  'tabBar',
  'statusBar',
];

export function SettingsAppearanceSection({ values, onChange }: Props) {
  const { t } = useTranslation();

  const setOpacity = (key: keyof PanelOpacity, value: number) => {
    onChange('opacity', { ...values.opacity, [key]: value });
  };

  const perPanelDisabled =
    !values.transparencyEnabled || !values.perPanelOpacityEnabled;

  return (
    <>
      <h2 className={styles.sectionTitle}>{t('settings.groups.appearance')}</h2>

      <div className={styles.field}>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={values.transparencyEnabled}
            onChange={(e) => onChange('transparencyEnabled', e.target.checked)}
          />
          {t('settings.appearance.transparencyEnabled')}
        </label>
        <p className={styles.hint}>{t('settings.appearance.transparencyHint')}</p>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="settings-opacity-window">
          {t('settings.appearance.windowOpacity')}
        </label>
        <div className={styles.rangeRow}>
          <input
            id="settings-opacity-window"
            type="range"
            min={OPACITY_MIN}
            max={OPACITY_MAX}
            disabled={!values.transparencyEnabled}
            value={values.opacity.window}
            onChange={(e) => setOpacity('window', Number(e.target.value))}
          />
          <span className={styles.rangeValue}>{values.opacity.window}%</span>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            disabled={!values.transparencyEnabled}
            checked={values.perPanelOpacityEnabled}
            onChange={(e) => onChange('perPanelOpacityEnabled', e.target.checked)}
          />
          {t('settings.appearance.perPanelEnabled')}
        </label>
        <p className={styles.hint}>{t('settings.appearance.perPanelHint')}</p>
      </div>

      {PANEL_KEYS.map((key) => (
        <div className={styles.field} key={key}>
          <label className={styles.label} htmlFor={`settings-opacity-${key}`}>
            {t(`settings.appearance.panels.${key}`)}
          </label>
          <div className={styles.rangeRow}>
            <input
              id={`settings-opacity-${key}`}
              type="range"
              min={OPACITY_MIN}
              max={OPACITY_MAX}
              disabled={perPanelDisabled}
              value={values.opacity[key]}
              onChange={(e) => setOpacity(key, Number(e.target.value))}
            />
            <span className={styles.rangeValue}>{values.opacity[key]}%</span>
          </div>
        </div>
      ))}
    </>
  );
}
