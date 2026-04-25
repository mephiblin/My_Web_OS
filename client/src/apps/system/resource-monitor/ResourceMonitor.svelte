<script>
  import { onMount, onDestroy } from 'svelte';
  import { Line } from 'svelte-chartjs';
  import { Chart as ChartJS, Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, Filler } from 'chart.js';
  import { ArrowDownToLine, Container, FileText, Package, RotateCcw } from 'lucide-svelte';
  import { fetchSystemOverview, fetchServiceStatus, fetchRuntimeApps, fetchInstalledPackages, fetchOpsSummary } from './api.js';
  import { apiFetch } from '../../../utils/api.js';
  import { normalizeOpsStatus } from '../../../utils/opsStatus.js';
  import { openWindow } from '../../../core/stores/windowStore.js';

  ChartJS.register(Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, Filler);

  let status = $state({ cpu: 0, cpuTemp: { main: null, max: null }, memory: { total: 0, used: 0, percentage: 0 }, storage: [], os: {}, gpu: [], network: [] });
  let cpuHistory = $state(Array(30).fill(0));
  let rxHistory = $state(Array(30).fill(0));
  let txHistory = $state(Array(30).fill(0));
  let labels = $state(Array(30).fill(''));
  let activeTab = $state('overview');
  let ips = $state({ local: '...', external: '...' });
  let processes = $state([]);
  let connections = $state([]);
  let refreshingIps = $state(false);
  let loadingOps = $state(false);
  let serviceSnapshot = $state({});
  let runtimeApps = $state([]);
  let installedPackages = $state([]);
  let opsSummary = $state(null);
  let opsRecentErrors = $state([]);
  let interval;

  const tabs = [
    { id: 'all', label: 'All' },
    { id: 'overview', label: 'Overview' },
    { id: 'cpu', label: 'CPU' },
    { id: 'memory', label: 'Memory' },
    { id: 'storage', label: 'Storage' },
    { id: 'network', label: 'Network' },
    { id: 'gpu', label: 'GPU' },
    { id: 'processes', label: 'Processes' },
    { id: 'ops', label: 'Ops' },
  ];
  const opsQuickActions = [
    { id: 'logs', title: 'Logs', icon: FileText },
    { id: 'docker', title: 'Docker', icon: Container },
    { id: 'transfer', title: 'Transfer', icon: ArrowDownToLine },
    { id: 'package-center', title: 'Package Center', icon: Package }
  ];

  let storageDiagnostics = $state([]);
  let loadingDiagnostics = $state(false);

  async function fetchStats() {
    try {
      const data = await fetchSystemOverview();
      if (!data.error) {
        status = data;
        cpuHistory = [...cpuHistory.slice(1), parseFloat(data.cpu)];
        labels = [...labels.slice(1), ''];

        const rx = data.network.reduce((sum, n) => sum + (n.rx_sec || 0), 0) / 1024 / 1024;
        const tx = data.network.reduce((sum, n) => sum + (n.tx_sec || 0), 0) / 1024 / 1024;
        rxHistory = [...rxHistory.slice(1), rx];
        txHistory = [...txHistory.slice(1), tx];
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchDiagnostics() {
    loadingDiagnostics = true;
    try {
      const data = await apiFetch('/api/system/storage/diagnostics');
      storageDiagnostics = data;
    } catch (err) {
      console.error(err);
    } finally {
      loadingDiagnostics = false;
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

  async function fetchProcesses() {
    if (activeTab !== 'processes') return;
    try {
      const data = await apiFetch('/api/system/processes');
      if (!data.error) processes = data;
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchConnections() {
    if (activeTab !== 'network') return;
    try {
      const data = await apiFetch('/api/system/network/connections');
      if (!data.error && Array.isArray(data)) {
         connections = data.sort((a, b) => (a.state || '').localeCompare(b.state || ''));
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchOpsDashboard() {
    loadingOps = true;
    try {
      const [servicesData, runtimeData, packagesData, summary] = await Promise.all([
        fetchServiceStatus(),
        fetchRuntimeApps(),
        fetchInstalledPackages(),
        fetchOpsSummary().catch(() => null)
      ]);
      serviceSnapshot = servicesData?.services || {};
      runtimeApps = Array.isArray(runtimeData?.apps) ? runtimeData.apps : [];
      installedPackages = Array.isArray(packagesData?.packages) ? packagesData.packages : [];
      opsSummary = summary && typeof summary === 'object' ? summary : null;
      opsRecentErrors = Array.isArray(summary?.logs?.recentErrors) ? summary.logs.recentErrors : [];
    } catch (err) {
      console.error(err);
      serviceSnapshot = {};
      runtimeApps = [];
      installedPackages = [];
      opsSummary = null;
      opsRecentErrors = [];
    } finally {
      loadingOps = false;
    }
  }

  function summarizeServiceStatus() {
    const values = Object.values(serviceSnapshot || {});
    const statuses = values.map((item) => normalizeOpsStatus(item?.status));
    return {
      total: values.length,
      running: statuses.filter((status) => status === 'running').length,
      error: statuses.filter((status) => status === 'failed').length
    };
  }

  function summarizeRuntimeStatus() {
    const statuses = runtimeApps.map((item) => normalizeOpsStatus(item?.status));
    return {
      total: runtimeApps.length,
      running: statuses.filter((status) => status === 'running').length,
      error: statuses.filter((status) => status === 'failed').length
    };
  }

  function openOpsApp(app) {
    openWindow({
      id: app.id,
      title: app.title,
      icon: app.icon,
      singleton: true
    });
  }

  onMount(() => {
    fetchStats();
    fetchIps();
    fetchDiagnostics();
    fetchOpsDashboard();
    interval = setInterval(() => {
      fetchStats();
      fetchProcesses();
      fetchConnections();
      if (activeTab === 'ops' || activeTab === 'all') {
        fetchOpsDashboard();
      }
    }, 1000);
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

  let networkChartData = $derived({
    labels: labels,
    datasets: [
      {
        label: 'RX (MB/s)', fill: true, lineTension: 0.4,
        backgroundColor: 'rgba(46, 160, 67, 0.1)', borderColor: '#7ee787',
        pointRadius: 0, pointHitRadius: 10, data: rxHistory,
      },
      {
        label: 'TX (MB/s)', fill: true, lineTension: 0.4,
        backgroundColor: 'rgba(88, 166, 255, 0.1)', borderColor: '#58a6ff',
        pointRadius: 0, pointHitRadius: 10, data: txHistory,
      }
    ],
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
            <div class="temp-line">Temp {status.cpuTemp.main}°C</div>
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
                  <div class="detail-row"><span class="temp">Temp {g.temperatureGpu}°C</span></div>
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
                  <div class="detail-row down">Down {(n.rx_sec / 1024 / 1024).toFixed(2)} MB/s</div>
                  <div class="detail-row up">Up {(n.tx_sec / 1024 / 1024).toFixed(2)} MB/s</div>
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
            <div class="temp">Temp {status.cpuTemp.main}°C</div>
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
              <div class="temp">Temp {g.temperatureGpu}°C</div>
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
      <div class="header-with-action">
        <div class="section-title">Storage & Health</div>
        <button class="refresh-btn" onclick={fetchDiagnostics} disabled={loadingDiagnostics}>
          <RotateCcw size={14} class={loadingDiagnostics ? 'spin' : ''} />
          <span>Refresh S.M.A.R.T</span>
        </button>
      </div>

      <div class="diagnostics-grid">
        {#each storageDiagnostics as diag}
          <div class="card glass-effect diag-card {diag.status}">
            <div class="diag-header">
              <span class="model">{diag.model || 'Unknown Disk'}</span>
              <span class="status-badge">{diag.status.toUpperCase()}</span>
            </div>
            {#if diag.smart}
              <div class="diag-metrics">
                <div class="metric">
                  <span class="label">Temperature</span>
                  <span class="value">{diag.smart.temperature ?? '--'} °C</span>
                </div>
                <div class="metric">
                  <span class="label">Life Remaining</span>
                  <span class="value">{diag.smart.percentage_used != null ? (100 - diag.smart.percentage_used) + '%' : '--'}</span>
                </div>
                <div class="metric">
                  <span class="label">Power Hours</span>
                  <span class="value">{diag.smart.power_on_hours ?? '--'} h</span>
                </div>
              </div>
            {:else}
              <div class="diag-error">{diag.error || 'No S.M.A.R.T data available'}</div>
            {/if}
          </div>
        {/each}
      </div>

      <div class="section-title" style="margin-top: 24px;">Mounted Partitions</div>
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
        <div class="chart-area" style="height: 160px; margin-bottom: 12px;">
          <Line data={networkChartData} options={chartOptions} />
        </div>
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
      
      <div class="header-with-action" style="margin-top: 24px;">
        <div class="section-title">Active Connections</div>
      </div>
      <div class="card glass-effect proc-card">
        <table class="proc-table">
          <thead>
            <tr>
              <th>Protocol</th>
              <th>Local IP:Port</th>
              <th>Remote IP:Port</th>
              <th>State</th>
              <th>PID</th>
            </tr>
          </thead>
          <tbody>
            {#each connections as c}
              <tr>
                <td class="name">{c.protocol}</td>
                <td class="user">{c.localAddress}:{c.localPort}</td>
                <td class="user">{c.peerAddress}:{c.peerPort}</td>
                <td class="user">{c.state || '-'}</td>
                <td class="pid">{c.pid || '-'}</td>
              </tr>
            {:else}
              <tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 20px;">Fetching connections...</td></tr>
            {/each}
          </tbody>
        </table>
      </div>

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

    {:else if activeTab === 'processes'}
      <div class="header-with-action">
        <div class="section-title">Running Processes</div>
        <div class="stats">Top 50 by CPU</div>
      </div>
      <div class="card glass-effect proc-card">
        <table class="proc-table">
          <thead>
            <tr>
              <th>PID</th>
              <th>Name</th>
              <th>User</th>
              <th class="num">CPU %</th>
              <th class="num">Memory</th>
            </tr>
          </thead>
          <tbody>
            {#each processes as p}
              <tr>
                <td class="pid">{p.pid}</td>
                <td class="name" title={p.command}>{p.name}</td>
                <td class="user">{p.user || '-'}</td>
                <td class="num {(p.cpu > 10) ? 'high' : ''}">{p.cpu.toFixed(1)}%</td>
                <td class="num">{(p.memRss / 1024).toFixed(1)} MB</td>
              </tr>
            {:else}
              <tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 20px;">Fetching processes...</td></tr>
            {/each}
          </tbody>
        </table>
      </div>

    {:else if activeTab === 'ops'}
      <div class="header-with-action">
        <div class="section-title">Service / Runtime / Package Dashboard</div>
        <button class="refresh-btn" onclick={fetchOpsDashboard} disabled={loadingOps}>
          <RotateCcw size={14} class={loadingOps ? 'spin' : ''} />
          <span>Refresh Ops</span>
        </button>
      </div>
      <div class="ops-quick-actions">
        {#each opsQuickActions as app}
          {@const ActionIcon = app.icon}
          <button class="ops-action-btn" onclick={() => openOpsApp(app)} title={`Open ${app.title}`}>
            <ActionIcon size={14} />
            <span>{app.title}</span>
          </button>
        {/each}
      </div>

      {@const serviceSummary = summarizeServiceStatus()}
      {@const runtimeSummary = summarizeRuntimeStatus()}
      <div class="overview-grid">
        <div class="card glass-effect">
          <h3>Services</h3>
          <div class="value">{serviceSummary.running}/{serviceSummary.total}</div>
          <div class="stats">Errors: {serviceSummary.error}</div>
        </div>
        <div class="card glass-effect">
          <h3>Runtime Apps</h3>
          <div class="value">{runtimeSummary.running}/{runtimeSummary.total}</div>
          <div class="stats">Errors: {runtimeSummary.error}</div>
        </div>
        <div class="card glass-effect">
          <h3>Installed Packages</h3>
          <div class="value">{installedPackages.length}</div>
          <div class="stats">Lifecycle-managed inventory</div>
        </div>
        <div class="card glass-effect">
          <h3>Recent Errors</h3>
          <div class="value">{opsSummary?.logs?.recentErrorCount ?? 0}</div>
          <div class="stats">Warnings: {opsSummary?.logs?.recentWarningCount ?? 0}</div>
        </div>
      </div>

      <div class="card glass-effect proc-card">
        <table class="proc-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Status</th>
              <th class="num">Uptime</th>
            </tr>
          </thead>
          <tbody>
            {#each Object.entries(serviceSnapshot) as [name, svc]}
              <tr>
                <td class="name">{name}</td>
                <td><span class="status-badge {normalizeOpsStatus(svc?.status)}">{normalizeOpsStatus(svc?.status)}</span></td>
                <td class="num">{Math.floor((svc?.uptimeMs || 0) / 1000)}s</td>
              </tr>
            {:else}
              <tr><td colspan="3" style="text-align: center; color: var(--text-dim); padding: 20px;">No service data.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="card glass-effect proc-card">
        <table class="proc-table">
          <thead>
            <tr>
              <th>Runtime App</th>
              <th>Status</th>
              <th class="num">PID</th>
            </tr>
          </thead>
          <tbody>
            {#each runtimeApps as app}
              <tr>
                <td class="name">{app?.appId || '-'}</td>
                <td><span class="status-badge {normalizeOpsStatus(app?.status)}">{normalizeOpsStatus(app?.status)}</span></td>
                <td class="num">{app?.pid || '-'}</td>
              </tr>
            {:else}
              <tr><td colspan="3" style="text-align: center; color: var(--text-dim); padding: 20px;">No runtime app data.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="card glass-effect proc-card">
        <table class="proc-table">
          <thead>
            <tr>
              <th>Recent Error</th>
              <th class="num">Time</th>
            </tr>
          </thead>
          <tbody>
            {#each opsRecentErrors as entry}
              <tr>
                <td class="name">{entry?.action || entry?.message || '-'}</td>
                <td class="num">{entry?.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '-'}</td>
              </tr>
            {:else}
              <tr><td colspan="2" style="text-align: center; color: var(--text-dim); padding: 20px;">No recent errors.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
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
  
  .header-with-action { display: flex; justify-content: space-between; align-items: center; }
  .refresh-btn { background: rgba(88, 166, 255, 0.15); border: 1px solid var(--glass-border); color: var(--accent-blue); padding: 6px 12px; border-radius: 6px; display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; transition: all 0.2s; }
  .refresh-btn:hover { background: rgba(88, 166, 255, 0.25); color: white; }
  .ops-quick-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .ops-action-btn {
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--glass-border);
    color: var(--text-main);
    padding: 6px 10px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
    transition: background 0.2s ease, border-color 0.2s ease;
  }
  .ops-action-btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.25); }
  
  .diagnostics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; margin-top: 12px; }
  .diag-card { border-left: 4px solid var(--glass-border); }
  .diag-card.healthy { border-left-color: var(--accent-green); }
  .diag-card.warning { border-left-color: var(--accent-red); }
  .diag-card.unknown { border-left-color: var(--text-dim); }
  
  .diag-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .diag-header .model { font-size: 14px; font-weight: 600; }
  .status-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.1); }
  .healthy .status-badge { background: rgba(46, 160, 67, 0.2); color: #7ee787; }
  .warning .status-badge { background: rgba(219, 109, 40, 0.2); color: #ffa657; }
  .status-badge.running { background: rgba(46, 160, 67, 0.2); color: #7ee787; }
  .status-badge.failed { background: rgba(219, 109, 40, 0.2); color: #ffa657; }
  .status-badge.stopped { background: rgba(255,255,255,0.1); color: var(--text-dim); }
  
  .diag-metrics { display: flex; flex-direction: column; gap: 6px; }
  .metric { display: flex; justify-content: space-between; font-size: 12px; }
  .metric .label { color: var(--text-dim); }
  .metric .value { font-weight: 600; color: white; }
  .diag-error { font-size: 11px; color: var(--text-dim); font-style: italic; }

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
  .ip-row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
  .ip-row .label { color: var(--text-dim); }
  .ip-row .value { color: var(--text-main); font-family: monospace; font-weight: 500; }
  .refresh-mini { background: transparent; border: none; color: var(--accent-blue); cursor: pointer; display: flex; align-items: center; padding: 2px; border-radius: 4px; }
  .refresh-mini:hover { background: rgba(255,255,255,0.1); }
  .refresh-mini:disabled { opacity: 0.5; cursor: not-allowed; }
  
  .proc-card { padding: 0; overflow: hidden; background: rgba(0,0,0,0.2); }
  .proc-table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
  .proc-table th { background: rgba(255,255,255,0.05); padding: 10px 16px; font-weight: 600; color: var(--text-dim); position: sticky; top: 0; z-index: 10; border-bottom: 1px solid var(--glass-border); }
  .proc-table td { padding: 8px 16px; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .proc-table tbody tr:hover { background: rgba(255,255,255,0.05); }
  .proc-table .num { text-align: right; }
  .proc-table .high { color: var(--accent-red); font-weight: 600; }
  .proc-table .pid { color: var(--text-dim); font-family: monospace; }
  .proc-table .name { font-weight: 500; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .proc-table .user { color: var(--text-dim); }
  
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  :global(.spin) { animation: spin 1s linear infinite; }
</style>
