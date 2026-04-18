<script>
  import { onMount, onDestroy } from 'svelte';
  import { Line } from 'svelte-chartjs';
  import { Chart as ChartJS, Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, Filler } from 'chart.js';
  import { RotateCcw } from 'lucide-svelte';
  import { fetchSystemOverview } from './api.js';
  import { apiFetch } from '../../utils/api.js';

  ChartJS.register(Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, Filler);

  let status = $state({ cpu: 0, cpuTemp: { main: null, max: null }, memory: { total: 0, used: 0, percentage: 0 }, storage: [], os: {}, gpu: [], network: [] });
  let cpuHistory = $state(Array(30).fill(0));
  let labels = $state(Array(30).fill(''));
  let activeTab = $state('overview');
  let ips = $state({ local: '...', external: '...' });
  let refreshingIps = $state(false);
  let interval;

  const tabs = [
    { id: 'all', label: 'All' },
    { id: 'overview', label: 'Overview' },
    { id: 'cpu', label: 'CPU' },
    { id: 'memory', label: 'Memory' },
    { id: 'storage', label: 'Storage' },
    { id: 'network', label: 'Network' },
    { id: 'gpu', label: 'GPU' },
  ];

  async function fetchStats() {
    try {
      const data = await fetchSystemOverview();
      if (!data.error) {
        status = data;
        cpuHistory = [...cpuHistory.slice(1), parseFloat(data.cpu)];
        labels = [...labels.slice(1), ''];
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchIps() {
    refreshingIps = true;
    try {
      const data = await apiFetch('/api/system/network-ips');
      ips = data;
    } catch (err) {
      console.error(err);
    } finally {
      refreshingIps = false;
    }
  }

  onMount(() => {
    fetchStats();
    fetchIps();
    interval = setInterval(fetchStats, 1000);
  });

  onDestroy(() => { clearInterval(interval); });

  let chartData = $derived({
    labels: labels,
    datasets: [{
      label: 'CPU Usage (%)', fill: true, lineTension: 0.4,
      backgroundColor: 'rgba(88, 166, 255, 0.1)', borderColor: '#58a6ff',
      pointRadius: 0, pointHitRadius: 10, data: cpuHistory,
    }],
  });

  let chartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { display: false },
      y: { min: 0, max: 100, ticks: { color: '#8b949e', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
    }
  };
</script>

<div class="monitor">
  <div class="sidebar">
    {#each tabs as tab}
      <button class="tab {activeTab === tab.id ? 'active' : ''}" onclick={() => activeTab = tab.id}>
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="main-content">
    {#if activeTab === 'all'}
      <div class="grid-layout">
        <!-- CPU Card -->
        <div class="card glass-effect">
          <div class="section-title">CPU</div>
          <div class="big-value">{status.cpu}%</div>
          {#if status.cpuTemp?.main != null}
            <div class="temp-line">🌡 {status.cpuTemp.main}°C</div>
          {/if}
          <div class="chart-area" style="height: 100px;"><Line data={chartData} options={chartOptions} /></div>
        </div>

        <!-- Memory Card -->
        <div class="card glass-effect">
          <div class="section-title">Memory</div>
          <div class="big-value">{status.memory.percentage}%</div>
          <div class="progress-bar"><div class="fill" style="width: {status.memory.percentage}%"></div></div>
          <div class="detail-row" style="margin-top: 12px;"><span>Used</span><span>{(status.memory.used / (1024 ** 3)).toFixed(2)} GB</span></div>
          <div class="detail-row"><span>Total</span><span>{(status.memory.total / (1024 ** 3)).toFixed(2)} GB</span></div>
        </div>

        <!-- GPU Card -->
        <div class="card glass-effect">
          <div class="section-title">GPU</div>
          <div class="gpu-list">
            {#each status.gpu as g}
              <div class="gpu-item">
                <div class="value-sm">{g.model}</div>
                <div class="detail-row"><span>VRAM</span><span>{g.vram} MB</span></div>
                {#if g.temperatureGpu != null}
                  <div class="detail-row"><span class="temp">🌡 {g.temperatureGpu}°C</span></div>
                {/if}
              </div>
            {:else}
              <div class="stats">No GPU detected</div>
            {/each}
          </div>
        </div>

        <!-- Network Card -->
        <div class="card glass-effect">
          <div class="section-title">Network</div>
          <div class="ip-info">
            <div class="ip-row">
              <span class="label">Local IP:</span>
              <span class="value">{ips.local}</span>
            </div>
            <div class="ip-row">
              <span class="label">External IP:</span>
              <span class="value">{ips.external}</span>
              <button class="refresh-mini" onclick={fetchIps} title="Refresh IPs" disabled={refreshingIps}>
                <RotateCcw size={12} class={refreshingIps ? 'spin' : ''} />
              </button>
            </div>
          </div>
          <div class="net-list" style="margin-top: 12px;">
            {#each status.network as n}
              {#if n.rx_sec > 0 || n.tx_sec > 0}
                <div class="net-item">
                  <div class="drive-name">{n.iface}</div>
                  <div class="detail-row down">↓ {(n.rx_sec / 1024 / 1024).toFixed(2)} MB/s</div>
                  <div class="detail-row up">↑ {(n.tx_sec / 1024 / 1024).toFixed(2)} MB/s</div>
                </div>
              {/if}
            {/each}
          </div>
        </div>
        
        <!-- Storage Card -->
        <div class="card glass-effect storage-group">
          <div class="section-title">Storage</div>
          <div class="storage-list">
            {#each status.storage as drive}
              <div class="drive-item">
                <div class="detail-row"><span class="drive-name">{drive.fs}</span><span>{drive.use}%</span></div>
                <div class="progress-bar"><div class="fill" style="width: {drive.use}%"></div></div>
              </div>
            {/each}
          </div>
        </div>
      </div>

    {:else if activeTab === 'overview'}
      <div class="section-title">System Overview</div>
      <div class="overview-grid">
        <div class="card glass-effect">
          <h3>CPU</h3>
          <div class="value">{status.cpu}%</div>
          {#if status.cpuTemp?.main != null}
            <div class="temp">🌡 {status.cpuTemp.main}°C</div>
          {/if}
        </div>
        <div class="card glass-effect">
          <h3>Memory</h3>
          <div class="value">{status.memory.percentage}%</div>
          <div class="stats">{(status.memory.used / (1024 ** 3)).toFixed(1)}GB / {(status.memory.total / (1024 ** 3)).toFixed(1)}GB</div>
        </div>
        <div class="card glass-effect">
          <h3>GPU</h3>
          {#each status.gpu as g}
            <div class="value-sm">{g.model}</div>
            {#if g.temperatureGpu != null}
              <div class="temp">🌡 {g.temperatureGpu}°C</div>
            {/if}
          {:else}
            <div class="stats">No GPU detected</div>
          {/each}
        </div>
        <div class="card glass-effect">
          <h3>OS</h3>
          <div class="value-sm">{status.os.distro || ''}</div>
          <div class="stats">{status.os.platform || ''} {status.os.release || ''}</div>
        </div>
      </div>

    {:else if activeTab === 'cpu'}
      <div class="section-title">CPU Usage</div>
      <div class="card glass-effect">
        <div class="big-value">{status.cpu}%</div>
        {#if status.cpuTemp?.main != null}
          <div class="temp-line">Temperature: <strong>{status.cpuTemp.main}°C</strong> (Max: {status.cpuTemp.max ?? '-'}°C)</div>
        {/if}
        <div class="chart-area">
          <Line data={chartData} options={chartOptions} />
        </div>
      </div>

    {:else if activeTab === 'memory'}
      <div class="section-title">Memory Usage</div>
      <div class="card glass-effect">
        <div class="big-value">{status.memory.percentage}%</div>
        <div class="progress-bar"><div class="fill" style="width: {status.memory.percentage}%"></div></div>
        <div class="detail-row"><span>Used</span><span>{(status.memory.used / (1024 ** 3)).toFixed(2)} GB</span></div>
        <div class="detail-row"><span>Total</span><span>{(status.memory.total / (1024 ** 3)).toFixed(2)} GB</span></div>
        <div class="detail-row"><span>Free</span><span>{((status.memory.total - status.memory.used) / (1024 ** 3)).toFixed(2)} GB</span></div>
      </div>

    {:else if activeTab === 'storage'}
      <div class="section-title">Storage</div>
      {#each status.storage as drive}
        <div class="card glass-effect drive-card">
          <div class="detail-row"><span class="drive-name">{drive.fs}</span><span>{drive.use}%</span></div>
          <div class="progress-bar"><div class="fill" style="width: {drive.use}%"></div></div>
          <div class="detail-row stats"><span>Used: {(drive.used / (1024 ** 3)).toFixed(1)} GB</span><span>Total: {(drive.size / (1024 ** 3)).toFixed(1)} GB</span></div>
        </div>
      {/each}

    {:else if activeTab === 'network'}
      <div class="section-title">Network Traffic</div>
      <div class="card glass-effect" style="margin-bottom: 16px;">
        <div class="ip-info" style="border: none; padding: 0;">
          <div class="ip-row">
            <span class="label">Local IP:</span>
            <span class="value">{ips.local}</span>
          </div>
          <div class="ip-row">
            <span class="label">External IP:</span>
            <span class="value">{ips.external}</span>
            <button class="refresh-mini" onclick={fetchIps} title="Refresh IPs" disabled={refreshingIps}>
              <RotateCcw size={12} class={refreshingIps ? 'spin' : ''} />
            </button>
          </div>
        </div>
      </div>
      {#each status.network as n}
        {#if n.rx_sec > 0 || n.tx_sec > 0}
          <div class="card glass-effect">
            <div class="detail-row"><span class="drive-name">{n.iface}</span></div>
            <div class="net-speeds">
              <div class="speed-item down">↓ {(n.rx_sec / 1024 / 1024).toFixed(2)} MB/s</div>
              <div class="speed-item up">↑ {(n.tx_sec / 1024 / 1024).toFixed(2)} MB/s</div>
            </div>
          </div>
        {/if}
      {:else}
        <div class="card glass-effect"><div class="stats">No active traffic</div></div>
      {/each}

    {:else if activeTab === 'gpu'}
      <div class="section-title">GPU</div>
      {#each status.gpu as g}
        <div class="card glass-effect">
          <div class="value-sm">{g.model}</div>
          <div class="detail-row"><span>VRAM</span><span>{g.vram} MB</span></div>
          <div class="detail-row"><span>Bus</span><span>{g.bus}</span></div>
          {#if g.temperatureGpu != null}
            <div class="detail-row"><span>Temperature</span><span class="temp-val">{g.temperatureGpu}°C</span></div>
          {/if}
        </div>
      {:else}
        <div class="card glass-effect"><div class="stats">No GPU detected</div></div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .monitor { display: flex; height: 100%; color: var(--text-main); }
  .sidebar { width: 140px; background: rgba(0,0,0,0.3); border-right: 1px solid var(--glass-border); display: flex; flex-direction: column; padding: 8px; gap: 4px; flex-shrink: 0; }
  .tab { background: transparent; border: none; color: var(--text-dim); padding: 10px 12px; border-radius: 6px; text-align: left; cursor: pointer; font-size: 13px; }
  .tab:hover { background: rgba(255,255,255,0.05); color: white; }
  .tab.active { background: rgba(88,166,255,0.15); color: var(--accent-blue); font-weight: 600; }
  .main-content { flex: 1; padding: 20px; overflow: auto; display: flex; flex-direction: column; gap: 16px; }
  .section-title { font-size: 15px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; }
  .overview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card { padding: 16px; border-radius: 10px; display: flex; flex-direction: column; gap: 8px; }
  h3 { font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; margin: 0; }
  .value { font-size: 28px; font-weight: 700; }
  .value-sm { font-size: 14px; font-weight: 600; }
  .big-value { font-size: 48px; font-weight: 700; text-align: center; }
  .temp { font-size: 13px; color: #f0883e; }
  .temp-line { font-size: 13px; color: #f0883e; text-align: center; }
  .temp-val { color: #f0883e; font-weight: 600; }
  .stats { font-size: 12px; color: var(--text-dim); }
  .chart-area { height: 160px; margin-top: 12px; }
  .progress-bar { height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; }
  .fill { height: 100%; background: var(--accent-blue); transition: width 0.5s ease; box-shadow: 0 0 8px var(--accent-blue); }
  .detail-row { display: flex; justify-content: space-between; font-size: 13px; padding: 2px 0; }
  .drive-name { font-weight: 600; }
  .drive-card { margin-bottom: 4px; }
  .net-speeds { display: flex; gap: 20px; margin-top: 4px; }
  .speed-item { font-size: 14px; font-weight: 500; }
  .down { color: var(--accent-blue); }
  .up { color: var(--accent-green); }
  
  /* Grid Layout for All tab */
  .grid-layout { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; align-items: start; }
  .gpu-list, .net-list, .storage-list { display: flex; flex-direction: column; gap: 12px; }
  .gpu-item, .net-item, .drive-item { background: rgba(0,0,0,0.15); padding: 8px; border-radius: 6px; }
  .storage-group { grid-column: 1 / -1; }

  .ip-info { display: flex; flex-direction: column; gap: 4px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; }
  .ip-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .ip-row .label { color: var(--text-dim); }
  .ip-row .value { color: var(--text-main); font-family: monospace; font-weight: 600; }
  .refresh-mini { background: transparent; border: none; color: var(--accent-blue); cursor: pointer; display: flex; align-items: center; padding: 2px; border-radius: 4px; }
  .refresh-mini:hover { background: rgba(255,255,255,0.1); }
  .refresh-mini:disabled { opacity: 0.5; cursor: not-allowed; }
  
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  :global(.spin) { animation: spin 1s linear infinite; }
</style>
