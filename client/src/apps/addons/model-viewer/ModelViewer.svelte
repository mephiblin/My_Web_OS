<script>
  import ModelViewerApp from './components/ModelViewerApp.svelte';

  let { data = {} } = $props();
</script>

<ModelViewerApp {data} />
