<script>
  import { onMount, onDestroy } from 'svelte';
  import { RotateCcw, Search, Shield, Files, Monitor, AlertCircle, Info, Filter, LayoutDashboard, AlertTriangle, XCircle, Clock } from 'lucide-svelte';
  import { fetchLogs } from './api.js';
  import { Line } from 'svelte-chartjs';
  import {
    Chart as ChartJS,
    Title as CTitle,
    Tooltip,
    Legend,
    LineElement,
    LinearScale,
    PointElement,
    CategoryScale,
  } from 'chart.js';

  ChartJS.register(CTitle, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale);

  let logs = $state([]);
  let allLogs = $state([]); // For overview stats
  let loading = $state(true);
  let activeTab = $state('OVERVIEW'); // OVERVIEW, SYSTEM, CONNECTION, FILE_TRANSFER
  let searchQuery = $state('');
  let levelFilter = $state('ALL');
  let interval;

  const categories = [
    { id: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
    { id: 'SYSTEM', label: 'General', icon: Monitor },
    { id: 'CONNECTION', label: 'Connection', icon: Shield },
    { id: 'FILE_TRANSFER', label: 'File Transfer', icon: Files },
  ];

  async function loadLogs() {
    try {
      const data = await fetchLogs({ 
        category: activeTab === 'OVERVIEW' ? 'ALL' : activeTab,
        level: levelFilter,
        search: searchQuery,
        limit: 200
      });
      logs = data;

      // If we are on Overview, fetch all for charts
      if (activeTab === 'OVERVIEW') {
        allLogs = data;
      }
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      loading = false;
    }
  }

  function getLevelIcon(level) {
    if (level === 'ERROR') return XCircle;
    if (level === 'WARNING') return AlertTriangle;
    return Info;
  }

  function getLevelColor(level) {
    if (level === 'ERROR') return '#ef4444';
    if (level === 'WARNING') return '#f59e0b';
    return '#3b82f6';
  }

  // Chart Logic
  const chartData = $derived(() => {
    const last7Days = Array.from({length: 7}, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toLocaleDateString();
    });

    const counts = last7Days.map(date => {
      return allLogs.filter(l => new Date(l.timestamp).toLocaleDateString() === date).length;
    });

    return {
      labels: last7Days,
      datasets: [{
        label: 'Daily Activity',
        data: counts,
        fill: true,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
        pointBackgroundColor: '#3b82f6'
      }]
    };
  });

  const stats = $derived(() => {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recent = allLogs.filter(l => new Date(l.timestamp) > last24h);
    
    return {
      total24: recent.length,
      errors24: recent.filter(l => l.level === 'ERROR').length,
      warnings24: recent.filter(l => l.level === 'WARNING').length
    };
  });

  onMount(() => {
    loadLogs();
    interval = setInterval(loadLogs, 5000);
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });

  $effect(() => {
    loadLogs();
  });
</script>

