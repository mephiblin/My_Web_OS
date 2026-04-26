<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { Loader, Shield } from 'lucide-svelte';
  import { Terminal } from 'xterm';
  import { FitAddon } from 'xterm-addon-fit';
  import 'xterm/css/xterm.css';
  import { createTerminalSessionClient } from './services/terminalSessionClient.js';

  let {
    active = false,
    sessionId = '',
    pendingInput = null,
    resizeSignal = 0,
    onStateChange = () => {}
  } = $props();

  let terminalElement;
  let term;
  let fitAddon;
  let resizeHandler;
  let terminalSession;
  let terminalReady = $state(false);
  let terminalStarting = $state(false);
  let terminalError = $state('');
  let sessionPreflight = $state(null);
  let typedConfirmation = $state('');
  let lastPendingInputId = '';
  let queuedInputText = '';

  function emitParentState() {
    onStateChange(sessionId, {
      ready: terminalReady,
      starting: terminalStarting,
      error: terminalError,
      hasPreflight: Boolean(sessionPreflight)
    });
  }

  function syncTerminalState(nextState = {}) {
    const previousPreflight = sessionPreflight;
    terminalReady = nextState.initialized === true;
    terminalStarting = nextState.sessionStarting === true;
    terminalError = nextState.sessionError || '';
    sessionPreflight = nextState.sessionPreflight || null;
    if (sessionPreflight !== previousPreflight) {
      typedConfirmation = '';
    }
    emitParentState();
  }

  function requestSessionPreflight() {
    typedConfirmation = '';
    terminalSession?.requestSessionPreflight();
  }

  function requestTerminalSession() {
    terminalSession?.requestSession();
  }

  function approveAndStartSession() {
    terminalSession?.approveAndStartSession(typedConfirmation);
  }

  function bindTerminalInput() {
    term.onData((data) => {
      terminalSession?.sendInput(data);
    });
  }

  async function initializeTerminal() {
    await tick();
    if (!terminalElement || term) return;
    term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#07101d',
        foreground: '#dce7f7',
        cursor: '#f8fafc',
        selectionBackground: '#294269'
      },
      fontSize: 13,
      fontFamily: '"D2Coding", "Noto Sans Mono CJK KR", "Noto Sans Mono", Menlo, Monaco, "Courier New", monospace',
      scrollback: 5000
    });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalElement);
    fitTerminal();
    terminalSession = createTerminalSessionClient({
      getTerminalSize: () => ({ cols: term?.cols || 80, rows: term?.rows || 24 }),
      write: (data) => term?.write(data),
      writeln: (data) => term?.writeln(data),
      onStateChange: syncTerminalState
    });
    bindTerminalInput();
    resizeHandler = () => fitTerminal();
    globalThis.addEventListener('resize', resizeHandler);
    requestTerminalSession();
  }

  function fitTerminal() {
    if (!fitAddon || !term) return;
    fitAddon.fit();
    terminalSession?.resize({ cols: term.cols, rows: term.rows });
  }

  $effect(() => {
    resizeSignal;
    if (active) {
      setTimeout(() => fitTerminal(), 0);
    }
  });

  $effect(() => {
    if (!pendingInput || pendingInput.id === lastPendingInputId) return;
    lastPendingInputId = pendingInput.id;
    if (pendingInput.targetSessionId && pendingInput.targetSessionId !== sessionId) return;
    const text = String(pendingInput.text || '');
    if (!terminalReady) {
      queuedInputText += text;
      return;
    }
    terminalSession?.sendInput(text);
  });

  $effect(() => {
    if (!terminalReady || !queuedInputText) return;
    const text = queuedInputText;
    queuedInputText = '';
    terminalSession?.sendInput(text);
  });

  onMount(() => {
    initializeTerminal();
  });

  onDestroy(() => {
    if (resizeHandler) globalThis.removeEventListener('resize', resizeHandler);
    terminalSession?.disconnect();
    if (term) term.dispose();
  });
</script>

<div class:active class="shell-session">
  <div bind:this={terminalElement} class="xterm-host"></div>
  {#if !terminalReady}
    <div class="session-gate">
      <div class="approval-card">
        <Shield size={22} />
        <h2>Start Terminal Session</h2>
        <p>Opens a real local shell on this host. Commands can change real files and services.</p>
        {#if sessionPreflight}
          <dl>
            <div><dt>Action</dt><dd>{sessionPreflight.action}</dd></div>
            <div><dt>Target</dt><dd>{sessionPreflight.target?.label || sessionPreflight.target?.id || 'Terminal session'}</dd></div>
            <div><dt>Impact</dt><dd>{Array.isArray(sessionPreflight.impact) ? sessionPreflight.impact.join(' ') : sessionPreflight.impact}</dd></div>
          </dl>
          <label>
            <span>Type <code>{sessionPreflight.approval?.typedConfirmation}</code> to approve</span>
            <input bind:value={typedConfirmation} autocomplete="off" spellcheck="false" />
          </label>
          <div class="dialog-actions">
            <button class="ghost" onclick={requestSessionPreflight} disabled={terminalStarting}>Refresh</button>
            <button
              class="primary"
              onclick={approveAndStartSession}
              disabled={terminalStarting || typedConfirmation !== sessionPreflight.approval?.typedConfirmation}
            >
              {#if terminalStarting}<Loader size={15} class="spin" />{/if}
              Start Shell
            </button>
          </div>
        {:else}
          <p class="session-progress">
            {terminalStarting ? 'Preparing terminal approval...' : 'Terminal approval is not ready yet.'}
          </p>
          <button class="primary" onclick={requestTerminalSession} disabled={terminalStarting}>
            {#if terminalStarting}<Loader size={15} class="spin" />{/if}
            Retry Approval Request
          </button>
        {/if}
        {#if terminalError}<p class="error-text">{terminalError}</p>{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .shell-session {
    display: none;
    position: relative;
    min-height: 0;
    height: 100%;
  }

  .shell-session.active {
    display: block;
  }

  .xterm-host {
    height: 100%;
    width: 100%;
    padding: 14px 16px;
    box-sizing: border-box;
  }

  :global(.nexus-term .xterm) {
    height: 100%;
  }

  .session-gate {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(4, 9, 18, 0.72);
    z-index: 5;
  }

  .approval-card {
    width: min(460px, 94%);
    border: 1px solid rgba(122, 162, 247, 0.3);
    background: rgba(8, 18, 34, 0.94);
    border-radius: 8px;
    padding: 22px;
    box-shadow: 0 18px 58px rgba(0, 0, 0, 0.42);
  }

  .approval-card h2 {
    margin: 12px 0 8px;
    font-size: 18px;
  }

  .approval-card p {
    color: var(--muted);
    line-height: 1.5;
  }

  button, input {
    font: inherit;
  }

  button {
    min-height: 34px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: rgba(15, 28, 50, 0.78);
    color: var(--text);
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .primary {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #f8fbff;
    border-color: transparent;
    padding: 0 13px;
    font-weight: 700;
  }

  .ghost {
    padding: 0 13px;
  }

  .dialog-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-end;
  }

  dl {
    display: grid;
    gap: 8px;
    margin: 12px 0;
  }

  dl div {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 10px;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  label {
    display: grid;
    gap: 8px;
    margin: 12px 0;
  }

  input {
    background: #070f1c;
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 9px 10px;
    min-width: 0;
  }

  .session-progress {
    color: var(--muted);
    margin: 10px 0 12px;
  }

  .error-text {
    color: var(--danger);
  }
</style>
