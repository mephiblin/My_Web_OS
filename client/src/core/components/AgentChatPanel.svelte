<script>
  import { agentStore } from '../stores/agentStore.js';
  import { Send, X } from 'lucide-svelte';

  function onDraftInput(event) {
    agentStore.setDraft(event.currentTarget.value);
  }

  function send() {
    agentStore.sendUserMessage();
  }

  function onDraftKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }
</script>

<div class="chat-panel glass-effect">
  <div class="chat-header">
    <strong>Agent</strong>
    <button class="icon-btn" type="button" onclick={() => agentStore.closePanel()} aria-label="Close agent chat">
      <X size={14} />
    </button>
  </div>

  <div class="message-list">
    {#if $agentStore.messages.length === 0}
      <div class="empty">Start a conversation.</div>
    {:else}
      {#each $agentStore.messages as message (message.id)}
        <div class="message-row {message.role}">
          <div class="message-bubble">{message.content}</div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="composer">
    <textarea
      rows="2"
      placeholder="Type a message"
      value={$agentStore.draft}
      oninput={onDraftInput}
      onkeydown={onDraftKeydown}
    ></textarea>
    <button class="icon-btn send" type="button" onclick={send} aria-label="Send message">
      <Send size={14} />
    </button>
  </div>
</div>

<style>
  .chat-panel {
    width: min(360px, 78vw);
    height: min(420px, 55vh);
    display: flex;
    flex-direction: column;
    background: rgba(16, 22, 34, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 10px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    pointer-events: auto;
  }

  .chat-header {
    height: 38px;
    padding: 0 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
    font-size: 13px;
  }

  .message-list {
    flex: 1;
    padding: 10px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .empty {
    color: rgba(255, 255, 255, 0.55);
    font-size: 12px;
    margin: auto 0;
    text-align: center;
  }

  .message-row {
    display: flex;
  }

  .message-row.user {
    justify-content: flex-end;
  }

  .message-row.assistant,
  .message-row.system {
    justify-content: flex-start;
  }

  .message-bubble {
    max-width: 85%;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.4;
    color: white;
    word-break: break-word;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .message-row.user .message-bubble {
    background: rgba(88, 166, 255, 0.22);
    border-color: rgba(88, 166, 255, 0.35);
  }

  .message-row.system .message-bubble {
    color: rgba(255, 255, 255, 0.8);
    background: rgba(255, 255, 255, 0.06);
  }

  .composer {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    padding: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  textarea {
    width: 100%;
    resize: none;
    min-height: 58px;
    max-height: 110px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(10, 14, 22, 0.75);
    color: white;
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.4;
    outline: none;
  }

  textarea:focus {
    border-color: rgba(88, 166, 255, 0.65);
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.9);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .send {
    align-self: end;
    color: rgba(88, 166, 255, 0.95);
    border-color: rgba(88, 166, 255, 0.35);
    background: rgba(88, 166, 255, 0.18);
  }
</style>
