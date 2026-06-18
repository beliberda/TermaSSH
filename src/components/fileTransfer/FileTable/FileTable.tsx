import type { DragEvent, MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SftpEntry } from "@/types";
import styles from "./FileTable.module.css";

export type FileSortKey = "name" | "size" | "modifiedAt";
export type FileSortDir = "asc" | "desc";

const MARQUEE_THRESHOLD_PX = 4;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

interface MarqueeRect {
  startX: number;
  startY: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FileTableProps {
  entries: SftpEntry[];
  cwd: string;
  selectedPaths: Set<string>;
  renameTargetPath: string | null;
  renameDraft: string;
  isLoading: boolean;
  focused: boolean;
  paneLabel: string;
  onSelect: (
    entry: SftpEntry,
    opts?: { additive?: boolean; range?: boolean; sortedPaths?: string[] },
  ) => void;
  onSelectPaths?: (paths: string[], mode: "replace" | "add") => void;
  onClearSelection?: () => void;
  onNavigateUp: () => void;
  onOpen: (entry: SftpEntry) => void;
  onContextMenu: (e: MouseEvent, entry: SftpEntry | null) => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onFocus: () => void;
  onDrop?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDragStart?: (e: DragEvent, entry: SftpEntry) => void;
  onDragEnd?: () => void;
  dropActive?: boolean;
}

export function FileTable({
  entries,
  cwd,
  selectedPaths,
  renameTargetPath,
  renameDraft,
  isLoading,
  focused,
  paneLabel,
  onSelect,
  onSelectPaths,
  onClearSelection,
  onNavigateUp,
  onOpen,
  onContextMenu,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onFocus,
  onDrop,
  onDragOver,
  onDragLeave,
  onDragStart,
  onDragEnd,
  dropActive,
}: FileTableProps) {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = useState<FileSortKey>("name");
  const [sortDir, setSortDir] = useState<FileSortDir>("asc");
  const bodyRef = useRef<HTMLDivElement>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);

