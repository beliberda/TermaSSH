import type { DragEvent, MouseEvent } from "react";
import { useState } from "react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import type { SftpEntry } from "@/types";
import { useAppErrorMessage } from "@i18n/useAppErrorMessage";
import type { LocalBrowserStore } from "@stores/LocalBrowserStore";
import type { RemoteBrowserStore } from "@stores/RemoteBrowserStore";
import { FileBreadcrumbs } from "@components/fileTransfer/FileBreadcrumbs/FileBreadcrumbs";
import { FileTable } from "@components/fileTransfer/FileTable/FileTable";
import { FilePaneContextMenu } from "@components/fileTransfer/FilePaneContextMenu/FilePaneContextMenu";
import styles from "./FilePane.module.css";

type PaneStore = LocalBrowserStore | RemoteBrowserStore;

interface FilePaneProps {
  side: "local" | "remote";
  store: PaneStore;
  dropActive: boolean;
  onFocus: () => void;
  onDrop: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDragStart?: (side: "local" | "remote") => void;
  onDragEnd?: () => void;
  onUpload?: () => void;
  onDownload?: () => void;
  onOpen?: (entry: SftpEntry) => void;
  disconnected?: boolean;
  disconnectedMessage?: string;
  connecting?: boolean;
  connectingMessage?: string;
  showReconnect?: boolean;
  onReconnect?: () => void;
}

export const FilePane = observer(function FilePane({
  side,
  store,
  dropActive,
  onFocus,
  onDrop,
  onDragOver,
  onDragLeave,
  onDragStart,
  onDragEnd,
  onUpload,
  onDownload,
  onOpen,
  disconnected = false,
  disconnectedMessage,
  connecting = false,
  connectingMessage,
  showReconnect = false,
  onReconnect,
}: FilePaneProps) {
  const { t } = useTranslation();
  const errorMessage = useAppErrorMessage(store.error);
  const [contextMenu, setContextMenu] = useState<{
    entry: SftpEntry | null;
    x: number;
    y: number;
  } | null>(null);

  const paneLabel =
    side === "local"
      ? t("fileTransfer.localPane")
      : t("fileTransfer.remotePane");

  const handleContextMenu = (e: MouseEvent, entry: SftpEntry | null) => {
    e.preventDefault();
    setContextMenu({ entry, x: e.clientX, y: e.clientY });
  };

  const handleDragStart = (e: DragEvent, entry: SftpEntry) => {
    const selected = store.selectedEntries;
    const useMulti =
      selected.some((item) => item.path === entry.path) && selected.length > 1;
    const entries = useMulti ? selected : [entry];

    e.dataTransfer.setData(
      "application/termassh-files",
      JSON.stringify({
        side,
        paths: entries.map((item) => item.path),
        names: entries.map((item) => item.name),
        isDirectories: entries.map((item) => item.isDirectory),
        sizes: entries.map((item) => item.size),
        modifiedAts: entries.map((item) => item.modifiedAt ?? ""),
      }),
    );
    e.dataTransfer.setData("text/plain", side);
    e.dataTransfer.effectAllowed = "copy";
    e.stopPropagation();
    onDragStart?.(side);
  };

  const handleDragEnd = () => {
    onDragEnd?.();
  };

  const openInEditor = (entry: SftpEntry) => {
    if (side === "local") {
      void (store as LocalBrowserStore).openEntry(entry);
      return;
    }
    if (onOpen) {
      void onOpen(entry);
      return;
    }
    void (store as RemoteBrowserStore).openEntry(entry);
  };

  const handleOpen = (entry: SftpEntry) => {
    if (entry.isDirectory) {
      store.navigateTo(entry.path);
      return;
    }
    openInEditor(entry);
  };

  const showOverlay = disconnected || connecting;
  const overlayMessage = connecting
    ? connectingMessage
    : disconnectedMessage;

  return (
    <div className={styles.pane}>
      <div className={styles.paneBody}>
        <div className={styles.paneTitle}>{paneLabel}</div>
        <FileBreadcrumbs
          crumbs={store.breadcrumbs}
          currentPath={store.cwd}
          onNavigate={(path) => store.navigateTo(path)}
          onCopyPath={(path) => void store.copyPath(path)}
        />
        {errorMessage && (
          <div className={styles.errorBanner} role="alert">
            <span className={styles.errorText}>{errorMessage}</span>
            <button
              type="button"
              className={styles.errorDismiss}
              onClick={() => {
                store.error = null;
              }}
              aria-label={t("common.close")}
            >
              ×
            </button>
          </div>
        )}
        <FileTable
          entries={store.entries}
          cwd={store.cwd}
          selectedPaths={store.selectedPaths}
          renameTargetPath={store.renameTargetPath}
          renameDraft={store.renameDraft}
          isLoading={store.isLoading}
          focused={store.focused}
          paneLabel={paneLabel}
          onSelect={(entry, opts) => store.selectEntry(entry, opts)}
          onSelectPaths={(paths, mode) => store.selectPaths(paths, mode)}
          onClearSelection={() => store.clearSelection()}
          onNavigateUp={() => store.navigateUp()}
          onOpen={handleOpen}
          onContextMenu={handleContextMenu}
          onRenameDraftChange={(v) => {
            store.renameDraft = v;
          }}
          onCommitRename={() => void store.commitRename()}
          onCancelRename={() => store.cancelRename()}
          onFocus={onFocus}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          dropActive={dropActive}
        />
      </div>
      {showOverlay && overlayMessage && (
        <div className={styles.paneOverlay}>
          <span>{overlayMessage}</span>
          {disconnected && showReconnect && onReconnect && (
            <>
              <button
                type="button"
                className={styles.reconnectBtn}
                onClick={() => onReconnect()}
              >
                {t("terminal.workspace.reconnect")}
              </button>
              <span className={styles.reconnectHint}>
                {t("terminal.workspace.reconnectShortcut")}
              </span>
            </>
          )}
        </div>
      )}
      {contextMenu && (
        <FilePaneContextMenu
          side={side}
          entry={contextMenu.entry}
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onRefresh={() => store.refresh()}
          onMkdir={() => {
            const name = window.prompt(t("files.mkdir.prompt"));
            if (name) void store.mkdir(name);
          }}
          onUpload={onUpload}
          onDownload={onDownload}
          onOpenInEditor={openInEditor}
          onRevealInExplorer={
            side === "local"
              ? (entry) =>
                  void (store as LocalBrowserStore).revealInExplorer(entry)
              : undefined
          }
          onRename={(entry) => store.startRename(entry)}
          onDelete={(entry) => void store.deleteEntry(entry)}
          onCopyPath={(path) => void store.copyPath(path)}
        />
      )}
    </div>
  );
});
