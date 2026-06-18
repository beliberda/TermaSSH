import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useStores } from '@stores/index';
import styles from './TransferQueuePanel.module.css';

function formatProgress(done: number, total: number): string {
  if (total <= 0) return '—';
  return `${Math.round((done / total) * 100)}%`;
}

export const TransferQueuePanel = observer(function TransferQueuePanel() {
  const { t } = useTranslation();
  const { transferStore } = useStores();

  const preparingDownloads = Array.from(transferStore.preparingDownloads.values());
  const preparingUploads = Array.from(transferStore.preparingUploads.values());
  const preparing = [...preparingDownloads, ...preparingUploads];
  const hasContent = transferStore.tasks.length > 0 || preparing.length > 0;

  if (!hasContent) return null;

  const totalItems = transferStore.tasks.length + preparing.length;

  return (
    <div
      className={`${styles.panel} ${transferStore.queueExpanded ? styles.expanded : styles.collapsed}`}
    >
      <div className={styles.headerRow}>
        <button
          type="button"
          className={styles.header}
          onClick={() =>
            transferStore.setQueueExpanded(!transferStore.queueExpanded)
          }
        >
          <span>
            {t('fileTransfer.transfers.title', {
              active: transferStore.activeCount,
              total: totalItems,
            })}
            {transferStore.runningCount > 1 &&
              ` (${t('fileTransfer.transfers.running', {
                count: transferStore.runningCount,
              })})`}
          </span>
          <span className={styles.toggle}>
            {transferStore.queueExpanded ? '▼' : '▲'}
          </span>
        </button>
        {transferStore.cancellableCount > 0 && (
          <button
            type="button"
            className={styles.cancelAllBtn}
            onClick={() => transferStore.cancelAll()}
          >
            {t('fileTransfer.transfers.cancelAll')}
          </button>
        )}
      </div>
      {transferStore.queueExpanded && (
        <div className={styles.list}>
          {preparingDownloads.map((item) => (
            <div key={`dl-${item.remotePath}`} className={styles.item}>
              <div className={styles.itemHeader}>
                <span className={styles.fileName} title={item.label}>
                  ↓ {item.label}
                </span>
                <span className={styles.status}>
                  {t('fileTransfer.transfers.preparing')}
                </span>
              </div>
              <div className={styles.barTrack}>
                <div className={`${styles.barFill} ${styles.barIndeterminate}`} />
              </div>
            </div>
          ))}
          {preparingUploads.map((item) => (
            <div key={`ul-${item.localPath}`} className={styles.item}>
              <div className={styles.itemHeader}>
                <span className={styles.fileName} title={item.label}>
                  ↑ {item.label}
                </span>
                <span className={styles.status}>
                  {t('fileTransfer.transfers.preparing')}
                </span>
              </div>
              <div className={styles.barTrack}>
                <div className={`${styles.barFill} ${styles.barIndeterminate}`} />
              </div>
            </div>
          ))}
          {transferStore.tasks.map((task) => {
            const pct =
              task.bytesTotal > 0
                ? Math.min(100, (task.bytesDone / task.bytesTotal) * 100)
                : task.status === 'done'
                  ? 100
                  : 0;
            const canCancel =
              task.status === 'queued' || task.status === 'running';
            return (
              <div key={task.id} className={styles.item}>
                <div className={styles.itemHeader}>
                  <span className={styles.fileName} title={task.fileName}>
                    {task.direction === 'upload' ? '↑' : '↓'} {task.fileName}
                  </span>
                  <span className={styles.itemActions}>
                    <span className={styles.status}>
                      {t(`fileTransfer.transfers.status.${task.status}`)}
                    </span>
                    {canCancel && (
                      <button
                        type="button"
                        className={styles.cancelBtn}
                        title={t('fileTransfer.transfers.cancel')}
                        onClick={() => transferStore.cancelTask(task.id)}
                      >
                        ×
                      </button>
                    )}
                  </span>
                </div>
                <div className={styles.barTrack}>
                  <div
                    className={styles.barFill}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={styles.progress}>
                  {formatProgress(task.bytesDone, task.bytesTotal)}
                </span>
              </div>
            );
          })}
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => transferStore.clearCompleted()}
          >
            {t('fileTransfer.transfers.clearCompleted')}
          </button>
        </div>
      )}
    </div>
  );
});
