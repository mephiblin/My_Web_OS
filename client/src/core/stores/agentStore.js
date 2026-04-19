import { writable } from 'svelte/store';

// System Feedback Linkage
const createAgentStore = () => {
  const { subscribe, set, update } = writable({
    visible: true,
    emotion: 'idle', // 'idle', 'alert', 'error', 'happy', 'processing'
    dialogue: '',
    dialogueTimeout: null
  });

  return {
    subscribe,
    setVisibility: (visible) => update(s => ({ ...s, visible })),
    
    // Trigger an emotion with optional dialogue
    triggerEmotion: (emotion, dialogue = '', duration = 5000) => {
      update(s => {
        if (s.dialogueTimeout) clearTimeout(s.dialogueTimeout);
        
        let timeout = null;
        if (duration > 0) {
          timeout = setTimeout(() => {
            update(inner => ({ ...inner, emotion: 'idle', dialogue: '' }));
          }, duration);
        }
        
        return { ...s, emotion, dialogue, dialogueTimeout: timeout };
      });
    },
    
    // Standard system reactions
    notifyUploadComplete: () => agentStore.triggerEmotion('happy', 'File upload complete!', 3000),
    notifyError: (msg) => agentStore.triggerEmotion('error', `Oops: ${msg}`, 5000),
    notifySystemAlert: () => agentStore.triggerEmotion('alert', 'High CPU Usage Detected!', 4000),
  };
};

export const agentStore = createAgentStore();
