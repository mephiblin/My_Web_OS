<script>
  import { onMount, onDestroy } from 'svelte';
  import { Line } from 'svelte-chartjs';
  import { Chart as ChartJS, Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale } from 'chart.js';
  import { fetchSystemOverview } from './api.js';

  ChartJS.register(Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale);

  let status = $state({ cpu: 0, memory: { total: 0, used: 0, percentage: 0 }, storage: [], os: {}, gpu: [], network: [] });
  let cpuHistory = $state(Array(20).fill(0));
  let labels = $state(Array(20).fill(''));
  let interval;

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

  onMount(() => {
    fetchStats();
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
</script>

<div class="monitor">
  <div class="summary-grid">
    <div class="card glass-effect">
      <h3>CPU</h3>
      <div class="value">{status.cpu}%</div>
      <div class="chart-container">
        <Line data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { min: 0, max: 100 } } }} />
      </div>
    </div>
    <div class="card glass-effect">
      <h3>Memory</h3>
      <div class="value">{status.memory.percentage}%</div>
      <div class="progress-bar"><div class="fill" style="width: {status.memory.percentage}%"></div></div>
      <div class="stats">{(status.memory.used / (1024 ** 3)).toFixed(2)} GB / {(status.memory.total / (1024 ** 3)).toFixed(2)} GB</div>
    </div>
  </div>

  <div class="summary-grid">
    <div class="card glass-effect">
      <h3>GPU</h3>
      {#each status.gpu as g}
        <div class="gpu-item"><div class="model">{g.model}</div><div class="extra">{g.vram}MB VRAM</div></div>
      {:else}
        <div class="extra">No GPU detected</div>
      {/each}
    </div>
    <div class="card glass-effect">
      <h3>Network</h3>
      {#each status.network as n}
        {#if n.rx_sec > 0 || n.tx_sec > 0}
          <div class="net-item">
            <span>{n.iface}</span>
            <div class="speeds">
              <span class="down">↓ {(n.rx_sec / 1024 / 1024).toFixed(2)} MB/s</span>
              <span class="up">↑ {(n.tx_sec / 1024 / 1024).toFixed(2)} MB/s</span>
            </div>
          </div>
        {/if}
      {:else}
        <div class="extra">No active traffic</div>
      {/each}
    </div>
  </div>

  <div class="storage-section card glass-effect">
    <h3>Storage</h3>
    {#each status.storage as drive}
      <div class="drive">
        <div class="drive-info"><span>{drive.fs}</span><span>{drive.use}%</span></div>
        <div class="progress-bar"><div class="fill" style="width: {drive.use}%"></div></div>
      </div>
    {/each}
  </div>

  <div class="os-info card glass-effect">
    <h3>Information</h3>
    <p><strong>OS:</strong> {status.os.distro} {status.os.release}</p>
    <p><strong>Platform:</strong> {status.os.platform}</p>
  </div>
</div>

<style>
  .monitor { padding: 20px; display: flex; flex-direction: column; gap: 20px; color: var(--text-main); }
  .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .card { padding: 16px; border-radius: 12px; display: flex; flex-direction: column; gap: 12px; }
  h3 { font-size: 14px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; }
  .value { font-size: 32px; font-weight: 700; text-shadow: 0 0 10px rgba(255, 255, 255, 0.2); }
  .chart-container { height: 60px; }
  .progress-bar { height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; }
  .fill { height: 100%; background: var(--accent-blue); transition: width 0.5s ease; box-shadow: 0 0 10px var(--accent-blue); }
  .stats, .extra { font-size: 12px; color: var(--text-dim); }
  .gpu-item, .net-item { padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .gpu-item .model { font-size: 13px; font-weight: 500; }
  .net-item { display: flex; justify-content: space-between; align-items: center; }
  .speeds { display: flex; gap: 10px; font-size: 11px; color: var(--text-dim); }
  .down { color: var(--accent-blue); }
  .up { color: var(--accent-green); }
  .drive { margin-bottom: 12px; }
  .drive-info { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
  .os-info p { font-size: 13px; margin: 4px 0; }
</style>
