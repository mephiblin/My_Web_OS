<script>
  import StationShell from '../station/StationShell.svelte';
</script>

<StationShell
  title="Video Station"
  subtitle="Browse video libraries from allowed roots."
  extensions={['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v']}
  launchAppId="player"
  launchTitle="Media Player"
/>
