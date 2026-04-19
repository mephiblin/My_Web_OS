<script>
  import { notifications } from '../stores/notificationStore.js';
  import { X, Trash2, Bell, CheckCircle, AlertTriangle, Info, AlertCircle } from 'lucide-svelte';
  import { slide, fade } from 'svelte/transition';

  let { isOpen = $bindable(false) } = $props();

  const getIcon = (type) => {
    switch (type) {
      case 'success': return CheckCircle;
      case 'warning': return AlertTriangle;
      case 'error': return AlertCircle;
      default: return Info;
    }
  };

  const getTimeString = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
</script>

{#if isOpen}
  <div class="notification-center glass-effect" transition:slide={{ axis: 'x', duration: 300 }}>
    <div class="header">
      <div class="title">
        <Bell size={18} />
        <span>Notifications</span>
      </div>
      <div class="actions">
        <button class="icon-btn" onclick={() => notifications.clearAll()} title="Clear All">
          <Trash2 size={16} />
        </button>
        <button class="icon-btn" onclick={() => isOpen = false}>
          <X size={18} />
        </button>
      </div>
    </div>

    <div class="notification-list">
      {#if $notifications.length === 0}
        <div class="empty-state">
          <Bell size={48} />
          <p>No new notifications</p>
        </div>
      {:else}
        {#each $notifications as item (item.id)}
          {@const Icon = getIcon(item.type)}
          <div class="notification-item {item.read ? 'read' : ''}" transition:fade>
            <div class="icon {item.type}">
              <Icon size={20} />
            </div>
            <div class="content">
              <div class="item-header">
                <span class="item-title">{item.title}</span>
                <span class="time">{getTimeString(item.timestamp)}</span>
              </div>
              <p class="message">{item.message}</p>
            </div>
            <button class="remove-btn" onclick={() => notifications.remove(item.id)}>
              <X size={14} />
            </button>
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .notification-center {
    position: fixed;
    top: 0;
    right: 0;
    width: 350px;
    height: calc(100% - 48px); /* Height minus taskbar */
    z-index: 1000;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--glass-border);
    box-shadow: -10px 0 30px rgba(0, 0, 0, 0.3);
  }

  .header {
    padding: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--glass-border);
  }

  .title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    font-size: 16px;
    color: var(--text-primary);
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
  }

  .notification-list {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .empty-state {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    gap: 16px;
    opacity: 0.5;
  }

  .notification-item {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    padding: 12px;
    display: flex;
    gap: 12px;
    position: relative;
    transition: transform 0.2s;
  }

  .notification-item:hover {
    transform: translateY(-2px);
    background: rgba(255, 255, 255, 0.1);
  }

  .icon {
    display: flex;
    align-items: flex-start;
    padding-top: 2px;
  }

  .icon.info { color: var(--accent-blue); }
  .icon.success { color: #4caf50; }
  .icon.warning { color: #ff9800; }
  .icon.error { color: #f44336; }

  .content {
    flex: 1;
    overflow: hidden;
  }

  .item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .item-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .time {
    font-size: 11px;
    color: var(--text-dim);
  }

  .message {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.4;
    margin: 0;
  }

  .remove-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .notification-item:hover .remove-btn {
    opacity: 1;
  }

  /* Custom Scrollbar */
  .notification-list::-webkit-scrollbar { width: 4px; }
  .notification-list::-webkit-scrollbar-track { background: transparent; }
  .notification-list::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }
</style>
