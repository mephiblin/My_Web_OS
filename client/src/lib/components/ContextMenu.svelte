<script>
  import { onMount, onDestroy } from 'svelte';
  
  let { x = 0, y = 0, items = [], close } = $props();

  let menuRef;

  function handleClickOutside(e) {
    if (menuRef && !menuRef.contains(e.target)) {
      close();
    }
  }

  onMount(() => document.addEventListener('mousedown', handleClickOutside));
  onDestroy(() => document.removeEventListener('mousedown', handleClickOutside));
</script>

<div class="context-menu glass-effect window-shadow" style="left: {x}px; top: {y}px;" bind:this={menuRef}>
  {#each items as item}
    <button class="menu-item {item.danger ? 'danger' : ''}" onclick={(e) => { e.stopPropagation(); item.action(); close(); }}>
      {#if item.icon}
        <svelte:component this={item.icon} size={14} />
      {/if}
      <span>{item.label}</span>
    </button>
  {/each}
</div>

<style>
  .context-menu {
    position: absolute;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    min-width: 160px;
    padding: 4px;
    border-radius: 8px;
    background: var(--panel-bg);
  }

  .menu-item {
    background: transparent;
    border: none;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    text-align: left;
    width: 100%;
  }

  .menu-item:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .menu-item.danger:hover {
    background: var(--accent-red);
    color: white;
  }
</style>
