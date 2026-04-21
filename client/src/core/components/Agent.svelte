<script>
  import { agentStore } from '../stores/agentStore.js';
  import AgentChatPanel from './AgentChatPanel.svelte';
</script>

{#if $agentStore.visible && ($agentStore.dialogue || $agentStore.isOpen)}
  <div class="agent-container">
    {#if $agentStore.dialogue}
      <div class="dialogue-bubble">
        {$agentStore.dialogue}
      </div>
    {/if}
    
    {#if $agentStore.isOpen}
      <AgentChatPanel />
    {/if}
  </div>
{/if}

<style>
  .agent-container {
    position: absolute;
    bottom: 80px;
    right: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
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

  @keyframes popIn {
    0% { opacity: 0; transform: scale(0.8) translateY(10px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
</style>
