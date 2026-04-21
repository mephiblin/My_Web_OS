<script>
  import { agentStore } from '../stores/agentStore.js';
  import { Bot, AlertTriangle, XCircle, CheckCircle, Loader, Terminal, Ear, Play } from 'lucide-svelte';
  import AgentChatPanel from './AgentChatPanel.svelte';

  const statusColors = {
    idle: 'var(--accent-blue)',
    listening: '#38bdf8',
    thinking: '#a78bfa',
    executing: '#60a5fa',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    terminal: '#eab308'
  };

</script>

{#if $agentStore.visible}
  <div class="agent-container">
    {#if $agentStore.dialogue}
      <div class="dialogue-bubble">
        {$agentStore.dialogue}
      </div>
    {/if}
    
    {#if $agentStore.isOpen}
      <AgentChatPanel />
    {/if}

    <button
      class="agent-avatar glass-effect" 
      style="border-color: {statusColors[$agentStore.status] || statusColors.idle}; box-shadow: 0 0 20px {(statusColors[$agentStore.status] || statusColors.idle)}40;"
      type="button"
      onclick={() => agentStore.togglePanel()}
      aria-label="Toggle agent chat panel"
    >
      <!-- Placeholder for Inochi2D Canvas -->
      <div class="canvas-placeholder">
        {#if $agentStore.status === 'listening'}
          <Ear size={32} color={statusColors.listening} />
        {:else if $agentStore.status === 'thinking'}
          <Loader size={32} color={statusColors.thinking} class="spin" />
        {:else if $agentStore.status === 'executing'}
          <Play size={32} color={statusColors.executing} />
        {:else if $agentStore.status === 'success'}
          <CheckCircle size={32} color={statusColors.success} />
        {:else if $agentStore.status === 'warning'}
          <AlertTriangle size={32} color={statusColors.warning} />
        {:else if $agentStore.status === 'error'}
          <XCircle size={32} color={statusColors.error} />
        {:else if $agentStore.status === 'terminal'}
          <Terminal size={32} color={statusColors.terminal} />
        {:else}
          <Bot size={32} color={statusColors.idle} />
        {/if}
      </div>
    </button>
  </div>
{/if}

<style>
  .agent-container {
    position: absolute;
    bottom: 80px;
    right: 30px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 15px;
    z-index: 9990; /* Just below taskbar menu overlays */
    pointer-events: none;
  }

  .dialogue-bubble {
    background: rgba(20, 25, 35, 0.85);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    padding: 12px 18px;
    border-radius: 16px 16px 4px 16px;
    color: white;
    font-size: 13px;
    max-width: 200px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.4);
    animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    pointer-events: auto;
  }

  .agent-avatar {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: rgba(10, 15, 25, 0.6);
    backdrop-filter: blur(10px);
    display: flex;
    justify-content: center;
    align-items: center;
    border: 2px solid transparent;
    transition: all 0.3s ease;
    pointer-events: auto;
    cursor: pointer;
  }
  
  .agent-avatar:hover {
    transform: scale(1.05);
  }

  .canvas-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .spin {
    animation: spinArea 1.5s linear infinite;
  }

  @keyframes popIn {
    0% { opacity: 0; transform: scale(0.8) translateY(10px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes spinArea {
    100% { transform: rotate(360deg); }
  }
</style>
