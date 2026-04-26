<script>
  import { onMount } from 'svelte';
  import { contextMenuSettings } from '../stores/contextMenuStore.js';

  let { x = 0, y = 0, items = [], close = () => {} } = $props();
  let menuEl = $state(null);
  let adjustedX = $state(0);
  let adjustedY = $state(0);
  let pendingDangerItem = $state(null);

  onMount(() => {
    const handleClick = () => close();
    document.addEventListener('click', handleClick);

    // Adjust position to stay within viewport
    adjustedX = x;
    adjustedY = y;
    if (menuEl) {
      const rect = menuEl.getBoundingClientRect();
      if (x + rect.width > window.innerWidth) {
        adjustedX = x - rect.width;
      }
      if (y + rect.height > window.innerHeight) {
        adjustedY = y - rect.height;
      }
    }

    return () => document.removeEventListener('click', handleClick);
  });

  function runItem(item) {
    if (!item || typeof item.action !== 'function') return;
    if ($contextMenuSettings.confirmDanger && item.danger) {
      pendingDangerItem = item;
      return;
    }
    item.action();
    close();
  }

  function confirmDangerItem() {
    const item = pendingDangerItem;
    pendingDangerItem = null;
    if (!item || typeof item.action !== 'function') return;
    item.action();
    close();
  }
</script>

<div class="context-menu glass-effect {$contextMenuSettings.density}" style="left: {adjustedX}px; top: {adjustedY}px" bind:this={menuEl}>
  {#each items as item}
    <button class={item.danger ? 'danger' : ''} onclick={() => runItem(item)}>
      {#if $contextMenuSettings.showIcons && item.icon}
        {@const ItemIcon = item.icon}
        <ItemIcon size={14} />
      {/if}
      <span>{item.label}</span>
    </button>
  {/each}
</div>

{#if pendingDangerItem}
  <div class="confirm-backdrop" role="presentation">
    <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="contextDangerTitle">
      <h3 id="contextDangerTitle">Run Action</h3>
      <p>{pendingDangerItem.label}</p>
      <div class="confirm-actions">
        <button onclick={() => { pendingDangerItem = null; }}>Cancel</button>
        <button class="danger" onclick={confirmDangerItem}>Run</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .context-menu { position: fixed; min-width: 160px; padding: 6px; border-radius: 8px; z-index: 12000; display: flex; flex-direction: column; }
  .context-menu button { background: transparent; border: none; color: var(--text-main); padding: 8px 12px; font-size: 13px; display: flex; align-items: center; gap: 10px; border-radius: 4px; cursor: pointer; text-align: left; }
  .context-menu.compact button { padding: 6px 10px; font-size: 12px; gap: 8px; }
  .context-menu.cozy button { padding: 9px 12px; font-size: 13px; gap: 10px; }
  .context-menu button:hover { background: rgba(255,255,255,0.1); }
  .context-menu button.danger { color: var(--accent-red); }
  .context-menu button.danger:hover { background: rgba(255, 0, 0, 0.15); }
  .confirm-backdrop { position: fixed; inset: 0; z-index: 13000; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.38); }
  .confirm-dialog { width: min(360px, calc(100vw - 32px)); border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(20, 24, 35, 0.96); padding: 16px; color: var(--text-main); display: grid; gap: 10px; }
  .confirm-dialog h3, .confirm-dialog p { margin: 0; }
  .confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .confirm-actions button { border: 1px solid var(--glass-border); border-radius: 6px; padding: 8px 10px; background: rgba(255,255,255,0.08); color: var(--text-main); cursor: pointer; }
  .confirm-actions button.danger { color: var(--accent-red); }
</style>
