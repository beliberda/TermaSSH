import type { DragEvent } from 'react';
import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useStores } from '@stores/index';
import { FileTransferToolbar } from '@components/fileTransfer/FileTransferToolbar/FileTransferToolbar';
import { FilePane } from '@components/fileTransfer/FilePane/FilePane';
import { PaneResizeHandle } from '@components/fileTransfer/PaneResizeHandle/PaneResizeHandle';
import { TransferQueuePanel } from '@components/fileTransfer/TransferQueuePanel/TransferQueuePanel';
import styles from './FileTransferWorkspace.module.css';

interface DragPayload {
  side: 'local' | 'remote';
  paths: string[];
  names: string[];
  isDirectories: boolean[];
  sizes: number[];
  modifiedAts: string[];
}

function parseDragData(e: DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData('application/termassh-files');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

export const FileTransferWorkspace = observer(function FileTransferWorkspace() {
  const { t } = useTranslation();
  const {
    localBrowserStore,
    remoteBrowserStore,
    transferStore,
    sessionStore,
  } = useStores();
  const panesRef = useRef<HTMLDivElement>(null);
  const [localPercent, setLocalPercent] = useState(50);
  const [dropTarget, setDropTarget] = useState<'local' | 'remote' | null>(null);

  const session = remoteBrowserStore.sessionId
    ? sessionStore.sessions.find((s) => s.id === remoteBrowserStore.sessionId)
    : null;

  const handleDropOnRemote = (e: DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    const data = parseDragData(e);
    if (!data || data.side !== 'local' || !remoteBrowserStore.connectionId) {
      return;
    }
    transferStore.enqueueUpload(
      data.paths,
      remoteBrowserStore.cwd,
      remoteBrowserStore.connectionId,
    );
  };

  const handleDropOnLocal = (e: DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    const data = parseDragData(e);
    if (!data || data.side !== 'remote' || !remoteBrowserStore.connectionId) {
      return;
    }
    const entries = data.paths.map((path, i) => ({
      path,
      name: data.names[i],
      isDirectory: data.isDirectories[i],
      size: data.sizes[i] ?? 0,
      modifiedAt: data.modifiedAts[i] || undefined,
    }));
    void transferStore.enqueueDownload(
      entries,
      localBrowserStore.cwd,
      remoteBrowserStore.connectionId,
      session,
    );
  };

  const allowDrop = (e: DragEvent, target: 'local' | 'remote') => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropTarget(target);
  };

  if (!remoteBrowserStore.canBrowse && remoteBrowserStore.connectionStatus === 'connecting') {
    return (
      <div className={styles.placeholder}>
        {t('files.connecting')}
      </div>
    );
  }

  if (!remoteBrowserStore.canBrowse) {
    return (
      <div className={styles.placeholder}>
        {t('files.notConnected')}
      </div>
    );
  }

  return (
    <div className={styles.workspace}>
      <FileTransferToolbar />
      <div className={styles.panes} ref={panesRef}>
        <div className={styles.localPane} style={{ width: `${localPercent}%` }}>
          <FilePane
            side="local"
            store={localBrowserStore}
            dropActive={dropTarget === 'local'}
            onFocus={() => {
              localBrowserStore.setFocused(true);
              remoteBrowserStore.setFocused(false);
            }}
            onDrop={handleDropOnLocal}
            onDragOver={(e) => allowDrop(e, 'local')}
            onUpload={() => {
              if (!remoteBrowserStore.connectionId) return;
              const selected = localBrowserStore.selectedEntries;
              if (selected.length === 0) return;
              transferStore.enqueueUpload(
                selected.map((e) => e.path),
                remoteBrowserStore.cwd,
                remoteBrowserStore.connectionId,
              );
            }}
          />
        </div>
        <PaneResizeHandle
          containerRef={panesRef}
          onResize={setLocalPercent}
        />
        <div className={styles.remotePane}>
          <FilePane
            side="remote"
            store={remoteBrowserStore}
            dropActive={dropTarget === 'remote'}
            onFocus={() => {
              remoteBrowserStore.setFocused(true);
              localBrowserStore.setFocused(false);
            }}
            onDrop={handleDropOnRemote}
            onDragOver={(e) => allowDrop(e, 'remote')}
            onOpen={(entry) => void remoteBrowserStore.openEntry(entry)}
            onDownload={() => transferStore.downloadSelected()}
          />
        </div>
      </div>
      <TransferQueuePanel />
    </div>
  );
});
