const LANGUAGE_BY_EXTENSION = {
  js: 'javascript',
  py: 'python',
  json: 'json',
  html: 'html',
  css: 'css',
  md: 'markdown',
  ts: 'typescript',
  svelte: 'html',
  xml: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell'
};

export function detectLanguageByPath(path) {
  const ext = String(path || '').split('.').pop()?.toLowerCase() || '';
  return LANGUAGE_BY_EXTENSION[ext] || 'plaintext';
}
