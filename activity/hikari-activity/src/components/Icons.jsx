import { 
  Music, 
  Shuffle, 
  Square, 
  SkipForward, 
  Repeat, 
  Repeat1, 
  Infinity as InfinityIcon, 
  Plus, 
  Trash2, 
  X,
  Play,
  Pause,
  MoreHorizontal,
  Info,
  Heart,
  Waves // Using Waves as a sleek stand-in for Wavelink/Lavalink
} from 'lucide-react';

import { 
  siYoutube, 
  siSoundcloud, 
  siReact, 
  siVite, 
  siPython, 
  siMariadb 
} from 'simple-icons';

// Helper component to render simple-icons as native React SVGs
const SimpleIcon = ({ icon, size = 14, color }) => (
  <svg 
    role="img" 
    viewBox="0 0 24 24" 
    width={size} 
    height={size} 
    fill={color || `#${icon.hex}`} 
    xmlns="http://www.w3.org/2000/svg"
  >
    <title>{icon.title}</title>
    <path d={icon.path} />
  </svg>
);

export default {
  MusicNote: <Music size={24} />,
  Shuffle: <Shuffle size={24} />,
  
  Stop: <Square size={24} fill="currentColor" />,
  Skip: <SkipForward size={24} fill="currentColor" />,
  Play: <Play size={24} fill="currentColor" />,
  Pause: <Pause size={24} fill="currentColor" />,
  
  Repeat: <Repeat size={24} />,
  RepeatOne: <Repeat1 size={24} />,
  Infinity: <InfinityIcon size={24} />,
  
  Plus: <Plus size={24} />,
  Trash: <Trash2 size={20} />,
  Close: <X size={24} />,
  More: <MoreHorizontal size={24} />,
  Info: <Info size={24} />,

  Heart: <Heart size={20} />,
  HeartFilled: <Heart size={20} fill="currentColor" />,
  
  // Brand Badges from simple-icons
  YouTube: <SimpleIcon icon={siYoutube} color="#ff0000" />,
  SoundCloud: <SimpleIcon icon={siSoundcloud} color="#ff5500" />,

  // Tech Stack Logos
  ReactLogo: <SimpleIcon icon={siReact} color="#61DAFB" size={26} />,
  ViteLogo: <SimpleIcon icon={siVite} color="#646CFF" size={26} />,
  PythonLogo: <SimpleIcon icon={siPython} color="#3776AB" size={26} />,
  MariaDBLogo: <SimpleIcon icon={siMariadb} color="#FFFFFF" size={26} />, // White outline for dark mode visibility
  LavalinkLogo: <Waves size={26} color="#7289da" /> // Lucide stand-in matching the "Wave" in Wavelink
};