  const sorted = useMemo(() => {
    const list = [...entries];
    list.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      let cmp = 0;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      } else if (sortKey === "size") {
        cmp = a.size - b.size;
      } else {
        const at = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
        const bt = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
        cmp = at - bt;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [entries, sortKey, sortDir]);

  const sortedPaths = useMemo(
    () => sorted.map((entry) => entry.path),
    [sorted],
  );

  useEffect(() => {
    if (!marquee) return;

    const onMove = (e: globalThis.MouseEvent) => {
      const start = marqueeStartRef.current;
      if (!start) return;

      const x = Math.min(start.x, e.clientX);
      const y = Math.min(start.y, e.clientY);
      const w = Math.abs(e.clientX - start.x);
      const h = Math.abs(e.clientY - start.y);
      setMarquee({ startX: start.x, startY: start.y, x, y, w, h });
    };

    const onUp = (e: globalThis.MouseEvent) => {
      const start = marqueeStartRef.current;
      marqueeStartRef.current = null;
      setMarquee(null);

      if (!start) return;

      const dx = Math.abs(e.clientX - start.x);
      const dy = Math.abs(e.clientY - start.y);

      if (dx <= MARQUEE_THRESHOLD_PX && dy <= MARQUEE_THRESHOLD_PX) {
        onClearSelection?.();
        return;
      }

      if (!bodyRef.current || !onSelectPaths) return;

      const selectionRect = {
        left: Math.min(start.x, e.clientX),
        top: Math.min(start.y, e.clientY),
        right: Math.max(start.x, e.clientX),
        bottom: Math.max(start.y, e.clientY),
      };

      const paths: string[] = [];
      const rows = bodyRef.current.querySelectorAll("[data-entry-path]");
      rows.forEach((row) => {
        const bounds = row.getBoundingClientRect();
        const intersects =
          bounds.right >= selectionRect.left &&
          bounds.left <= selectionRect.right &&
          bounds.bottom >= selectionRect.top &&
          bounds.top <= selectionRect.bottom;
        if (intersects) {
          const path = row.getAttribute("data-entry-path");
          if (path) paths.push(path);
        }
      });

      const mode = e.ctrlKey || e.metaKey ? "add" : "replace";
      onSelectPaths(paths, mode);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [marquee, onClearSelection, onSelectPaths]);

  const toggleSort = (key: FileSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleBodyMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(`.${styles.row}`)) return;
    if (target.closest("input")) return;

    marqueeStartRef.current = { x: e.clientX, y: e.clientY };
    setMarquee({
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      w: 0,
      h: 0,
    });
  };

  const showParent = cwd && cwd !== "/" && !/^[A-Za-z]:\\?$/.test(cwd);

  return (
    <div
      className={`${styles.tableWrap} ${focused ? styles.focused : ""} ${dropActive ? styles.dropActive : ""}`}
      onFocus={onFocus}
      tabIndex={0}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onContextMenu={(e) => onContextMenu(e, null)}
    >
      <div className={styles.header}>
        <span className={styles.paneLabel}>{paneLabel}</span>
        <button
          type="button"
          className={`${styles.col} ${styles.colName}`}
          onClick={() => toggleSort("name")}
        >
          {t("fileTransfer.columns.name")}
          {sortKey === "name" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
        </button>
        <button
          type="button"
          className={`${styles.col} ${styles.colSize}`}
          onClick={() => toggleSort("size")}
        >
          {t("fileTransfer.columns.size")}
          {sortKey === "size" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
        </button>
        <button
          type="button"
          className={`${styles.col} ${styles.colDate}`}
          onClick={() => toggleSort("modifiedAt")}
        >
          {t("fileTransfer.columns.modified")}
          {sortKey === "modifiedAt" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
        </button>
      </div>
      <div
        ref={bodyRef}
        className={styles.body}
        onMouseDown={handleBodyMouseDown}
        onDragOver={(e) => e.preventDefault()}
      >
        {isLoading && entries.length === 0 && (
          <p className={styles.status}>{t("files.list.loading")}</p>
        )}
        {!isLoading && entries.length === 0 && !showParent && (
          <p className={styles.status}>{t("files.list.empty")}</p>
        )}
        {showParent && (
          <div
            role="button"
            tabIndex={0}
            className={styles.row}
            onClick={(e) => {
              e.stopPropagation();
              onNavigateUp();
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onNavigateUp();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onNavigateUp();
              }
            }}
          >
            <span className={`${styles.icon} ${styles.dir}`}>📁</span>
            <span className={styles.name}>..</span>
            <span className={styles.size}>—</span>
            <span className={styles.date}>—</span>
          </div>
        )}
        {sorted.map((entry) => {
          const selected = selectedPaths.has(entry.path);
          return (
            <div
              key={entry.path}
              role="button"
              tabIndex={0}
              data-entry-path={entry.path}
              className={`${styles.row} ${selected ? styles.selected : ""}`}
              draggable
              onDragStart={(e) => onDragStart?.(e, entry)}
              onDragEnd={() => onDragEnd?.()}
              onClick={(e) =>
                onSelect(entry, {
                  additive: e.ctrlKey || e.metaKey,
                  range: e.shiftKey,
                  sortedPaths,
                })
              }
              onDoubleClick={() => onOpen(entry)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(entry);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelect(entry, { sortedPaths });
                onContextMenu(e, entry);
              }}
              onDragOver={(e) => e.preventDefault()}
            >
              <span
                className={`${styles.icon} ${entry.isDirectory ? styles.dir : styles.file}`}
              >
                {entry.isDirectory ? "📁" : "📄"}
              </span>
              {renameTargetPath === entry.path ? (
                <input
                  type="text"
                  className={styles.renameInput}
                  value={renameDraft}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => onRenameDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onCommitRename();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      onCancelRename();
                    }
                  }}
                  onBlur={onCancelRename}
                />
              ) : (
                <span className={styles.name} title={entry.name}>
                  {entry.name}
                </span>
              )}
              <span className={styles.size}>
                {entry.isDirectory ? "—" : formatSize(entry.size)}
              </span>
              <span className={styles.date}>
                {formatDate(entry.modifiedAt)}
              </span>
            </div>
          );
        })}
        {marquee && marquee.w > 0 && marquee.h > 0 && (
          <div
            className={styles.marquee}
            style={{
              left: marquee.x,
              top: marquee.y,
              width: marquee.w,
              height: marquee.h,
            }}
          />
        )}
      </div>
    </div>
  );
}
