import { z } from 'zod';
import { LOCALE_CODES } from '@i18n/config';
import { fileConflictPolicySchema } from './session';
import { defaultShortcuts, shortcutsConfigSchema } from './shortcuts';

export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 520;
export const SIDEBAR_WIDTH_DEFAULT = 240;
export const MAX_CONCURRENT_TRANSFERS_MIN = 1;
export const MAX_CONCURRENT_TRANSFERS_MAX = 8;
export const MAX_CONCURRENT_TRANSFERS_DEFAULT = 3;
export const OPACITY_MIN = 30;
export const OPACITY_MAX = 100;
export const OPACITY_DEFAULT = 85;

export const panelOpacitySchema = z.object({
  window: z.number().int().min(OPACITY_MIN).max(OPACITY_MAX).default(OPACITY_DEFAULT),
  sidebar: z.number().int().min(OPACITY_MIN).max(OPACITY_MAX).default(OPACITY_DEFAULT),
  panel: z.number().int().min(OPACITY_MIN).max(OPACITY_MAX).default(OPACITY_DEFAULT),
  tabBar: z.number().int().min(OPACITY_MIN).max(OPACITY_MAX).default(OPACITY_DEFAULT),
  statusBar: z.number().int().min(OPACITY_MIN).max(OPACITY_MAX).default(OPACITY_DEFAULT),
});

export type PanelOpacity = z.infer<typeof panelOpacitySchema>;

export const defaultPanelOpacity: PanelOpacity = {
  window: OPACITY_DEFAULT,
  sidebar: OPACITY_DEFAULT,
  panel: OPACITY_DEFAULT,
  tabBar: OPACITY_DEFAULT,
  statusBar: OPACITY_DEFAULT,
};

export const appSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  theme: z.enum(['dark', 'light']),
  terminalFontSize: z.number().int().min(8).max(32),
  terminalFontFamily: z.string().min(1),
  defaultSshPort: z.number().int().min(1).max(65535),
  defaultFtpPort: z.number().int().min(1).max(65535),
  defaultEditorPath: z.string(),
  sidebarWidth: z
    .number()
    .int()
    .min(SIDEBAR_WIDTH_MIN)
    .max(SIDEBAR_WIDTH_MAX)
    .default(SIDEBAR_WIDTH_DEFAULT),
  locale: z.enum(LOCALE_CODES).default('ru'),
  defaultFileConflictPolicy: fileConflictPolicySchema.default('ask'),
  maxConcurrentTransfers: z
    .number()
    .int()
    .min(MAX_CONCURRENT_TRANSFERS_MIN)
    .max(MAX_CONCURRENT_TRANSFERS_MAX)
    .default(MAX_CONCURRENT_TRANSFERS_DEFAULT),
  shortcuts: shortcutsConfigSchema.default(defaultShortcuts),
  transparencyEnabled: z.boolean().default(false),
  perPanelOpacityEnabled: z.boolean().default(false),
  opacity: panelOpacitySchema.default(defaultPanelOpacity),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const defaultAppSettings: AppSettings = {
  schemaVersion: 1,
  theme: 'dark',
  terminalFontSize: 14,
  terminalFontFamily: 'Consolas, "Courier New", monospace',
  defaultSshPort: 22,
  defaultFtpPort: 21,
  defaultEditorPath: '',
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  locale: 'ru',
  defaultFileConflictPolicy: 'ask',
  maxConcurrentTransfers: MAX_CONCURRENT_TRANSFERS_DEFAULT,
  shortcuts: { ...defaultShortcuts },
  transparencyEnabled: false,
  perPanelOpacityEnabled: false,
  opacity: { ...defaultPanelOpacity },
};
