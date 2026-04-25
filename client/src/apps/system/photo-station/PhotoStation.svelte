<script>
  import StationShell from '../station/StationShell.svelte';
</script>

<StationShell
  title="Photo Station"
  subtitle="Browse image libraries from allowed roots."
  extensions={['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'heif']}
  launchAppId="player"
  launchTitle="Media Player"
/>
