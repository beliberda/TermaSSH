import { useMemo, useRef, useState } from "react";

import type { DragEndEvent } from "@dnd-kit/core";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import { observer } from "mobx-react-lite";

import { useTranslation } from "react-i18next";

import { useAppErrorMessage } from "@i18n/useAppErrorMessage";

import type { SessionConfig, SessionFolder } from "@/types";

import { useStores } from "@stores/index";

import { connectSession } from "@utils/connectSession";

import { canMoveIntoFolder, isFolderId } from "@utils/sessionTree";

import { SessionContextMenu } from "./SessionContextMenu";

import { FolderContextMenu } from "./FolderContextMenu";

import { SessionTreeList } from "./SessionTreeList";

import { RootDropZone } from "./RootDropZone";

import {
  createSessionListCollisionDetection,
  DROP_TO_ROOT_ID,
  parseFolderDroppableId,
} from "./sessionListCollisionDetection";

import styles from "./SessionList.module.css";

interface SessionContextMenuState {
  session: SessionConfig;

  x: number;

  y: number;
}

interface FolderContextMenuState {
  folder: SessionFolder;

  x: number;

  y: number;
}

export const SessionList = observer(function SessionList() {
  const { t } = useTranslation();

  const stores = useStores();

  const { sessionStore } = stores;

  const errorMessage = useAppErrorMessage(sessionStore.error);

  const [sessionMenu, setSessionMenu] =
    useState<SessionContextMenuState | null>(null);

  const [folderMenu, setFolderMenu] = useState<FolderContextMenuState | null>(
    null,
  );

  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const activeParentRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const collisionDetection = useMemo(
    () => createSessionListCollisionDetection(() => activeParentRef.current),

    [],
  );

  const moveIntoFolder = (activeId: string, folderId: string) => {
    const file = sessionStore.toFile();

    if (!canMoveIntoFolder(file, activeId, folderId)) {
      return;
    }

    const folder = sessionStore.getFolderById(folderId);

    if (!folder) return;

    sessionStore.moveItem(activeId, folderId, folder.childOrder.length);
  };

  const moveOutOfFolder = (activeId: string, currentParentId: string) => {
    const grandParentId = sessionStore.getParentId(currentParentId);

    const parentOrder =
      grandParentId === null
        ? sessionStore.rootOrder
        : (sessionStore.getFolderById(grandParentId)?.childOrder ?? []);

    const folderIndex = parentOrder.indexOf(currentParentId);

    if (folderIndex < 0) return;

    sessionStore.moveItem(activeId, grandParentId, folderIndex + 1);
  };

  const moveToRoot = (activeId: string) => {
    sessionStore.moveItem(activeId, null, sessionStore.rootOrder.length);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    setActiveDragId(null);

    activeParentRef.current = null;

    if (!over) return;

    const activeId = String(active.id);

    const overId = String(over.id);

    if (activeId === overId) return;

    const activeParent = sessionStore.getParentId(activeId);

    if (overId === "droppable-root" || overId === DROP_TO_ROOT_ID) {
      moveToRoot(activeId);

      return;
    }

    const folderFromDroppable = parseFolderDroppableId(overId);

    if (folderFromDroppable) {
      if (folderFromDroppable === activeParent) {
        return;
      }

      moveIntoFolder(activeId, folderFromDroppable);

      return;
    }

    if (overId.startsWith("droppable-")) {
      return;
    }

    if (sessionStore.getFolderById(overId)) {
      if (overId === activeParent) {
        moveOutOfFolder(activeId, activeParent);

        return;
      }

      moveIntoFolder(activeId, overId);

      return;
    }

    const overParent = sessionStore.getParentId(overId);

    if (overParent === activeParent) {
      sessionStore.reorderInParent(activeParent, activeId, overId);

      return;
    }

    const parentOrder =
      overParent === null
        ? sessionStore.rootOrder
        : (sessionStore.getFolderById(overParent)?.childOrder ?? []);

    const overIndex = parentOrder.indexOf(overId);

    if (overIndex < 0) return;

    if (
      isFolderId(sessionStore.toFile(), activeId) &&
      overParent &&
      !sessionStore.getFolderById(overParent)
    ) {
      return;
    }

    sessionStore.moveItem(activeId, overParent, overIndex);
  };

  const getSessionFromEvent = (target: EventTarget | null) => {
    const row = (target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-session-id]",
    );

    if (!row) return null;

    const sessionId = row.dataset.sessionId;

    if (!sessionId) return null;

    return sessionStore.getSessionById(sessionId) ?? null;
  };

  if (sessionStore.isLoading) {
    return (
      <div className={styles.stateMessage}>{t("sidebar.sessions.loading")}</div>
    );
  }

  if (!sessionStore.hasItems) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>{t("sidebar.sessions.noSessions")}</p>

        <p className={styles.emptyHint}>{t("sidebar.sessions.createHint")}</p>
      </div>
    );
  }

  const activeSession = activeDragId
    ? sessionStore.getSessionById(activeDragId)
    : null;

  const activeFolder = activeDragId
    ? sessionStore.getFolderById(activeDragId)
    : null;

  const isDraggingFromFolder =
    activeDragId !== null && sessionStore.getParentId(activeDragId) !== null;

  return (
    <div className={styles.container}>
      {errorMessage && <div className={styles.error}>{errorMessage}</div>}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={(event) => {
          const id = String(event.active.id);

          setActiveDragId(id);

          activeParentRef.current = sessionStore.getParentId(id);
        }}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveDragId(null);

          activeParentRef.current = null;
        }}
      >
        <div
          className={styles.treeScroll}
          onClick={(e) => {
            const session = getSessionFromEvent(e.target);

            if (session) sessionStore.selectSession(session.id);
          }}
          onDoubleClick={(e) => {
            const session = getSessionFromEvent(e.target);

            if (session) connectSession(session, stores);
          }}
        >
          {isDraggingFromFolder && <RootDropZone />}

          <SessionTreeList
            parentId={null}
            onSessionContextMenu={(e, session) => {
              e.preventDefault();

              setSessionMenu({
                session,

                x: e.clientX,

                y: e.clientY,
              });
            }}
            onFolderContextMenu={(e, folder) => {
              e.preventDefault();

              setFolderMenu({
                folder,

                x: e.clientX,

                y: e.clientY,
              });
            }}
          />
        </div>

        <DragOverlay>
          {activeSession && (
            <div className={styles.dragOverlay}>{activeSession.name}</div>
          )}

          {activeFolder && (
            <div className={styles.dragOverlay}>📁 {activeFolder.name}</div>
          )}
        </DragOverlay>
      </DndContext>

      {sessionMenu && (
        <SessionContextMenu
          session={sessionMenu.session}
          anchor={{ x: sessionMenu.x, y: sessionMenu.y }}
          onClose={() => setSessionMenu(null)}
        />
      )}

      {folderMenu && (
        <FolderContextMenu
          folder={folderMenu.folder}
          anchor={{ x: folderMenu.x, y: folderMenu.y }}
          onClose={() => setFolderMenu(null)}
        />
      )}
    </div>
  );
});
