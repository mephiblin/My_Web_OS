<script>
  import { Smartphone, Laptop, Monitor, Send, Download, Shield, Zap, Info, Loader2 } from 'lucide-svelte';
  import { addToast } from '../../core/stores/toastStore.js';
  import { notifications } from '../../core/stores/notificationStore.js';

  let devices = $state([
    { id: 'p-1', name: 'MacBook Pro', type: 'laptop', status: 'online' },
    { id: 'p-2', name: 'Galaxy S24', type: 'mobile', status: 'online' },
    { id: 'p-3', name: 'Workstation', type: 'desktop', status: 'offline' }
  ]);

  let selectedDeviceId = $state(null);
  let transferring = $state(false);
  let progress = $state(0);

  const getTypeIcon = (type) => {
    switch (type) {
      case 'mobile': return Smartphone;
      case 'laptop': return Laptop;
      default: return Monitor;
    }
  };

  function startTransfer() {
    if (!selectedDeviceId) return;
    transferring = true;
    progress = 0;
    
    const interval = setInterval(() => {
      progress += 5;
      if (progress >= 100) {
        clearInterval(interval);
        transferring = false;
        addToast('File transfer complete!', 'success');
        notifications.add({
          title: 'Transfer',
          message: `Successfully sent file to ${devices.find(d => d.id === selectedDeviceId).name}`,
          type: 'success'
        });
      }
    }, 100);
  }
</script>

<div class="transfer-app">
  <aside class="device-list glass-effect">
    <div class="header">
      <Zap size={18} color="var(--accent-blue)" />
      <span>Nearby Devices</span>
    </div>
    <div class="devices">
      {#each devices as device}
        <button 
          class="device-item {device.status} {selectedDeviceId === device.id ? 'active' : ''}"
          onclick={() => selectedDeviceId = device.id}
          disabled={device.status === 'offline'}
        >
          <div class="icon-circle">
            <svelte:component this={getTypeIcon(device.type)} size={18} />
          </div>
          <div class="device-info">
            <span class="name">{device.name}</span>
            <span class="status">{device.status}</span>
          </div>
        </button>
      {/each}
    </div>
  </aside>

  <main class="drop-zone">
    {#if !selectedDeviceId}
      <div class="empty-state">
        <Send size={64} color="var(--text-dim)" />
        <h2>Send Files</h2>
        <p>Select a nearby device to start sharing</p>
      </div>
    {:else}
      <div class="transfer-container">
        <div class="header">
          <h2>Send to {devices.find(d => d.id === selectedDeviceId).name}</h2>
          <div class="shield-badge">
            <Shield size={14} />
            <span>P2P Encrypted</span>
          </div>
        </div>

        <div class="drop-area {transferring ? 'transferring' : ''}">
          {#if transferring}
            <div class="progress-circle" style="--p: {progress}">
              <div class="inner">
                <span class="pct">{progress}%</span>
              </div>
            </div>
            <p>Moving atoms...</p>
          {:else}
            <div class="upload-icon">
              <Download size={48} color="var(--accent-blue)" />
            </div>
            <p>Drag & Drop files here or click to browse</p>
            <button class="action-btn" onclick={startTransfer}>Simulate Transfer</button>
          {/if}
        </div>

        <div class="info-footer">
          <Info size={14} />
          <span>WebRTC P2P connection established. Speed: 150Mbps</span>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .transfer-app { display: flex; height: 100%; overflow: hidden; background: rgba(0,0,0,0.3); }
  
  .device-list { width: 240px; border-right: 1px solid var(--glass-border); padding: 20px 10px; display: flex; flex-direction: column; gap: 20px; }
  .header { display: flex; align-items: center; gap: 10px; font-weight: 600; padding: 0 10px; }
  
  .devices { display: flex; flex-direction: column; gap: 8px; }
  .device-item { 
    display: flex; align-items: center; gap: 12px; padding: 12px; background: transparent; 
    border: 1px solid transparent; border-radius: 12px; cursor: pointer; transition: all 0.2s;
    text-align: left;
  }
  .device-item:hover:not(:disabled) { background: rgba(255,255,255,0.05); }
  .device-item.active { background: rgba(88, 166, 255, 0.1); border-color: var(--accent-blue); }
  .device-item:disabled { opacity: 0.4; cursor: not-allowed; }

  .icon-circle { 
    width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,0.05); 
    display: flex; align-items: center; justify-content: center; color: var(--text-dim);
  }
  .active .icon-circle { color: var(--accent-blue); background: rgba(88, 166, 255, 0.2); }
  
  .device-info { display: flex; flex-direction: column; }
  .name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .status { font-size: 11px; text-transform: uppercase; color: var(--text-dim); }
  .online .status { color: #4caf50; }

  .drop-zone { flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px; }
  .empty-state { text-align: center; color: var(--text-dim); }
  .empty-state h2 { margin-top: 20px; color: var(--text-primary); }

  .transfer-container { width: 100%; max-width: 500px; display: flex; flex-direction: column; gap: 30px; }
  .transfer-container .header { justify-content: space-between; padding: 0; }
  .shield-badge { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #4caf50; background: rgba(76, 175, 80, 0.1); padding: 4px 10px; border-radius: 20px; }

  .drop-area { 
    border: 2px dashed var(--glass-border); border-radius: 20px; padding: 40px; 
    display: flex; flex-direction: column; align-items: center; gap: 20px; 
    background: rgba(255,255,255,0.02); transition: all 0.3s;
  }
  .drop-area:hover:not(.transferring) { border-color: var(--accent-blue); background: rgba(88, 166, 255, 0.05); }

  .action-btn { background: var(--accent-blue); color: white; border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-weight: 600; }
  
  .progress-circle { 
    width: 120px; height: 120px; border-radius: 50%; 
    background: conic-gradient(var(--accent-blue) calc(var(--p) * 1%), rgba(255,255,255,0.1) 0);
    display: flex; align-items: center; justify-content: center;
  }
  .progress-circle .inner { width: 100px; height: 100px; border-radius: 50%; background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
  .pct { font-size: 24px; font-weight: 700; color: var(--accent-blue); }

  .info-footer { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 12px; color: var(--text-dim); }
</style>
