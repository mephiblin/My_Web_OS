<script>
  import { onMount, onDestroy } from 'svelte';
  import * as monaco from 'monaco-editor';
  import { Save } from 'lucide-svelte';
  import { addToast } from '../../../core/stores/toastStore.js';
  import * as editorApi from './api.js';

  let { data = { path: '', content: '' } } = $props();

  let editorContainer;
  let editor;

  function getPackageFileContext() {
    const ctx = data?.packageFile;
    if (!ctx || typeof ctx !== 'object') return null;
    const appId = String(ctx.appId || '').trim();
    const path = String(ctx.path || '').trim();
    if (!appId || !path) return null;
    return { appId, path };
  }

  function getActiveTarget() {
    const packageCtx = getPackageFileContext();
    if (packageCtx) {
      return {
        mode: 'package',
        appId: packageCtx.appId,
        path: packageCtx.path
      };
    }

    const path = String(data?.path || '').trim();
    if (!path) return null;
    return {
      mode: 'host',
      path
    };
  }

  function applyLanguageByPath(path) {
    if (!editor || !editor.getModel()) return;
    const ext = String(path || '').split('.').pop();
    const langMap = {
      js: 'javascript',
      py: 'python',
      json: 'json',
      html: 'html',
      css: 'css',
      md: 'markdown',
      ts: 'typescript',
      svelte: 'html'
    };
    monaco.editor.setModelLanguage(editor.getModel(), langMap[ext] || 'plaintext');
  }

  async function loadFile() {
    if (!editor) return;
    const target = getActiveTarget();
    if (!target?.path) return;

    try {
      const result = target.mode === 'package'
        ? await editorApi.readPackageFile(target.appId, target.path)
        : await editorApi.readFile(target.path);
      const content = target.mode === 'package' ? result?.file?.content : result?.content;
      if (content !== undefined) {
        editor.setValue(String(content));
        applyLanguageByPath(target.path);
      }
    } catch (err) {
      addToast(err?.message || 'Failed to load file', 'error');
      console.error(err);
    }
  }

  async function saveFile() {
    if (!editor) return;
    const target = getActiveTarget();
    if (!target?.path) return;

    try {
      const result = target.mode === 'package'
        ? await editorApi.savePackageFile(target.appId, target.path, editor.getValue())
        : await editorApi.saveFile(target.path, editor.getValue());
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
    const hostPath = data?.path;
    const packageAppId = data?.packageFile?.appId;
    const packagePath = data?.packageFile?.path;
    if ((hostPath || (packageAppId && packagePath)) && editor) {
      loadFile();
    }
  });
</script>

<div class="editor-wrapper">
  <div class="toolbar">
    <span class="file-path">
      {#if getActiveTarget()?.mode === 'package'}
        [{getActiveTarget()?.appId}] {getActiveTarget()?.path}
      {:else}
        {getActiveTarget()?.path || ''}
      {/if}
    </span>
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

