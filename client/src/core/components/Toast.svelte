<script>
  import { toasts, removeToast } from '../stores/toastStore.js';
  import { X } from 'lucide-svelte';
</script>

<div class="toast-container">
  {#each $toasts as toast (toast.id)}
    <div class="toast glass-effect {'toast-' + toast.type}">
      <div class="message">{toast.message}</div>
      <button class="close-btn" onclick={() => removeToast(toast.id)}>
        <X size={16} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-container { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 10px; z-index: 9999; }
  .toast { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 8px; min-width: 250px; animation: slideIn 0.3s ease-out forwards; background: var(--panel-bg); }
  .toast-error { border-left: 4px solid var(--accent-red); }
  .toast-success { border-left: 4px solid var(--accent-green); }
  .toast-info { border-left: 4px solid var(--accent-blue); }
  .message { font-size: 14px; margin-right: 15px; }
  .close-btn { background: transparent; border: none; color: var(--text-dim); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
  .close-btn:hover { color: var(--text-main); }
  @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
</style>
