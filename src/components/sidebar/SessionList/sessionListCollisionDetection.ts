import type { CollisionDetection } from '@dnd-kit/core';
import { closestCenter, pointerWithin } from '@dnd-kit/core';

export const DROP_TO_ROOT_ID = 'droppable-extract-root';

export function createSessionListCollisionDetection(
  getActiveParentId: () => string | null,
): CollisionDetection {
  return (args) => {
    const activeParentId = getActiveParentId();
    const pointerHits = pointerWithin(args);

    if (activeParentId !== null) {
      const extractRootHit = pointerHits.find(
        (collision) => String(collision.id) === DROP_TO_ROOT_ID,
      );
      if (extractRootHit) {
        return [extractRootHit];
      }

      const rootHit = pointerHits.find(
        (collision) => String(collision.id) === 'droppable-root',
      );
      if (rootHit) {
        return [rootHit];
      }
    }

    const folderHits = pointerHits.filter((collision) => {
      const id = String(collision.id);
      if (!id.startsWith('droppable-folder-')) {
        return false;
      }
      const folderId = id.slice('droppable-folder-'.length);
      return folderId !== activeParentId;
    });

    if (folderHits.length > 0) {
      return folderHits;
    }

    return closestCenter(args).filter(
      (c) => !String(c.id).startsWith('droppable-'),
    );
  };
}

export function parseFolderDroppableId(id: string): string | null {
  if (!id.startsWith('droppable-folder-')) {
    return null;
  }
  return id.slice('droppable-folder-'.length);
}
