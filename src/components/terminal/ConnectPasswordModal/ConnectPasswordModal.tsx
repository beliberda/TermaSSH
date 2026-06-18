import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useAppErrorMessage } from '@i18n/useAppErrorMessage';
import { useStores } from '@stores/index';
import styles from './ConnectPasswordModal.module.css';

export const ConnectPasswordModal = observer(function ConnectPasswordModal() {
  const { t } = useTranslation();
  const { terminalStore, fileConnectionStore, sessionStore, vaultStore } =
    useStores();
  const [password, setPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(false);

  const sshPending = terminalStore.pendingConnect;
  const ftpPending = fileConnectionStore.pendingConnect;
  const pending = sshPending ?? ftpPending;
  const pendingKey = sshPending
    ? `${sshPending.sessionId}:${sshPending.passphraseRetry ? 'passphrase' : 'password'}:${sshPending.reconnectTabId ?? 'new'}`
    : ftpPending
      ? `ftp:${ftpPending.sessionId}:${ftpPending.reconnectTabId ?? 'new'}`
      : null;

  useEffect(() => {
    if (pendingKey) {
      setPassword('');
      setRememberPassword(false);
    }
  }, [pendingKey]);

  const session = pending
    ? sessionStore.sessions.find((s) => s.id === pending.sessionId)
    : undefined;
  const sessionError = useAppErrorMessage(
    pending && !session ? { code: 'session.notFoundInList' } : null,
  );

  if (!pending) return null;

  const isFtp = session?.protocol === 'ftp';
  const isPassphraseRetry =
    !isFtp && sshPending?.passphraseRetry === true;
  const canRemember =
    !isPassphraseRetry &&
    session?.authType === 'password';
  const rememberDisabled = canRemember && vaultStore.exists && !vaultStore.isUnlocked;
  const canConnect = Boolean(session) && Boolean(password);

  const persistPasswordIfNeeded = async () => {
    if (!rememberPassword || !canRemember || !session) return;
    if (!vaultStore.exists) {
      vaultStore.openSetup({ sessionId: session.id, password });
      return;
    }
    if (vaultStore.isUnlocked) {
      await vaultStore.saveCredential(session.id, password);
    }
  };

  const handleConnect = () => {
    if (isFtp) {
      const reconnectTabId = ftpPending?.reconnectTabId;
      if (reconnectTabId) {
        void fileConnectionStore.reconnectTab(reconnectTabId, password);
      } else {
        void fileConnectionStore.openTab(pending.sessionId, password);
      }
      void persistPasswordIfNeeded();
    } else if (session) {
      const reconnectTabId = sshPending?.reconnectTabId;
      if (reconnectTabId) {
        void terminalStore.reconnectTab(reconnectTabId, password);
      } else {
        void terminalStore.openTab(pending.sessionId, password, session);
      }
      void persistPasswordIfNeeded();
    } else {
      terminalStore.cancelPendingConnect();
    }
    setPassword('');
    setRememberPassword(false);
  };

  const handleCancel = () => {
    if (isFtp) {
      fileConnectionStore.cancelPendingConnect();
    } else {
      terminalStore.cancelPendingConnect();
    }
    setPassword('');
    setRememberPassword(false);
  };

  const title = isFtp
    ? t('terminal.password.ftpTitle')
    : isPassphraseRetry
      ? t('terminal.password.keyPassphrase')
      : t('terminal.password.title');

  const hint = !session
    ? sessionError
    : `${session.name} — ${session.username}@${session.host}`;

  return (
    <div className={styles.overlay} onClick={handleCancel}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.hint}>{hint}</p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="connect-password">
            {isPassphraseRetry
              ? t('terminal.password.passphrase')
              : t('terminal.password.password')}
          </label>
          <input
            id="connect-password"
            type="password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConnect();
            }}
            autoFocus
          />
        </div>
        {canRemember && (
          <div className={styles.rememberRow}>
            <input
              id="connect-remember"
              type="checkbox"
              checked={rememberPassword}
              disabled={rememberDisabled}
              onChange={(e) => setRememberPassword(e.target.checked)}
            />
            <label htmlFor="connect-remember" className={styles.rememberLabel}>
              {t('vault.rememberPassword')}
              {rememberDisabled && (
                <div className={styles.rememberHint}>
                  {t('vault.rememberLockedHint')}
                </div>
              )}
            </label>
          </div>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnCancel}`}
            onClick={handleCancel}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnConnect}`}
            onClick={handleConnect}
            disabled={!canConnect}
          >
            {t('terminal.password.connect')}
          </button>
        </div>
      </div>
    </div>
  );
});
