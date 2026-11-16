import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { CSSProperties, ReactNode } from 'react';
import { t } from '../i18n/index.js';

/** Touch drags start after a short press so scrolling the form does not start a drag. */
export const TOUCH_ACTIVATION = { delay: 200, tolerance: 8 } as const;

/**
 * Vertical sortable list on dnd-kit (pointer, touch with delay, keyboard). It only reports
 * `onReorder(activeId, overId)`; the order model lives in the form model. Row menus stay the
 * accessible fallback for up/down.
 */
export function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: readonly string[];
  onReorder: (activeId: string, overId: string) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: TOUCH_ACTIVATION }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over !== null && active.id !== over.id) onReorder(String(active.id), String(over.id));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: t('dnd.instructions') },
        announcements: {
          onDragStart: () => t('dnd.start'),
          onDragOver: () => t('dnd.over'),
          onDragEnd: () => t('dnd.end'),
          onDragCancel: () => t('dnd.cancel'),
        },
      }}
    >
      <SortableContext items={[...ids]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** One sortable `<li>`; `children` receives the drag handle to place inside the row. */
export function SortableRow({
  id,
  className,
  testId,
  children,
}: {
  id: string;
  className?: string;
  testId?: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style: CSSProperties = {
    transform:
      transform === null
        ? undefined
        : `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`,
    transition,
    zIndex: isDragging ? 10 : undefined,
  };
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      aria-label={t('dnd.handle')}
      className="inline-flex min-h-11 min-w-11 touch-none items-center justify-center rounded-lg text-text-muted"
      {...attributes}
      {...listeners}
    >
      <span aria-hidden="true">&#8942;&#8942;</span>
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={className}
      {...(testId === undefined ? {} : { 'data-testid': testId })}
    >
      {children(handle)}
    </li>
  );
}
