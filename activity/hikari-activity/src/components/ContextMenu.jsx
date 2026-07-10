import { useEffect, useRef, useState } from 'react';

export default function ContextMenu({ x, y, options, onClose }) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = x;
      let newY = y;

      // Prevent the menu from clipping off the right edge
      if (x + rect.width > viewportWidth) {
        newX = viewportWidth - rect.width - 10;
      }
      // Prevent the menu from clipping off the bottom edge
      if (y + rect.height > viewportHeight) {
        newY = viewportHeight - rect.height - 10;
      }

      setPosition({ x: newX, y: newY });
    }
  }, [x, y]);

  return (
    <>
      {/* Invisible overlay to catch clicks outside the menu */}
      <div 
        className="context-menu-overlay" 
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      
      {/* The actual menu */}
      <div 
        ref={menuRef}
        className="context-menu" 
        style={{ top: position.y, left: position.x }}
      >
        {options.map((opt, i) => (
          <button 
            key={i} 
            className={`context-menu-item ${opt.danger ? 'danger' : ''}`}
            onClick={() => {
              opt.onClick();
              onClose();
            }}
          >
            {opt.icon && <span className="context-menu-icon">{opt.icon}</span>}
            {opt.label}
          </button>
        ))}
      </div>
    </>
  );
}