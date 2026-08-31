export type SidebarTab = 'sessions' | 'files';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export {
  protocolSchema,
  authTypeSchema,
  sessionSchema,
  sessionFolderSchema,
  sessionsFileSchema,
  sessionsFileV2Schema,
  getDefaultPort,
  createEmptySession,
  createEmptyFolder,
  createEmptySessionsFile,
  migrateSessionsFile,
  prepareSessionForSave,
  translateSessionValidationMessage,
} from './session';

export type {
  Protocol,
  AuthType,
  FileConflictPolicy,
  SessionConfig,
  SessionFolder,
  SessionsFile,
  SessionsFileV2,
} from './session';

export {
  fileConflictPolicySchema,
  getSessionRemotePath,
  getSessionLocalPath,
} from './session';

export {
  connectionStatusPayloadSchema,
  terminalOutputPayloadSchema,
} from './terminal';

export type {
  TerminalTab,
  TerminalTabKind,
  WorkspaceView,
  ConnectionStatusPayload,
  TerminalOutputPayload,
  ShellInfo,
} from './terminal';

export { sftpEntrySchema } from './sftp';

export type { ListDirResponse, RecursiveFileEntry, SftpEntry } from './sftp';

export {
  appSettingsSchema,
  defaultAppSettings,
  OPACITY_MIN,
  OPACITY_MAX,
} from './settings';

export type { AppSettings, PanelOpacity } from './settings';
