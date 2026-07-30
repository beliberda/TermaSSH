import { invoke } from '@tauri-apps/api/core';

// Best-effort forwarding of frontend errors into the same termassh.log the
// Rust side writes to, so a crash report has one place to look instead of
// requiring devtools to have been open at the time. Must never throw itself.
export function logFrontendError(message: string, context?: string): void {
  invoke('frontend_log_error', { message, context: context ?? null }).catch(() => {});
}
