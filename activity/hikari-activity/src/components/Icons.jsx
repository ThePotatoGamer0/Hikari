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
  X 
} from 'lucide-react';

export default {
  MusicNote: <Music size={24} />,
  Shuffle: <Shuffle size={24} />,
  
  // Adding fill="currentColor" to Stop and Skip to give them the solid, filled-in media player look
  Stop: <Square size={24} fill="currentColor" />,
  Skip: <SkipForward size={24} fill="currentColor" />,
  
  Repeat: <Repeat size={24} />,
  RepeatOne: <Repeat1 size={24} />,
  
  // Infinity is aliased in the import to avoid conflicting with JavaScript's global Infinity object
  Infinity: <InfinityIcon size={24} />,
  
  Plus: <Plus size={24} />,
  Trash: <Trash2 size={20} />,
  Close: <X size={24} />
};