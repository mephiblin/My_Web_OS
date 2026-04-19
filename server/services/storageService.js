const { exec } = require('child_process');
const si = require('systeminformation');

/**
 * Storage Service
 * Handles deep hardware diagnostics using smartctl.
 */
const storageService = {
  /**
   * Get deep diagnostics for all physical disks.
   */
  async getDiagnostics() {
    try {
      // 1. Get disk layout first to identify physical devices
      const disks = await si.diskLayout();
      const results = [];

      for (const disk of disks) {
        const device = disk.device;
        if (!device) continue;

        try {
          // Attempt to run smartctl --json
          // Note: On some systems, this may require sudo. 
          // We assume the environment is configured or we try without sudo first.
          const smartData = await this.runSmartctl(device);
          results.push({
            device,
            model: disk.name,
            vendor: disk.vendor,
            size: disk.size,
            smart: smartData,
            status: smartData.smart_status?.passed ? 'healthy' : (smartData.smart_status ? 'warning' : 'unknown')
          });
        } catch (err) {
          // Fallback if smartctl fails or is not installed
          results.push({
            device,
            model: disk.name,
            vendor: disk.vendor,
            size: disk.size,
            status: 'unknown',
            error: 'smartctl not available or permission denied'
          });
        }
      }

      return results;
    } catch (err) {
      console.error('[STORAGE] Diagnostics failed:', err);
      return [];
    }
  },

  /**
   * Executes smartctl and parses JSON.
   */
  runSmartctl(device) {
    return new Promise((resolve, reject) => {
      // Try with sudo first if possible, or just raw if in docker
      const cmd = `smartctl -a --json ${device}`;
      exec(cmd, (error, stdout, stderr) => {
        // smartctl returns non-zero exit codes for warnings, so we check stdout
        if (!stdout) return reject(new Error('No output from smartctl'));
        
        try {
          const json = JSON.parse(stdout);
          // Normalize some key metrics
          const diagnostics = {
            smart_status: json.smart_status,
            temperature: json.temperature?.current,
            power_on_hours: json.power_on_time?.hours,
            percentage_used: json.nvme_smart_health_information_log?.percentage_used,
            critical_warning: json.nvme_smart_health_information_log?.critical_warning,
            media_errors: json.nvme_smart_health_information_log?.media_errors,
            raw_data: json
          };
          resolve(diagnostics);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
};

module.exports = storageService;
