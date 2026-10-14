import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FolderSearch } from 'lucide-react';

export interface FolderMenuPosition {
  repositoryId: string;
  x: number;
  y: number;
  trigger: HTMLButtonElement;
}
export function FolderContextMenu({
  position,
  onClose,
  onScan,
}: {
  position: FolderMenuPosition;
  onClose: () => void;
  onScan: (repositoryId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const dismiss = () => onClose();
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Ordneraktionen"
      className="folder-context-menu"
      style={{
        left: Math.max(8, Math.min(position.x, window.innerWidth - 298)),
        top: Math.max(8, Math.min(position.y, window.innerHeight - 54)),
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') event.preventDefault();
          position.trigger.focus();
          onClose();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') event.preventDefault();
      }}
    >
      <button
        role="menuitem"
        onClick={() => {
          position.trigger.focus();
          onClose();
          onScan(position.repositoryId);
        }}
      >
        <FolderSearch size={16} />
        Auf weitere Repositories prüfen
      </button>
    </div>,
    document.body,
  );
}
