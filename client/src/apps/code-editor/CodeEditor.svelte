<script>
  import { onMount, onDestroy } from 'svelte';
  import * as monaco from 'monaco-editor';
  import { Save } from 'lucide-svelte';
  import { addToast } from '../../core/stores/toastStore.js';
  import * as editorApi from './api.js';

  let { data = { path: '', content: '' } } = $props();

  let editorContainer;
  let editor;

  async function loadFile() {
    if (!data?.path || !editor) return;
    try {
      const result = await editorApi.readFile(data.path);
      if (result.content !== undefined) {
        editor.setValue(result.content);
        const ext = data.path.split('.').pop();
        const langMap = { js: 'javascript', py: 'python', json: 'json', html: 'html', css: 'css', md: 'markdown', ts: 'typescript', svelte: 'html' };
        monaco.editor.setModelLanguage(editor.getModel(), langMap[ext] || 'plaintext');
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function saveFile() {
    if (!data?.path || !editor) return;
    try {
      const result = await editorApi.saveFile(data.path, editor.getValue());
      if (result.success || !result.error) {
        addToast('File saved successfully!', 'success');
      } else {
        addToast(result.message || 'Error saving file', 'error');
      }
    } catch (err) {
      addToast('Server connection failed', 'error');
      console.error(err);
    }
  }

  onMount(() => {
    editor = monaco.editor.create(editorContainer, {
      value: '',
      language: 'plaintext',
      theme: 'vs-dark',
      automaticLayout: true,
      fontSize: 14,
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveFile();
    });

    loadFile();
  });

  onDestroy(() => {
    if (editor) editor.dispose();
  });

  $effect(() => {
    if (data?.path && editor) {
      loadFile();
    }
  });
</script>

<div class="editor-wrapper">
  <div class="toolbar">
    <span class="file-path">{data?.path || ''}</span>
    <button onclick={saveFile} class="save-btn">
      <Save size={16} /> Save
    </button>
  </div>
  <div class="editor-container" bind:this={editorContainer}></div>
</div>

<style>
  .editor-wrapper { display: flex; flex-direction: column; height: 100%; background: #1e1e1e; }
  .toolbar { height: 36px; background: #252526; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid #333; }
  .file-path { font-size: 12px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .save-btn { background: var(--accent-blue); border: none; color: white; padding: 2px 10px; border-radius: 4px; font-size: 12px; display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .editor-container { flex: 1; width: 100%; }
</style>
