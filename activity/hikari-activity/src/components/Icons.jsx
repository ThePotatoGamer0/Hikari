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
  Youtube,
  Cloud
} from 'lucide-react';

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
  YouTube: <Youtube size={14} color="#ff0000" />,
  SoundCloud: <Cloud size={14} color="#ff5500" />
};