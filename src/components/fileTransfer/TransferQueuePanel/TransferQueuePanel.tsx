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

  if (transferStore.tasks.length === 0) return null;

  return (
    <div
      className={`${styles.panel} ${transferStore.queueExpanded ? styles.expanded : styles.collapsed}`}
    >
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
            total: transferStore.tasks.length,
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
      {transferStore.queueExpanded && (
        <div className={styles.list}>
          {transferStore.tasks.map((task) => {
            const pct =
              task.bytesTotal > 0
                ? Math.min(100, (task.bytesDone / task.bytesTotal) * 100)
                : task.status === 'done'
                  ? 100
                  : 0;
            return (
              <div key={task.id} className={styles.item}>
                <div className={styles.itemHeader}>
                  <span className={styles.fileName} title={task.fileName}>
                    {task.direction === 'upload' ? '↑' : '↓'} {task.fileName}
                  </span>
                  <span className={styles.status}>
                    {t(`fileTransfer.transfers.status.${task.status}`)}
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
