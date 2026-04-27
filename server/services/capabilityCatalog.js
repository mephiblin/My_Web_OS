const CAPABILITY_CATALOG = Object.freeze([
  {
    id: 'app.data.list',
    category: 'storage',
    risk: 'low',
    summary: 'List files and directories in the package-owned data root.'
  },
  {
    id: 'app.data.read',
    category: 'storage',
    risk: 'low',
    summary: 'Read files from the package-owned data root.'
  },
  {
    id: 'app.data.write',
    category: 'storage',
    risk: 'medium',
    summary: 'Write files to the package-owned data root.'
  },
  {
    id: 'host.file.read',
    category: 'host-files',
    risk: 'medium',
    summary: 'Read a user-selected host file through a temporary File Station grant.'
  },
  {
    id: 'host.file.write',
    category: 'host-files',
    risk: 'high',
    summary: 'Write a user-selected host file through a temporary File Station grant and explicit overwrite approval.'
  },
  {
    id: 'ui.notification',
    category: 'ui',
    risk: 'low',
    summary: 'Display user-visible notifications.'
  },
  {
    id: 'window.open',
    category: 'ui',
    risk: 'medium',
    summary: 'Open another desktop app window.'
  },
  {
    id: 'system.info',
    category: 'system',
    risk: 'medium',
    summary: 'Read system overview metrics exposed by the gateway.'
  },
  {
    id: 'runtime.process',
    category: 'runtime',
    risk: 'high',
    summary: 'Run a managed local process for a trusted tool package.'
  },
  {
    id: 'service.bridge',
    category: 'runtime',
    risk: 'high',
    summary: 'Allow sandbox UI to call its paired local package service.'
  },
  {
    id: 'host.allowedRoots.read',
    category: 'host-files',
    risk: 'high',
    summary: 'Read from globally configured allowed host roots through a trusted process package.'
  },
  {
    id: 'host.allowedRoots.write',
    category: 'host-files',
    risk: 'high',
    summary: 'Write to globally configured allowed host roots through a trusted process package.'
  },
  {
    id: 'network.outbound',
    category: 'network',
    risk: 'high',
    summary: 'Allow a trusted process package to make outbound network requests.'
  }
]);

module.exports = {
  CAPABILITY_CATALOG
};
