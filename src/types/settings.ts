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
};
