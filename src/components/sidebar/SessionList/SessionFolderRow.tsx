import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { observer } from "mobx-react-lite";
import type { SessionConfig, SessionFolder } from "@/types";
import { useStores } from "@stores/index";
import { SessionTreeList } from "./SessionTreeList";
import styles from "./SessionList.module.css";
import { IconFolder } from "@/assets/icons/iconFolder";

const TOGGLE_DELAY_MS = 250;

interface SessionFolderRowProps {
  folder: SessionFolder;
  depth: number;
  onSessionContextMenu: (e: MouseEvent, session: SessionConfig) => void;
  onFolderContextMenu: (e: MouseEvent, folder: SessionFolder) => void;
}

export const SessionFolderRow = observer(function SessionFolderRow({
  folder,
  depth,
  onSessionContextMenu,
  onFolderContextMenu,
}: SessionFolderRowProps) {
  const { sessionStore } = useStores();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const toggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: folder.id });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `droppable-folder-${folder.id}`,
  });

  useEffect(() => {
    return () => {
      if (toggleTimerRef.current) {
        clearTimeout(toggleTimerRef.current);
      }
    };
  }, []);

  const cancelToggleTimer = () => {
    if (toggleTimerRef.current) {
      clearTimeout(toggleTimerRef.current);
      toggleTimerRef.current = null;
    }
  };

  const handleRowClick = () => {
    if (isRenaming || isDragging) return;

    cancelToggleTimer();
    toggleTimerRef.current = setTimeout(() => {
      sessionStore.toggleFolderCollapsed(folder.id);
      toggleTimerRef.current = null;
    }, TOGGLE_DELAY_MS);
  };

  const startRename = () => {
    cancelToggleTimer();
    setRenameDraft(folder.name);
    setIsRenaming(true);
  };

  const commitRename = () => {
    const trimmed = renameDraft.trim();
    if (trimmed) {
      sessionStore.renameFolder(folder.id, trimmed);
    }
    setIsRenaming(false);
    setRenameDraft("");
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setRenameDraft("");
  };

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className={styles.folderBlock}>
      <div
        ref={setDropRef}
        className={`${styles.folderRow} ${isOver ? styles.folderRowOver : ""}`}
        style={{ paddingLeft: 12 + depth * 20 }}
        onClick={handleRowClick}
        onContextMenu={(e) => onFolderContextMenu(e, folder)}
        {...attributes}
        {...listeners}
      >
        <span className={styles.collapseBtn} aria-hidden="true">
          {folder.collapsed ? "▸" : "▾"}
        </span>
        <span className={styles.folderIcon}>
          <IconFolder width={15} height={15} />
        </span>
        {isRenaming ? (
          <input
            type="text"
            className={styles.renameInput}
            value={renameDraft}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              setRenameDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={commitRename}
          />
        ) : (
          <span
            className={styles.folderName}
            onDoubleClick={(e) => {
              e.stopPropagation();
              startRename();
            }}
          >
            {folder.name}
          </span>
        )}
      </div>
      {!folder.collapsed && (
        <SessionTreeList
          parentId={folder.id}
          depth={depth + 1}
          onSessionContextMenu={onSessionContextMenu}
          onFolderContextMenu={onFolderContextMenu}
        />
      )}
    </li>
  );
});
