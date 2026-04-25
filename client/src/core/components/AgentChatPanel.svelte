<script>
  import { agentStore } from '../stores/agentStore.js';
  import { Send, X } from 'lucide-svelte';

  function onDraftInput(event) {
    agentStore.setDraft(event.currentTarget.value);
  }

  function send() {
    const draft = String($agentStore.draft || '').trim();
    if (!draft) return;
    agentStore.sendUserMessage(draft);
    agentStore.handleUserMessageFlow(draft);
  }

  function onDraftKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function onWrappedIntentInput(event) {
    agentStore.setWrappedIntentDraft(event.currentTarget.value);
  }

  function addWrappedStep() {
    agentStore.addWrappedPlannedAction($agentStore.wrappedMode?.intentDraft || '');
  }
</script>

<div class="chat-panel glass-effect">
  <div class="chat-header">
    <strong>Agent</strong>
    <button class="icon-btn" type="button" onclick={() => agentStore.closePanel()} aria-label="Close agent chat">
      <X size={14} />
    </button>
  </div>

  <div class="message-list">
    {#if $agentStore.messages.length === 0}
      <div class="empty">Start a conversation.</div>
    {:else}
      {#each $agentStore.messages as message (message.id)}
        <div class="message-row {message.role}">
          <div class="message-bubble {message.kind === 'approval' ? 'approval' : ''}">
            {#if message.content}
              <div>{message.content}</div>
            {/if}

            {#if message.kind === 'approval' && message.approval}
              <div class="approval-card">
                <div class="approval-title">{message.approval.title}</div>
                {#if message.approval.summary}
                  <div class="approval-summary">{message.approval.summary}</div>
                {/if}
                {#if message.approval.target}
                  <div class="approval-meta">Target: {message.approval.target}</div>
                {/if}
                {#if message.approval.impact}
                  <div class="approval-meta">Impact: {message.approval.impact}</div>
                {/if}
                {#if message.approval.reversibility}
                  <div class="approval-meta">Reversibility: {message.approval.reversibility}</div>
                {/if}
                {#if message.approval.recovery}
                  <div class="approval-meta">Recovery: {message.approval.recovery}</div>
                {/if}
                <div class="approval-meta">Risk Level: {String(message.approval.risk || 'medium').toUpperCase()}</div>
                {#if message.approval.runId}
                  <div class="approval-meta">Run: {message.approval.runId}</div>
                {/if}
                <div class="approval-status {message.approval.status}">
                  {String(message.approval.status || 'pending').toUpperCase()}
                </div>
                {#if message.approval.status === 'pending'}
                  <div class="approval-actions">
                    <button class="icon-btn send" type="button" onclick={() => agentStore.resolveApproval(message.id, 'approve')}>
                      Approve
                    </button>
                    <button class="icon-btn" type="button" onclick={() => agentStore.resolveApproval(message.id, 'reject')}>
                      Reject
                    </button>
                  </div>
                {/if}
              </div>
            {/if}

            {#if message.kind === 'result'}
              <div class="approval-card">
                <div class="approval-title">{message.meta?.resultTitle || 'Result'}</div>
                <div class="approval-summary">{message.meta?.note || message.content || ''}</div>
                <div class="approval-status {String(message.meta?.resultStatus || 'pending').toLowerCase()}">
                  {String(message.meta?.resultStatus || 'ok').toUpperCase()}
                </div>

                {#if Array.isArray(message.meta?.resultActions) && message.meta.resultActions.length > 0}
                  <div class="approval-actions">
                    {#each message.meta.resultActions as action}
                      <button
                        class="icon-btn send"
                        type="button"
                        disabled={action.status === 'running' || action.status === 'completed'}
                        onclick={() => agentStore.executeResultAction(message.id, action.id)}
                      >
                        {action.status === 'running'
                          ? 'Running...'
                          : action.status === 'completed'
                            ? 'Done'
                            : action.status === 'failed'
                              ? `${action.label} (Retry)`
                            : action.label}
                      </button>
                    {/each}
                  </div>
                {/if}

                {#if message.meta?.rawOutput}
                  <details>
                    <summary>Raw Output</summary>
                    <pre class="raw-output">{message.meta.rawOutput}</pre>
                  </details>
                {/if}

                {#if message.meta?.repeatableTask?.id}
                  <div class="approval-meta">
                    Task: {message.meta.repeatableTask.id} ({Array.isArray(message.meta.repeatableTask.steps) ? message.meta.repeatableTask.steps.length : 0} steps)
                  </div>
                {/if}

                {#if message.meta?.auditTrace?.actionId}
                  <div class="approval-meta">
                    Audit: {message.meta.auditTrace.actionId}
                    {#if message.meta.auditTrace.runId}
                      · Run {message.meta.auditTrace.runId}
                    {/if}
                    {#if message.meta.auditTrace.risk}
                      · {String(message.meta.auditTrace.risk || '').toUpperCase()}
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="composer">
    <textarea
      rows="2"
      placeholder="Type a message"
      value={$agentStore.draft}
      oninput={onDraftInput}
      onkeydown={onDraftKeydown}
    ></textarea>
    <button class="icon-btn send" type="button" onclick={send} aria-label="Send message">
      <Send size={14} />
    </button>
  </div>

  <div class="wrapped-mode">
    <div class="wrapped-head">
      <strong>Wrapped Assistant Mode</strong>
      <button class="icon-btn" type="button" onclick={() => agentStore.toggleWrappedMode()}>
        {$agentStore.wrappedMode?.enabled ? 'On' : 'Off'}
      </button>
    </div>

    {#if $agentStore.wrappedMode?.enabled}
      <div class="wrapped-builder">
        <input
          type="text"
          placeholder="Add planned action"
          value={$agentStore.wrappedMode?.intentDraft || ''}
          oninput={onWrappedIntentInput}
          onkeydown={(event) => event.key === 'Enter' && (event.preventDefault(), addWrappedStep())}
        />
        <button class="icon-btn send" type="button" onclick={addWrappedStep}>Add</button>
      </div>

      {#if !$agentStore.wrappedMode?.plannedActions?.length}
        <div class="empty">No planned actions yet.</div>
      {:else}
        <div class="wrapped-actions">
          {#each $agentStore.wrappedMode?.plannedActions || [] as action}
            <div class="wrapped-action-row">
              <span>{action.label}</span>
              <span class="approval-status pending">{String(action.status || 'pending').toUpperCase()}</span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="wrapped-buttons">
        <button class="icon-btn" type="button" onclick={() => agentStore.clearWrappedPlan()}>Clear</button>
        <button class="icon-btn send" type="button" onclick={() => agentStore.runWrappedPlanWithApprovals()}>
          Run With Approvals
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .chat-panel {
    width: min(360px, 78vw);
    height: min(420px, 55vh);
    display: flex;
    flex-direction: column;
    background: rgba(16, 22, 34, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 10px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    pointer-events: auto;
  }

  .chat-header {
    height: 38px;
    padding: 0 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
    font-size: 13px;
  }

  .message-list {
    flex: 1;
    padding: 10px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .empty {
    color: rgba(255, 255, 255, 0.55);
    font-size: 12px;
    margin: auto 0;
    text-align: center;
  }

  .message-row {
    display: flex;
  }

  .message-row.user {
    justify-content: flex-end;
  }

  .message-row.assistant,
  .message-row.system {
    justify-content: flex-start;
  }

  .message-bubble {
    max-width: 85%;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.4;
    color: white;
    word-break: break-word;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .message-bubble.approval {
    width: 100%;
  }
  .approval-card {
    margin-top: 8px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    padding: 8px;
    background: rgba(10, 14, 22, 0.5);
    display: grid;
    gap: 6px;
  }
  .approval-title {
    font-size: 12px;
    font-weight: 700;
    color: #f8fafc;
  }
  .approval-summary {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.85);
  }
  .approval-meta {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.65);
  }
  .approval-status {
    font-size: 11px;
    font-weight: 700;
    width: fit-content;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  .approval-status.pending {
    color: #facc15;
    border-color: rgba(250, 204, 21, 0.45);
    background: rgba(250, 204, 21, 0.14);
  }
  .approval-status.approved {
    color: #4ade80;
    border-color: rgba(74, 222, 128, 0.45);
    background: rgba(74, 222, 128, 0.14);
  }
  .approval-status.rejected {
    color: #fca5a5;
    border-color: rgba(252, 165, 165, 0.4);
    background: rgba(252, 165, 165, 0.12);
  }
  .approval-status.ok,
  .approval-status.completed {
    color: #4ade80;
    border-color: rgba(74, 222, 128, 0.45);
    background: rgba(74, 222, 128, 0.14);
  }
  .approval-status.warning,
  .approval-status.running {
    color: #facc15;
    border-color: rgba(250, 204, 21, 0.45);
    background: rgba(250, 204, 21, 0.14);
  }
  .approval-status.error,
  .approval-status.failed {
    color: #fca5a5;
    border-color: rgba(252, 165, 165, 0.4);
    background: rgba(252, 165, 165, 0.12);
  }
  .approval-actions {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .raw-output {
    margin: 6px 0 0;
    max-height: 140px;
    overflow: auto;
    font-size: 11px;
    line-height: 1.35;
    white-space: pre-wrap;
    word-break: break-word;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 6px;
    background: rgba(0, 0, 0, 0.3);
  }

  .message-row.user .message-bubble {
    background: rgba(88, 166, 255, 0.22);
    border-color: rgba(88, 166, 255, 0.35);
  }

  .message-row.system .message-bubble {
    color: rgba(255, 255, 255, 0.8);
    background: rgba(255, 255, 255, 0.06);
  }

  .composer {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    padding: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  .wrapped-mode {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding: 10px;
    display: grid;
    gap: 8px;
    background: rgba(255, 255, 255, 0.02);
  }
  .wrapped-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: rgba(255, 255, 255, 0.88);
    font-size: 12px;
  }
  .wrapped-builder {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }
  .wrapped-builder input {
    width: 100%;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(10, 14, 22, 0.75);
    color: white;
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.4;
    outline: none;
  }
  .wrapped-actions {
    max-height: 110px;
    overflow: auto;
    display: grid;
    gap: 6px;
  }
  .wrapped-action-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.03);
  }
  .wrapped-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  textarea {
    width: 100%;
    resize: none;
    min-height: 58px;
    max-height: 110px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(10, 14, 22, 0.75);
    color: white;
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.4;
    outline: none;
  }

  textarea:focus {
    border-color: rgba(88, 166, 255, 0.65);
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.9);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .send {
    align-self: end;
    color: rgba(88, 166, 255, 0.95);
    border-color: rgba(88, 166, 255, 0.35);
    background: rgba(88, 166, 255, 0.18);
  }
</style>
