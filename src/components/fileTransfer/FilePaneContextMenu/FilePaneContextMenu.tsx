import { useTranslation } from "react-i18next";
import type { SftpEntry } from "@/types";
import { AnchorPopup } from "@components/ui/AnchorPopup/AnchorPopup";
import menuStyles from "@components/ui/AnchorPopup/AnchorPopup.module.css";

export type FilePaneSide = "local" | "remote";

interface FilePaneContextMenuProps {
  side: FilePaneSide;
  entry: SftpEntry | null;
  anchor: { x: number; y: number };
  onClose: () => void;
  onRefresh: () => void;
  onMkdir: () => void;
  onUpload?: () => void;
  onDownload?: () => void;
  onOpenInEditor?: (entry: SftpEntry) => void;
  onRevealInExplorer?: (entry: SftpEntry) => void;
  onRename?: (entry: SftpEntry) => void;
  onDelete?: (entry: SftpEntry) => void;
  onCopyPath?: (path: string) => void;
}

export function FilePaneContextMenu({
  side,
  entry,
  anchor,
  onClose,
  onRefresh,
  onMkdir,
  onUpload,
  onDownload,
  onOpenInEditor,
  onRevealInExplorer,
  onRename,
  onDelete,
  onCopyPath,
}: FilePaneContextMenuProps) {
  const { t } = useTranslation();

  if (!entry) {
    return (
      <AnchorPopup anchor={anchor} onClose={onClose}>
        <button
          type="button"
          className={menuStyles.menuItem}
          onClick={() => {
            onRefresh();
            onClose();
          }}
        >
          {t("common.refresh")}
        </button>
        <button
          type="button"
          className={menuStyles.menuItem}
          onClick={() => {
            onMkdir();
            onClose();
          }}
        >
          {t("fileTransfer.context.newFolder")}
        </button>
      </AnchorPopup>
    );
  }

  return (
    <AnchorPopup anchor={anchor} onClose={onClose}>
      {onCopyPath && (
        <button
          type="button"
          className={menuStyles.menuItem}
          onClick={() => {
            void onCopyPath(entry.path);
            onClose();
          }}
        >
          {t("files.context.copyPath")}
        </button>
      )}
      {!entry.isDirectory && onOpenInEditor && (
        <button
          type="button"
          className={menuStyles.menuItem}
          onClick={() => {
            onOpenInEditor(entry);
            onClose();
          }}
        >
          {t("fileTransfer.context.openFile")}
        </button>
      )}
      {side === "local" && onRevealInExplorer && (
        <button
          type="button"
          className={menuStyles.menuItem}
          onClick={() => {
            onRevealInExplorer(entry);
            onClose();
          }}
        >
          {t("fileTransfer.context.showInExplorer")}
        </button>
      )}
      {side === "local" && onUpload && (
        <button
          type="button"
          className={menuStyles.menuItem}
          onClick={() => {
            onUpload();
            onClose();
          }}
        >
          {t("fileTransfer.context.uploadToServer")}
        </button>
      )}
      {side === "remote" && onDownload && (
        <button
          type="button"
          className={menuStyles.menuItem}
          onClick={() => {
            onDownload();
            onClose();
          }}
        >
          {t("files.context.download")}
        </button>
      )}
      {onRename && (
        <button
          type="button"
          className={menuStyles.menuItem}
          onClick={() => {
            onRename(entry);
            onClose();
          }}
        >
          {t("files.context.rename")}
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className={`${menuStyles.menuItem} ${menuStyles.menuItemDanger}`}
          onClick={() => {
            void onDelete(entry);
            onClose();
          }}
        >
          {t("common.delete")}
        </button>
      )}
    </AnchorPopup>
  );
}
