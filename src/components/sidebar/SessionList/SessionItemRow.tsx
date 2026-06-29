import type { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import type { SessionConfig } from "@/types";
import { useStores } from "@stores/index";
import styles from "./SessionList.module.css";

interface SessionItemRowProps {
  session: SessionConfig;
  depth: number;
  onContextMenu: (e: React.MouseEvent, session: SessionConfig) => void;
}

export const SessionItemRow = observer(function SessionItemRow({
  session,
  depth,
  onContextMenu,
}: SessionItemRowProps) {
  const { t } = useTranslation();
  const { sessionStore } = useStores();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    paddingLeft: 20 + depth * 20,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-session-id={session.id}
      className={`${styles.item} ${sessionStore.selectedId === session.id ? styles.itemSelected : ""}`}
      onContextMenu={(e) => onContextMenu(e, session)}
      {...attributes}
      {...listeners}
    >
      <div className={styles.info}>
        <div className={styles.name}>{session.name}</div>
        <div className={styles.host}>
          {session.username}@{session.host}:{session.port}
        </div>
      </div>
      <span className={styles.badge}>{session.protocol}</span>
      <button
        type="button"
        className={styles.editBtn}
        title={t("sidebar.sessions.edit")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          sessionStore.openEditForm(session.id);
        }}
      >
        ✎
      </button>
      <button
        type="button"
        className={styles.deleteBtn}
        title={t("common.delete")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (
            window.confirm(
              t("sidebar.sessions.deleteConfirm", { name: session.name }),
            )
          ) {
            void sessionStore.deleteSession(session.id);
          }
        }}
      >
        ×
      </button>
    </li>
  );
});
