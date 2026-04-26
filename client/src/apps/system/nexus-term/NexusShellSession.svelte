<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { Terminal } from 'xterm';
  import { FitAddon } from 'xterm-addon-fit';
  import 'xterm/css/xterm.css';
  import { createTerminalSessionClient } from './services/terminalSessionClient.js';

  let {
    active = false,
    sessionId = '',
    enabled = true,
    appAccessGrant = null,
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
  let sessionStartRequested = $state(false);
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
    terminalReady = nextState.initialized === true;
    terminalStarting = nextState.sessionStarting === true;
    terminalError = nextState.sessionError || '';
    sessionPreflight = nextState.sessionPreflight || null;
    if (terminalReady || terminalError) {
      sessionStartRequested = false;
    }
    emitParentState();
  }

  function requestTerminalSession() {
    if (sessionStartRequested || terminalReady) return;
    sessionStartRequested = true;
    terminalSession?.requestSession();
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
      getAppAccessGrant: () => appAccessGrant,
      onStateChange: syncTerminalState
    });
    bindTerminalInput();
    resizeHandler = () => fitTerminal();
    globalThis.addEventListener('resize', resizeHandler);
    if (enabled && appAccessGrant?.grantId) {
      requestTerminalSession();
    }
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
    enabled;
    appAccessGrant?.grantId;
    if (!enabled || !appAccessGrant?.grantId || !terminalSession || terminalReady || terminalStarting || sessionStartRequested) return;
    requestTerminalSession();
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
  {#if terminalError && enabled && !terminalReady}
    <div class="session-status">
      <div>
        <p>{terminalError}</p>
        <button onclick={requestTerminalSession} disabled={terminalStarting}>Retry Shell</button>
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

  .session-status {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(4, 9, 18, 0.72);
    z-index: 5;
  }

  .session-status > div {
    width: min(420px, 94%);
    border: 1px solid rgba(122, 162, 247, 0.3);
    background: rgba(8, 18, 34, 0.94);
    border-radius: 8px;
    padding: 16px;
    box-shadow: 0 18px 58px rgba(0, 0, 0, 0.42);
  }

  .session-status p {
    margin: 0 0 12px;
    color: var(--muted);
    line-height: 1.5;
  }

  button {
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

</style>
