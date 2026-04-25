<script>
  import StationShell from '../station/StationShell.svelte';
</script>

<StationShell
  title="Music Station"
  subtitle="Browse music libraries from allowed roots."
  extensions={['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus']}
  launchAppId="player"
  launchTitle="Media Player"
/>
