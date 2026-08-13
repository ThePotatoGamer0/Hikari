import React from 'react';

export default function ConfirmModal({ isOpen, onClose, onConfirm, title, message }) {
  if (!isOpen) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={contentStyle} onClick={e => e.stopPropagation()}>
        <h3 style={titleStyle}>{title}</h3>
        <p style={messageStyle}>{message}</p>
        <div style={buttonContainerStyle}>
          <button onClick={onClose} style={cancelButtonStyle}>Cancel</button>
          <button onClick={() => { onConfirm(); onClose(); }} style={confirmButtonStyle}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.75)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
  backdropFilter: 'blur(2px)'
};

const contentStyle = {
  backgroundColor: '#313338',
  borderRadius: '8px',
  padding: '1.5rem',
  width: '90%',
  maxWidth: '400px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  border: '1px solid #1e1f22'
};

const titleStyle = {
  margin: '0 0 0.5rem 0',
  color: '#f2f3f5',
  fontSize: '1.2rem'
};

const messageStyle = {
  margin: '0 0 1.5rem 0',
  color: '#dbdee1',
  fontSize: '0.95rem',
  lineHeight: '1.4'
};

const buttonContainerStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.75rem'
};

const cancelButtonStyle = {
  backgroundColor: 'transparent',
  color: '#dbdee1',
  border: 'none',
  padding: '0.5rem 1rem',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: 'bold'
};

const confirmButtonStyle = {
  backgroundColor: '#da373c',
  color: '#fff',
  border: 'none',
  padding: '0.5rem 1rem',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: 'bold'
};