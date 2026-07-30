import { makeAutoObservable, runInAction } from 'mobx';
import {
  appSettingsSchema,
  defaultAppSettings,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  type AppSettings,
} from '@/types/settings';
import { detectLocale, isAppLocale } from '@i18n/config';
import { changeLocale, initI18n } from '@i18n/index';
import type { AppError } from '@i18n/types';
import * as settingsIpc from '@ipc/settings';
import { mergeShortcuts, validateShortcuts } from '@utils/shortcuts';
import type { AppStore } from './AppStore';

export type SettingsGroup =
  | 'general'
  | 'appearance'
  | 'terminal'
  | 'connections'
  | 'passwordManager'
  | 'shortcuts';

export class SettingsStore {
  settings: AppSettings = { ...defaultAppSettings };
  isLoading = false;
  activeGroup: SettingsGroup = 'general';
  error: AppError | null = null;

  private appStore: AppStore | null = null;
  private saveSidebarTimer: ReturnType<typeof setTimeout> | null = null;
  private localeInitialized = false;

  constructor() {
    makeAutoObservable(this);
    initI18n(defaultAppSettings.locale);
  }

  setAppStore(appStore: AppStore) {
    this.appStore = appStore;
  }

  setActiveGroup(group: SettingsGroup) {
    this.activeGroup = group;
  }

  openSettings() {
    this.activeGroup = 'general';
    this.error = null;
    this.appStore?.openSettings();
  }

  closeSettings() {
    this.appStore?.closeSettings();
    this.error = null;
  }

  async load() {
    this.isLoading = true;
    try {
      const data = await settingsIpc.settingsLoad();
      const parsed = appSettingsSchema.safeParse(data);
      const merged = parsed.success
        ? { ...defaultAppSettings, ...parsed.data }
        : { ...defaultAppSettings };
      merged.shortcuts = mergeShortcuts(
        parsed.success ? parsed.data.shortcuts : undefined,
      );

      const needsDetect =
        !parsed.success ||
        !data ||
        typeof data !== 'object' ||
        !('locale' in data);

      if (needsDetect && !this.localeInitialized) {
        merged.locale = detectLocale();
        this.localeInitialized = true;
        void this.save(merged);
      }

      runInAction(() => {
        this.settings = merged;
        this.isLoading = false;
        this.applyTheme();
        this.applySidebarWidth();
        this.applyOpacity();
        void this.applyLocale();
      });
    } catch (e) {
      runInAction(() => {
        this.settings = { ...defaultAppSettings, locale: detectLocale() };
        this.isLoading = false;
        this.applyTheme();
        this.applySidebarWidth();
        this.applyOpacity();
        void this.applyLocale();
      });
      console.error('[SettingsStore] load failed:', e);
    }
  }

  async save(next: AppSettings) {
    const parsed = appSettingsSchema.safeParse(next);
    if (!parsed.success) {
      this.error = { code: 'settings.invalid' };
      return;
    }

    const shortcutsValidation = validateShortcuts(parsed.data.shortcuts);
    if (!shortcutsValidation.ok) {
      runInAction(() => {
        this.error = {
          code: `settings.${shortcutsValidation.code}`,
          details:
            shortcutsValidation.binding !== undefined
              ? { binding: shortcutsValidation.binding }
              : undefined,
        };
      });
      return;
    }

    const payload: AppSettings = {
      ...parsed.data,
      shortcuts: shortcutsValidation.config,
    };

    try {
      await settingsIpc.settingsSave(payload);
      runInAction(() => {
        this.settings = payload;
        this.error = null;
        this.applyTheme();
        this.applySidebarWidth();
        this.applyOpacity();
        void this.applyLocale();
      });
    } catch (e) {
      runInAction(() => {
        this.error = { code: 'settings.saveFailed' };
      });
      console.error('[SettingsStore] save failed:', e);
    }
  }

  async applyLocale() {
    const locale = isAppLocale(this.settings.locale)
      ? this.settings.locale
      : defaultAppSettings.locale;
    await changeLocale(locale);
  }

  applyTheme() {
    document.documentElement.dataset.theme = this.settings.theme;
  }

  applyOpacity() {
    const { transparencyEnabled, perPanelOpacityEnabled, opacity } = this.settings;
    const root = document.documentElement.style;
    const windowAlpha = transparencyEnabled ? opacity.window / 100 : 1;
    const panelAlpha = (value: number) =>
      !transparencyEnabled ? 1 : perPanelOpacityEnabled ? value / 100 : windowAlpha;

    root.setProperty('--opacity-window', String(windowAlpha));
    root.setProperty('--opacity-sidebar', String(panelAlpha(opacity.sidebar)));
    root.setProperty('--opacity-panel', String(panelAlpha(opacity.panel)));
    root.setProperty('--opacity-tabbar', String(panelAlpha(opacity.tabBar)));
    root.setProperty('--opacity-statusbar', String(panelAlpha(opacity.statusBar)));
  }

  applySidebarWidth() {
    const width = this.settings.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT;
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  }

  setSidebarWidth(width: number) {
    const clamped = Math.min(
      SIDEBAR_WIDTH_MAX,
      Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)),
    );
    this.settings = { ...this.settings, sidebarWidth: clamped };
    this.applySidebarWidth();
  }

  async saveSidebarWidth() {
    if (this.saveSidebarTimer) {
      clearTimeout(this.saveSidebarTimer);
    }

    this.saveSidebarTimer = setTimeout(() => {
      this.saveSidebarTimer = null;
      void this.save(this.settings);
    }, 300);
  }
}
