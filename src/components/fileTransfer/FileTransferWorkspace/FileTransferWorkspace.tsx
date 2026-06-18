import type { DragEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { notify } from '@/notify';
import { useStores } from '@stores/index';
import { FileTransferToolbar } from '@components/fileTransfer/FileTransferToolbar/FileTransferToolbar';
import { FilePane } from '@components/fileTransfer/FilePane/FilePane';
import { PaneResizeHandle } from '@components/fileTransfer/PaneResizeHandle/PaneResizeHandle';
import { TransferQueuePanel } from '@components/fileTransfer/TransferQueuePanel/TransferQueuePanel';
import styles from './FileTransferWorkspace.module.css';

const DRAG_MIME = 'application/termassh-files';

interface DragPayload {
  side: 'local' | 'remote';
  paths: string[];
  names: string[];
  isDirectories: boolean[];
  sizes: number[];
  modifiedAts: string[];
}

function parseDragData(e: DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

function payloadToEntries(data: DragPayload) {
  return data.paths.map((path, i) => ({
    path,
    name: data.names[i],
    isDirectory: data.isDirectories[i],
    size: data.sizes[i] ?? 0,
    modifiedAt: data.modifiedAts[i] || undefined,
  }));
}

export const FileTransferWorkspace = observer(function FileTransferWorkspace() {
  const { t } = useTranslation();
  const {
    localBrowserStore,
    remoteBrowserStore,
    transferStore,
    sessionStore,
    terminalStore,
    fileConnectionStore,
    workspaceStore,
  } = useStores();
  const panesRef = useRef<HTMLDivElement>(null);
  const dragSourceSide = useRef<'local' | 'remote' | null>(null);
  const [localPercent, setLocalPercent] = useState(50);
  const [dropTarget, setDropTarget] = useState<'local' | 'remote' | null>(null);

  useEffect(() => {
    if (!localBrowserStore.cwd) {
      void localBrowserStore.init();
    }
  }, [localBrowserStore]);

  const session = remoteBrowserStore.sessionId
    ? sessionStore.sessions.find((s) => s.id === remoteBrowserStore.sessionId)
    : null;

  const isFtpMode = workspaceStore.active?.kind === 'ftp';
  const activeTerminalTab = terminalStore.activeTab;
  const activeFtpTab = fileConnectionStore.activeTab;

  const remoteConnecting =
    remoteBrowserStore.connectionStatus === 'connecting' ||
    activeTerminalTab?.reconnecting === true ||
    activeFtpTab?.reconnecting === true;

  const remoteDisconnected =
    !remoteBrowserStore.canBrowse && !remoteConnecting;

  const canReconnect =
    (isFtpMode &&
      activeFtpTab !== null &&
      fileConnectionStore.canReconnect(activeFtpTab)) ||
    (!isFtpMode &&
      activeTerminalTab !== null &&
      terminalStore.canReconnect(activeTerminalTab));

  const handleReconnect = () => {
    if (isFtpMode && activeFtpTab) {
      void fileConnectionStore.reconnectTab(activeFtpTab.id);
      return;
    }
    if (activeTerminalTab) {
      void terminalStore.reconnectTab(activeTerminalTab.id);
    }
  };

  const disconnectedMessage =
    remoteBrowserStore.connectionStatus === 'error'
      ? t('terminal.workspace.connectFailed')
      : t('terminal.workspace.disconnected');

  const handleDragStart = (side: 'local' | 'remote') => {
    dragSourceSide.current = side;
  };

  const handleDragEnd = () => {
    dragSourceSide.current = null;
    setDropTarget(null);
  };

  const isValidDropTarget = (target: 'local' | 'remote') => {
    const expectedSource = target === 'remote' ? 'local' : 'remote';
    return dragSourceSide.current === expectedSource;
  };

  const allowDrop = (e: DragEvent, target: 'local' | 'remote') => {
    if (!dragSourceSide.current) return;
    if (!isValidDropTarget(target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropTarget(target);
  };

  const handleDragLeave = (e: DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDropTarget(null);
  };

  const handleDropOnRemote = (e: DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    const data = parseDragData(e);
    if (!data || data.side !== 'local') {
      if (data?.side === 'remote') {
        notify.info(t('fileTransfer.drop.sameSide'));
      }
      return;
    }
    if (!remoteBrowserStore.connectionId) {
      notify.warning(t('fileTransfer.drop.notConnected'));
      return;
    }
    void transferStore.enqueueUpload(
      payloadToEntries(data),
      remoteBrowserStore.cwd,
      remoteBrowserStore.connectionId,
    );
  };

  const handleDropOnLocal = (e: DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    const data = parseDragData(e);
    if (!data || data.side !== 'remote') {
      if (data?.side === 'local') {
        notify.info(t('fileTransfer.drop.sameSide'));
      }
      return;
    }
    if (!remoteBrowserStore.connectionId) {
      notify.warning(t('fileTransfer.drop.notConnected'));
      return;
    }
    void transferStore.enqueueDownload(
      payloadToEntries(data),
      localBrowserStore.cwd,
      remoteBrowserStore.connectionId,
      session,
    );
  };

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
            onDragLeave={handleDragLeave}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onUpload={() => {
              if (!remoteBrowserStore.connectionId) return;
              const selected = localBrowserStore.selectedEntries;
              if (selected.length === 0) return;
              void transferStore.enqueueUpload(
                selected.map((entry) => ({
                  path: entry.path,
                  name: entry.name,
                  isDirectory: entry.isDirectory,
                })),
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
            disconnected={remoteDisconnected}
            disconnectedMessage={disconnectedMessage}
            connecting={remoteConnecting}
            connectingMessage={t('files.connecting')}
            showReconnect={canReconnect}
            onReconnect={handleReconnect}
            onFocus={() => {
              remoteBrowserStore.setFocused(true);
              localBrowserStore.setFocused(false);
            }}
            onDrop={handleDropOnRemote}
            onDragOver={(e) => allowDrop(e, 'remote')}
            onDragLeave={handleDragLeave}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onOpen={(entry) => void remoteBrowserStore.openEntry(entry)}
            onDownload={() => transferStore.downloadSelected()}
          />
        </div>
      </div>
      <TransferQueuePanel />
    </div>
  );
});