<div class="log-viewer glass-effect">
  <!-- Sidebar -->
  <div class="sidebar">
    <div class="sidebar-header">Log Center</div>
    <div class="nav-group">
      {#each categories as cat}
        <button 
          class="nav-item" 
          class:active={activeTab === cat.id}
          onclick={() => { activeTab = cat.id; searchQuery = ''; levelFilter = 'ALL'; }}
        >
          <svelte:component this={cat.icon} size={16} />
          <span>{cat.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="main-content">
    {#if activeTab === 'OVERVIEW'}
      <div class="dashboard-view scrollbar">
        <div class="header">
          <h1>Log Overview</h1>
          <button class="refresh-btn" onclick={loadLogs} title="Refresh Data">
            <RotateCcw size={16} class={loading ? 'spin' : ''} />
          </button>
        </div>

        <div class="stats-grid">
          <div class="stat-card blue">
            <div class="stat-val">{stats().total24}</div>
            <div class="stat-label">Total Events (24h)</div>
            <Clock size={24} class="stat-icon" />
          </div>
          <div class="stat-card orange">
            <div class="stat-val">{stats().warnings24}</div>
            <div class="stat-label">Warnings (24h)</div>
            <AlertTriangle size={24} class="stat-icon" />
          </div>
          <div class="stat-card red">
            <div class="stat-val">{stats().errors24}</div>
            <div class="stat-label">Critical Errors (24h)</div>
            <XCircle size={24} class="stat-icon" />
          </div>
        </div>

        <div class="chart-section glass-card">
          <div class="section-title">Log Activity Distribution</div>
          <div class="chart-container">
            <Line data={chartData()} options={{ 
              responsive: true, 
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b949e' } },
                x: { grid: { display: false }, ticks: { color: '#8b949e' } }
              }
            }} />
          </div>
        </div>
      </div>
    {:else}
      <div class="log-list-view">
        <div class="toolbar">
          <div class="search-bar">
            <Search size={14} />
            <input type="text" placeholder="Search logs..." bind:value={searchQuery} />
          </div>
          
          <select bind:value={levelFilter} class="filter-select">
            <option value="ALL">All Levels</option>
            <option value="INFO">Information</option>
            <option value="WARNING">Warning</option>
            <option value="ERROR">Error</option>
          </select>

          <button class="refresh-btn" onclick={loadLogs}>
            <RotateCcw size={14} class={loading ? 'spin' : ''} />
          </button>
        </div>

        <div class="log-table-container scrollbar">
          <table class="log-table">
            <thead>
              <tr>
                <th width="40">LV</th>
                <th width="160">Time</th>
                <th width="100">User</th>
                <th>Event Message</th>
              </tr>
            </thead>
            <tbody>
              {#each logs as log}
                <tr class="log-row {log.level.toLowerCase()}">
                  <td class="cell-level">
                    <svelte:component this={getLevelIcon(log.level)} size={14} color={getLevelColor(log.level)} />
                  </td>
                  <td class="cell-time">{new Date(log.timestamp).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                  <td class="cell-user">{log.user || 'system'}</td>
                  <td class="cell-action">
                    <div class="action-text">{log.action}</div>
                    {#if log.path || log.oldPath}
                      <div class="action-sub">{log.path || `${log.oldPath} → ${log.newPath}`}</div>
                    {/if}
                  </td>
                </tr>
              {/each}
              {#if logs.length === 0}
                <tr><td colspan="4" class="empty-row">No logs found matching criteria.</td></tr>
              {/if}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .log-viewer { display: flex; height: 100%; color: var(--text-main); overflow: hidden; }
  
  /* Sidebar */
  .sidebar { width: 220px; background: rgba(15, 20, 30, 0.4); border-right: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; }
  .sidebar-header { padding: 24px; font-weight: 700; font-size: 16px; color: white; letter-spacing: -0.5px; }
  .nav-group { padding: 0 12px; display: flex; flex-direction: column; gap: 4px; }
  .nav-item { background: transparent; border: none; color: rgba(255,255,255,0.6); display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 8px; cursor: pointer; transition: all 0.2s; font-size: 13px; text-align: left; }
  .nav-item:hover { background: rgba(255,255,255,0.05); color: white; }
  .nav-item.active { background: var(--accent-blue); color: white; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); }

  /* Main Content */
  .main-content { flex: 1; display: flex; flex-direction: column; background: rgba(10, 15, 25, 0.2); overflow: hidden; }

  /* Dashboard View */
  .dashboard-view { flex: 1; padding: 32px; overflow-y: auto; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .header h1 { font-size: 22px; margin: 0; font-weight: 700; }
  
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 32px; }
  .stat-card { position: relative; padding: 24px; border-radius: 16px; overflow: hidden; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.05); }
  .stat-val { font-size: 28px; font-weight: 800; margin-bottom: 4px; }
  .stat-label { font-size: 12px; color: rgba(255,255,255,0.5); font-weight: 600; text-transform: uppercase; }
  .stat-icon { position: absolute; top: 20px; right: 20px; opacity: 0.15; }
  .stat-card.blue { border-left: 4px solid #3b82f6; }
  .stat-card.orange { border-left: 4px solid #f59e0b; }
  .stat-card.red { border-left: 4px solid #ef4444; }

  .chart-section { padding: 24px; border-radius: 16px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); }
  .section-title { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.7); margin-bottom: 20px; }
  .chart-container { height: 280px; }

  /* Log List View */
  .log-list-view { display: flex; flex-direction: column; height: 100%; }
  .toolbar { padding: 16px 24px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; gap: 12px; align-items: center; background: rgba(0,0,0,0.1); }
  .search-bar { flex: 1; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 0 12px; display: flex; align-items: center; gap: 10px; border: 1px solid rgba(255,255,255,0.1); }
  .search-bar input { background: transparent; border: none; color: white; padding: 8px 0; font-size: 13px; outline: none; flex: 1; }
  .filter-select { background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 7px 12px; font-size: 13px; outline: none; }

  .log-table-container { flex: 1; overflow-y: auto; }
  .log-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .log-table th { position: sticky; top: 0; background: rgba(20, 25, 35, 0.9); z-index: 10; text-align: left; padding: 12px 16px; color: rgba(255,255,255,0.4); font-size: 11px; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .log-row { border-bottom: 1px solid rgba(255,255,255,0.03); transition: background 0.1s; }
  .log-row:hover { background: rgba(255,255,255,0.04); }
  .log-table td { padding: 12px 16px; vertical-align: middle; }
  .cell-time { color: rgba(255,255,255,0.5); font-weight: 500; font-variant-numeric: tabular-nums; }
  .cell-user { font-weight: 600; color: #3b82f6; }
  .action-text { font-weight: 500; margin-bottom: 2px; }
  .action-sub { font-size: 11px; color: rgba(255,255,255,0.3); font-family: monospace; }
  .empty-row { text-align: center; padding: 40px; color: rgba(255,255,255,0.3); font-style: italic; }

  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  .scrollbar::-webkit-scrollbar { width: 6px; }
  .scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
</style>
