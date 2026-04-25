<script>
  import StationShell from '../station/StationShell.svelte';
</script>

<StationShell
  title="Document Station"
  subtitle="Browse document libraries from allowed roots."
  extensions={['pdf', 'txt', 'md', 'markdown', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']}
  launchAppId="doc-viewer"
  launchTitle="Document Viewer"
/>
