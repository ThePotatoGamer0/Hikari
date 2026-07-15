import Icons from './Icons';

export default function AboutModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div 
      className="modal-overlay" 
      onClick={onClose} 
      style={{ 
        position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', 
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)'
      }}
    >
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()} 
        style={{ 
          background: '#2b2d31', padding: '1.5rem', borderRadius: '12px', 
          width: '90%', maxWidth: '420px', color: '#f2f3f5', position: 'relative',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.05)'
        }}
      >
        <button 
          onClick={onClose} 
          style={{ position: 'absolute', top: '1.2rem', right: '1.2rem', background: 'none', border: 'none', color: '#b5bac1', cursor: 'pointer', padding: '0' }}
        >
          {Icons.Close}
        </button>
        
        <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {Icons.Info} About Hikari
        </h2>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', fontSize: '0.95rem', color: '#dbdee1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span><strong>Version:</strong></span>
            <span>2.5.0</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span><strong>Author:</strong></span>
            <span>ThePotatoGamer</span>
          </div>
          
          <div style={{ marginTop: '0.5rem' }}>
            <strong>Built with:</strong>
            <div style={{ display: 'flex', gap: '1.2rem', marginTop: '0.8rem', alignItems: 'center' }}>
              <div title="React" style={{ cursor: 'help', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.2s' }} onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.15)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
                {Icons.ReactLogo}
              </div>
              <div title="Vite" style={{ cursor: 'help', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.2s' }} onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.15)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
                {Icons.ViteLogo}
              </div>
              <div title="Python" style={{ cursor: 'help', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.2s' }} onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.15)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
                {Icons.PythonLogo}
              </div>
              <div title="Wavelink / Lavalink" style={{ cursor: 'help', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.2s' }} onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.15)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
                <img src="/lavalink.svg" alt="Lavalink" style={{ width: '26px', height: '26px' }} />
              </div>
              <div title="MariaDB" style={{ cursor: 'help', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.2s' }} onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.15)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
                {Icons.MariaDBLogo}
              </div>
            </div>
          </div>

          <div style={{ marginTop: '0.5rem' }}>
            <strong>GitHub:</strong>
            <br/>
            <a 
              href="https://github.com/thepotatogamer0/" 
              target="_blank" 
              rel="noopener noreferrer" 
              style={{ color: '#00a8fc', textDecoration: 'none', display: 'inline-block', marginTop: '0.2rem' }}
            >
              github.com/thepotatogamer0
            </a>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0.8rem 0' }} />
          
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#80848e', lineHeight: '1.4' }}>
            <em>Disclaimer:</em> This project is an independent creation. It is not affiliated with, endorsed by, or sponsored by Discord, YouTube, SoundCloud, Spotify, or Google. All trademarks are the property of their respective owners.
          </p>
        </div>
      </div>
    </div>
  );
}