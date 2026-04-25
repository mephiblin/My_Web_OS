<script>
  import CodeEditorApp from './components/CodeEditorApp.svelte';

  let { data = { path: '', content: '' } } = $props();
</script>

<CodeEditorApp {data} />
