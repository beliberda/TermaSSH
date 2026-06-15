import { z } from 'zod';
import { i18n } from '@i18n/index';

export const protocolSchema = z.enum(['ssh', 'sftp', 'ftp']);
export const authTypeSchema = z.enum(['password', 'privateKey', 'agent']);

export const fileConflictPolicySchema = z.enum([
  'ask',
  'alwaysReplace',
  'replaceIfDifferentSize',
  'replaceIfDifferentSizeOrNewer',
]);

export const sessionSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1, { message: 'name' }),
    protocol: protocolSchema,
    host: z.string().min(1, { message: 'host' }),
    port: z.number().int().min(1).max(65535),
    username: z.string().min(1, { message: 'username' }),
    authType: authTypeSchema,
    privateKeyPath: z.string().optional(),
    defaultPath: z.string().optional(),
    localPath: z.string().optional(),
    remotePath: z.string().optional(),
    syncBrowse: z.boolean().optional(),
    fileConflictPolicy: fileConflictPolicySchema.optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.authType === 'privateKey' && !data.privateKeyPath?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'keyPathRequired',
        path: ['privateKeyPath'],
      });
    }
  });

export const sessionFolderSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  parentId: z.string().uuid().nullable().optional(),
  collapsed: z.boolean().default(false),
  childOrder: z.array(z.string().uuid()).default([]),
});

export const sessionsFileV1Schema = z.object({
  schemaVersion: z.literal(1),
  sessions: z.array(sessionSchema),
});

export const sessionsFileV2Schema = z.object({
  schemaVersion: z.literal(2),
  rootOrder: z.array(z.string().uuid()),
  folders: z.array(sessionFolderSchema),
  sessions: z.array(sessionSchema),
});

export const sessionsFileSchema = z.union([
  sessionsFileV2Schema,
  sessionsFileV1Schema,
]);

export type Protocol = z.infer<typeof protocolSchema>;
export type AuthType = z.infer<typeof authTypeSchema>;
export type FileConflictPolicy = z.infer<typeof fileConflictPolicySchema>;
export type SessionConfig = z.infer<typeof sessionSchema>;
export type SessionFolder = z.infer<typeof sessionFolderSchema>;
export type SessionsFileV2 = z.infer<typeof sessionsFileV2Schema>;
export type SessionsFile = SessionsFileV2;

const SESSION_VALIDATION_KEYS: Record<string, string> = {
  name: 'session.validation.nameRequired',
  host: 'session.validation.hostRequired',
  username: 'session.validation.usernameRequired',
  port: 'session.validation.portInvalid',
  privateKeyPath: 'session.validation.keyPathRequired',
  keyPathRequired: 'session.validation.keyPathRequired',
};

export function translateSessionValidationMessage(
  field: string,
  message: string,
): string {
  const key = SESSION_VALIDATION_KEYS[field] ?? SESSION_VALIDATION_KEYS[message];
  return key ? i18n.t(key) : message;
}

export function getDefaultPort(protocol: Protocol): number {
  return protocol === 'ftp' ? 21 : 22;
}

function newId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createEmptySession(): SessionConfig {
  const ts = nowIso();
  return {
    id: newId(),
    name: '',
    protocol: 'ssh',
    host: '',
    port: 22,
    username: '',
    authType: 'password',
    createdAt: ts,
    updatedAt: ts,
  };
}

export function createEmptyFolder(
  name?: string,
  parentId: string | null = null,
): SessionFolder {
  return {
    id: newId(),
    name: name ?? i18n.t('session.newFolder'),
    parentId,
    collapsed: false,
    childOrder: [],
  };
}

export function createEmptySessionsFile(): SessionsFileV2 {
  return {
    schemaVersion: 2,
    rootOrder: [],
    folders: [],
    sessions: [],
  };
}

export function migrateSessionsFile(data: unknown): SessionsFileV2 {
  const v1 = sessionsFileV1Schema.safeParse(data);
  if (v1.success) {
    return {
      schemaVersion: 2,
      rootOrder: v1.data.sessions.map((s) => s.id),
      folders: [],
      sessions: v1.data.sessions,
    };
  }

  const v2 = sessionsFileV2Schema.safeParse(data);
  if (v2.success) {
    return v2.data;
  }

  throw new Error('Invalid sessions file format');
}

function isWindowsLocalPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.includes(':\\');
}

export function getSessionRemotePath(session: SessionConfig): string {
  const raw = (session.remotePath ?? session.defaultPath)?.trim();
  if (!raw) return '/';
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) {
    return raw.replace(/\\/g, '/');
  }
  if (isWindowsLocalPath(raw)) {
    return '/';
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function getSessionLocalPath(session: SessionConfig): string | undefined {
  return session.localPath?.trim() || undefined;
}

export function prepareSessionForSave(
  data: SessionConfig,
  isNew: boolean,
): SessionConfig {
  const ts = nowIso();
  const remotePath = data.remotePath?.trim() || data.defaultPath?.trim() || undefined;
  return {
    ...data,
    port: data.port || getDefaultPort(data.protocol),
    createdAt: isNew ? ts : data.createdAt,
    updatedAt: ts,
    privateKeyPath:
      data.authType === 'privateKey' ? data.privateKeyPath?.trim() : undefined,
    defaultPath: remotePath,
    remotePath,
    localPath: data.localPath?.trim() || undefined,
    syncBrowse: data.syncBrowse ?? true,
    fileConflictPolicy: data.fileConflictPolicy,
  };
}
