<script>
  import { onMount } from 'svelte';

  let { x = 0, y = 0, items = [], close = () => {} } = $props();

  let menuEl;

  onMount(() => {
    const handleClick = () => close();
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  });
</script>

<div class="context-menu glass-effect" style="left: {x}px; top: {y}px" bind:this={menuEl}>
  {#each items as item}
    <button class={item.danger ? 'danger' : ''} onclick={() => { item.action(); close(); }}>
      {#if item.icon}
        <svelte:component this={item.icon} size={14} />
      {/if}
      <span>{item.label}</span>
    </button>
  {/each}
</div>

<style>
  .context-menu { position: fixed; min-width: 160px; padding: 6px; border-radius: 8px; z-index: 10000; display: flex; flex-direction: column; }
  .context-menu button { background: transparent; border: none; color: var(--text-main); padding: 8px 12px; font-size: 13px; display: flex; align-items: center; gap: 10px; border-radius: 4px; cursor: pointer; text-align: left; }
  .context-menu button:hover { background: rgba(255,255,255,0.1); }
  .context-menu button.danger { color: var(--accent-red); }
  .context-menu button.danger:hover { background: rgba(255, 0, 0, 0.15); }
</style>
