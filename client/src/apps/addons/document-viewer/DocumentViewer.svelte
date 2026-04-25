<script>
  import DocumentViewerApp from './components/DocumentViewerApp.svelte';

  let { data = {} } = $props();
</script>

<DocumentViewerApp {data} />
