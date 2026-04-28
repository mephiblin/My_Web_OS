<script>
  import { onMount } from 'svelte';
  import { CalendarDays, ChevronLeft, ChevronRight, Plus, Save, Trash2, Pencil } from 'lucide-svelte';
  import {
    fetchCalendarMonth,
    createCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    fetchCalendarSources,
    createCalendarSource,
    updateCalendarSource,
    fetchGoogleCalendarConfig,
    updateGoogleCalendarConfig,
    fetchGoogleCalendarAuthStart,
    syncGoogleCalendar,
    disconnectGoogleCalendar
  } from './api.js';

  const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function toDateKeyLocal(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function toDateTimeLocalInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function localInputToIso(value, allDay = false) {
    if (!value) return null;
    const source = String(value);
    if (allDay) {
      const [dateOnly] = source.split('T');
      if (!dateOnly) return null;
      const date = new Date(`${dateOnly}T00:00:00`);
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }
    const date = new Date(source);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function formatHumanDate(dateKey) {
    const date = new Date(`${dateKey}T00:00:00`);
    if (!Number.isFinite(date.getTime())) return dateKey;
    return date.toLocaleDateString([], {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short'
    });
  }

  function buildMonthCells(year, month) {
    const firstDate = new Date(year, month - 1, 1);
    const startWeekday = firstDate.getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const daysInPrevMonth = new Date(year, month - 1, 0).getDate();
    const cells = [];

    for (let i = startWeekday - 1; i >= 0; i -= 1) {
      const day = daysInPrevMonth - i;
      const date = new Date(year, month - 2, day);
      cells.push({
        dateKey: toDateKeyLocal(date),
        day,
        inMonth: false
      });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month - 1, day);
      cells.push({
        dateKey: toDateKeyLocal(date),
        day,
        inMonth: true
      });
    }

    while (cells.length < 42) {
      const day = cells.length - (startWeekday + daysInMonth) + 1;
      const date = new Date(year, month, day);
      cells.push({
        dateKey: toDateKeyLocal(date),
        day,
        inMonth: false
      });
    }

    return cells;
  }

  function eventIncludesDate(event, dateKey) {
    const dateStart = new Date(`${dateKey}T00:00:00`).getTime();
    if (!Number.isFinite(dateStart)) return false;
    const dateEnd = new Date(`${dateKey}T23:59:59.999`).getTime();

    const start = new Date(event?.startAt || '').getTime();
    if (!Number.isFinite(start)) return false;
    const endRaw = event?.endAt ? new Date(event.endAt).getTime() : NaN;
    const end = Number.isFinite(endRaw) ? endRaw : start;

    return start <= dateEnd && end >= dateStart;
  }

  const now = new Date();
  const todayKey = toDateKeyLocal(now);

  let viewYear = $state(now.getFullYear());
  let viewMonth = $state(now.getMonth() + 1);
  let selectedDateKey = $state(todayKey);

  let monthEvents = $state([]);
  let loading = $state(false);
  let saving = $state(false);
  let errorMessage = $state('');
  let googleMessage = $state('');
  let googleError = $state('');
  let googleLoading = $state(false);
  let googleSourceExists = $state(false);
  let googleSourceEnabled = $state(false);
  let googleConnected = $state(false);
  let googleConfigured = $state(false);
  let googleLastSyncedAt = $state('');
  let googleLastError = $state(null);
  let googleBackoffUntil = $state('');
  let googleClientIdMasked = $state('');
  let googleClientId = $state('');
  let googleClientSecret = $state('');
  let googleRedirectUri = $state('');

  let draftTitle = $state('');
  let draftAllDay = $state(false);
  let draftStartLocal = $state(`${todayKey}T09:00`);
  let draftEndLocal = $state('');
  let draftColor = $state('#58a6ff');
  let draftNote = $state('');

  let editingId = $state('');
  let editTitle = $state('');
  let editAllDay = $state(false);
  let editStartLocal = $state('');
  let editEndLocal = $state('');
  let editColor = $state('#58a6ff');
  let editNote = $state('');

  const monthLabel = $derived(new Date(viewYear, viewMonth - 1, 1).toLocaleDateString([], {
    year: 'numeric',
    month: 'long'
  }));

  const monthCells = $derived(buildMonthCells(viewYear, viewMonth));

  const eventsByDate = $derived.by(() => {
    const map = new Map();
    for (const cell of monthCells) {
      map.set(cell.dateKey, []);
    }
    for (const item of monthEvents) {
      for (const cell of monthCells) {
        if (eventIncludesDate(item, cell.dateKey)) {
          const bucket = map.get(cell.dateKey) || [];
          bucket.push(item);
          map.set(cell.dateKey, bucket);
        }
      }
    }

    for (const [key, list] of map.entries()) {
      list.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
      map.set(key, list);
    }

    return map;
  });

  const selectedEvents = $derived((eventsByDate.get(selectedDateKey) || []).slice());

  function syncDraftDateToSelection() {
    const [datePart] = String(draftStartLocal || '').split('T');
    if (datePart === selectedDateKey) return;
    draftStartLocal = `${selectedDateKey}T09:00`;
    draftEndLocal = '';
  }

  async function loadMonth() {
    loading = true;
    errorMessage = '';
    try {
      const payload = await fetchCalendarMonth(viewYear, viewMonth);
      monthEvents = Array.isArray(payload?.data) ? payload.data : [];
    } catch (err) {
      errorMessage = err?.message || 'Failed to load calendar events.';
      monthEvents = [];
    } finally {
      loading = false;
    }
  }

  function defaultGoogleRedirectUri() {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/api/system/calendar/google/auth/callback`;
  }

  async function loadGooglePanel() {
    googleLoading = true;
    googleError = '';
    try {
      const [configPayload, sourcesPayload] = await Promise.all([
        fetchGoogleCalendarConfig('google-primary'),
        fetchCalendarSources()
      ]);
      const config = configPayload?.data || {};
      const sources = Array.isArray(sourcesPayload?.data) ? sourcesPayload.data : [];
      const googleSource = sources.find((source) => source.id === 'google-primary');
      googleSourceExists = Boolean(googleSource);
      googleSourceEnabled = googleSource?.enabled === true;
      googleConnected = config.connected === true;
      googleConfigured = config.configured === true;
      googleLastSyncedAt = config.lastSyncedAt || googleSource?.lastSyncedAt || '';
      googleLastError = config.lastError || googleSource?.lastError || null;
      googleBackoffUntil = config.backoffUntil || '';
      googleRedirectUri = config.redirectUri || googleRedirectUri || defaultGoogleRedirectUri();
      googleClientIdMasked = config.clientIdMasked || '';
    } catch (err) {
      googleError = err?.message || 'Failed to load Google Calendar settings.';
    } finally {
      googleLoading = false;
    }
  }

  async function ensureGoogleSource(enabled = true) {
    if (googleSourceExists) {
      await updateCalendarSource('google-primary', {
        enabled,
        config: {
          calendarId: 'primary',
          syncEnabled: true,
          syncDirection: 'readOnly'
        }
      });
      return;
    }
    await createCalendarSource({
      id: 'google-primary',
      title: 'Google Calendar',
      type: 'google',
      enabled,
      readOnly: true,
      color: '#4285f4',
      config: {
        calendarId: 'primary',
        syncEnabled: true,
        syncDirection: 'readOnly'
      }
    });
  }

  async function saveGoogleSettings() {
    googleLoading = true;
    googleMessage = '';
    googleError = '';
    try {
      await updateGoogleCalendarConfig({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri: googleRedirectUri || defaultGoogleRedirectUri()
      });
      await ensureGoogleSource(true);
      googleClientSecret = '';
      googleMessage = 'Google OAuth client settings saved.';
      await loadGooglePanel();
    } catch (err) {
      googleError = err?.message || 'Failed to save Google Calendar settings.';
    } finally {
      googleLoading = false;
    }
  }

  async function connectGoogleCalendar() {
    googleLoading = true;
    googleMessage = '';
    googleError = '';
    try {
      await ensureGoogleSource(true);
      const payload = await fetchGoogleCalendarAuthStart('google-primary');
      const url = payload?.data?.url;
      if (!url) throw new Error('Google authorization URL was not returned.');
      window.location.href = url;
    } catch (err) {
      googleError = err?.message || 'Failed to start Google Calendar OAuth.';
      googleLoading = false;
    }
  }

  async function handleGoogleSync() {
    googleLoading = true;
    googleMessage = '';
    googleError = '';
    try {
      const result = await syncGoogleCalendar('google-primary');
      googleMessage = `Google Calendar synced${Number.isFinite(result?.total) ? ` (${result.total} events)` : ''}.`;
      await loadGooglePanel();
      await loadMonth();
    } catch (err) {
      googleError = err?.message || 'Failed to sync Google Calendar.';
    } finally {
      googleLoading = false;
    }
  }

  async function handleGoogleDisconnect() {
    googleLoading = true;
    googleMessage = '';
    googleError = '';
    try {
      await disconnectGoogleCalendar('google-primary');
      googleConnected = false;
      googleSourceEnabled = false;
      googleMessage = 'Google Calendar disconnected.';
      await loadGooglePanel();
      await loadMonth();
    } catch (err) {
      googleError = err?.message || 'Failed to disconnect Google Calendar.';
    } finally {
      googleLoading = false;
    }
  }

  function goPrevMonth() {
    if (viewMonth === 1) {
      viewMonth = 12;
      viewYear -= 1;
    } else {
      viewMonth -= 1;
    }
    loadMonth();
  }

  function goNextMonth() {
    if (viewMonth === 12) {
      viewMonth = 1;
      viewYear += 1;
    } else {
      viewMonth += 1;
    }
    loadMonth();
  }

  function selectDate(dateKey) {
    selectedDateKey = dateKey;
    syncDraftDateToSelection();
  }

  async function handleCreateEvent() {
    const title = String(draftTitle || '').trim();
    if (!title) return;

    const startAt = localInputToIso(draftStartLocal, draftAllDay);
    const endAt = localInputToIso(draftEndLocal, draftAllDay);
    if (!startAt) return;

    saving = true;
    errorMessage = '';
    try {
      await createCalendarEvent({
        title,
        startAt,
        endAt,
        allDay: draftAllDay,
        color: draftColor,
        note: String(draftNote || '').trim() || null
      });
      draftTitle = '';
      draftNote = '';
      draftEndLocal = '';
      await loadMonth();
    } catch (err) {
      errorMessage = err?.message || 'Failed to create event.';
    } finally {
      saving = false;
    }
  }

  function startEdit(item) {
    if (item?.readOnly) return;
    editingId = String(item?.id || '');
    editTitle = String(item?.title || '');
    editAllDay = item?.allDay === true;
    editStartLocal = toDateTimeLocalInput(item?.startAt);
    editEndLocal = toDateTimeLocalInput(item?.endAt);
    editColor = String(item?.color || '#58a6ff');
    editNote = String(item?.note || '');
  }

  function cancelEdit() {
    editingId = '';
    editTitle = '';
    editAllDay = false;
    editStartLocal = '';
    editEndLocal = '';
    editColor = '#58a6ff';
    editNote = '';
  }

  async function saveEdit(item) {
    const eventId = String(item?.id || '');
    if (!eventId) return;

    const title = String(editTitle || '').trim();
    const startAt = localInputToIso(editStartLocal, editAllDay);
    const endAt = localInputToIso(editEndLocal, editAllDay);
    if (!title || !startAt) return;

    saving = true;
    errorMessage = '';
    try {
      await updateCalendarEvent(eventId, {
        title,
        startAt,
        endAt,
        allDay: editAllDay,
        color: editColor,
        note: String(editNote || '').trim() || null
      });
      cancelEdit();
      await loadMonth();
    } catch (err) {
      errorMessage = err?.message || 'Failed to update event.';
    } finally {
      saving = false;
    }
  }

  async function removeEvent(item) {
    const eventId = String(item?.id || '');
    if (item?.readOnly) return;
    if (!eventId) return;
    saving = true;
    errorMessage = '';
    try {
      await deleteCalendarEvent(eventId);
      if (editingId === eventId) cancelEdit();
      await loadMonth();
    } catch (err) {
      errorMessage = err?.message || 'Failed to delete event.';
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    loadMonth();
    loadGooglePanel();
  });
</script>

<div class="calendar-app">
  <header class="app-header">
    <div class="title-wrap">
      <CalendarDays size={18} />
      <h2>Calendar</h2>
    </div>
    <div class="month-nav">
      <button onclick={goPrevMonth} aria-label="Previous month"><ChevronLeft size={15} /></button>
      <strong>{monthLabel}</strong>
      <button onclick={goNextMonth} aria-label="Next month"><ChevronRight size={15} /></button>
    </div>
  </header>

  {#if errorMessage}
    <div class="status error">{errorMessage}</div>
  {/if}

  <div class="layout">
    <section class="month-grid-wrap">
      <div class="weekday-row">
        {#each WEEKDAY_LABELS as label}
          <span>{label}</span>
        {/each}
      </div>
      <div class="month-grid">
        {#each monthCells as cell}
          <button
            class:in-month={cell.inMonth}
            class:selected={cell.dateKey === selectedDateKey}
            class:today={cell.dateKey === todayKey}
            class="day-cell"
            onclick={() => selectDate(cell.dateKey)}
          >
            <div class="day-head">
              <span>{cell.day}</span>
              {#if (eventsByDate.get(cell.dateKey) || []).length > 0}
                <small>{(eventsByDate.get(cell.dateKey) || []).length}</small>
              {/if}
            </div>
            <div class="dots">
              {#each (eventsByDate.get(cell.dateKey) || []).slice(0, 3) as item}
                <span style={`background:${item.color || '#58a6ff'}`}></span>
              {/each}
            </div>
          </button>
        {/each}
      </div>
      {#if loading}
        <div class="status">Loading month events...</div>
      {/if}
    </section>

    <aside class="side-panel">
      <section class="composer">
        <h3>Add Event</h3>
        <p>{formatHumanDate(selectedDateKey)}</p>
        <input bind:value={draftTitle} placeholder="Event title" maxlength="200" />
        <label>
          <span>Starts</span>
          <input type="datetime-local" bind:value={draftStartLocal} />
        </label>
        <label>
          <span>Ends (optional)</span>
          <input type="datetime-local" bind:value={draftEndLocal} />
        </label>
        <label class="inline">
          <input type="checkbox" bind:checked={draftAllDay} />
          <span>All day</span>
        </label>
        <label>
          <span>Color</span>
          <input type="color" bind:value={draftColor} />
        </label>
        <textarea bind:value={draftNote} rows="3" placeholder="Note (optional)"></textarea>
        <button class="primary" disabled={saving || !draftTitle.trim()} onclick={handleCreateEvent}>
          <Plus size={14} /> Create
        </button>
      </section>

      <section class="google-panel">
        <div class="panel-title-row">
          <div>
            <h3>Google Calendar</h3>
            <p>Read-only sync for the primary calendar.</p>
          </div>
          <span class:connected={googleConnected}>{googleConnected ? 'Connected' : 'Not connected'}</span>
        </div>
        {#if googleMessage}
          <div class="mini-status success">{googleMessage}</div>
        {/if}
        {#if googleError}
          <div class="mini-status error">{googleError}</div>
        {/if}
        <label>
          <span>OAuth Client ID {googleClientIdMasked ? `(saved: ${googleClientIdMasked})` : ''}</span>
          <input bind:value={googleClientId} placeholder="Google OAuth client ID" autocomplete="off" />
        </label>
        <label>
          <span>OAuth Client Secret {googleConfigured ? '(saved)' : ''}</span>
          <input type="password" bind:value={googleClientSecret} placeholder="Leave blank to keep saved secret" autocomplete="new-password" />
        </label>
        <label>
          <span>Redirect URI</span>
          <input bind:value={googleRedirectUri} placeholder={defaultGoogleRedirectUri()} />
        </label>
        <div class="google-actions">
          <button class="ghost" disabled={googleLoading} onclick={saveGoogleSettings}>Save Settings</button>
          <button class="primary" disabled={googleLoading || !googleConfigured} onclick={connectGoogleCalendar}>Connect</button>
          <button class="ghost" disabled={googleLoading || !googleConnected} onclick={handleGoogleSync}>Sync</button>
          <button class="danger" disabled={googleLoading || !googleConnected} onclick={handleGoogleDisconnect}>Disconnect</button>
        </div>
        <div class="google-meta">
          <span>Source: {googleSourceExists ? (googleSourceEnabled ? 'enabled' : 'disabled') : 'not created'}</span>
          <span>Last sync: {googleLastSyncedAt ? new Date(googleLastSyncedAt).toLocaleString() : '-'}</span>
          {#if googleBackoffUntil}
            <span>Retry after: {new Date(googleBackoffUntil).toLocaleString()}</span>
          {/if}
          {#if googleLastError}
            <span>Error: {googleLastError.message || googleLastError.code}</span>
          {/if}
        </div>
      </section>

      <section class="event-list">
        <h3>Events</h3>
        {#if selectedEvents.length === 0}
          <div class="empty">No events on this date.</div>
        {:else}
          {#each selectedEvents as item}
            <article class="event-item" style={`--event-color:${item.color || '#58a6ff'}`}>
              <header>
                <div class="event-title">
                  <strong>{item.title}</strong>
                  {#if item.readOnly}
                    <span class="source-badge">{item.sourceType || 'source'}</span>
                  {/if}
                </div>
                <div class="actions">
                  <button title="Edit" disabled={item.readOnly} onclick={() => startEdit(item)}><Pencil size={13} /></button>
                  <button title="Delete" disabled={item.readOnly} onclick={() => removeEvent(item)}><Trash2 size={13} /></button>
                </div>
              </header>
              {#if editingId === item.id}
                <div class="edit-form">
                  <input bind:value={editTitle} maxlength="200" />
                  <input type="datetime-local" bind:value={editStartLocal} />
                  <input type="datetime-local" bind:value={editEndLocal} />
                  <label class="inline">
                    <input type="checkbox" bind:checked={editAllDay} />
                    <span>All day</span>
                  </label>
                  <input type="color" bind:value={editColor} />
                  <textarea bind:value={editNote} rows="2"></textarea>
                  <div class="edit-actions">
                    <button class="ghost" onclick={cancelEdit}>Cancel</button>
                    <button class="primary" disabled={saving} onclick={() => saveEdit(item)}>
                      <Save size={13} /> Save
                    </button>
                  </div>
                </div>
              {:else}
                {#if item.allDay}
                  <p class="meta">All day</p>
                {:else}
                  <p class="meta">{new Date(item.startAt).toLocaleString()}</p>
                {/if}
                {#if item.endAt}
                  <p class="meta">to {new Date(item.endAt).toLocaleString()}</p>
                {/if}
                {#if item.note}
                  <p class="note">{item.note}</p>
                {/if}
              {/if}
            </article>
          {/each}
        {/if}
      </section>
    </aside>
  </div>
</div>

<style>
  .calendar-app {
    height: 100%;
    display: grid;
    grid-template-rows: auto auto 1fr;
    color: var(--text-main);
    background: rgba(4, 10, 20, 0.45);
  }
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--glass-border);
  }
  .title-wrap {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .title-wrap h2 {
    margin: 0;
    font-size: 15px;
  }
  .month-nav {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .month-nav button {
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    width: 28px;
    height: 28px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-main);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .month-nav strong {
    min-width: 130px;
    text-align: center;
    font-size: 13px;
  }
  .status {
    font-size: 12px;
    padding: 8px 12px;
    color: var(--text-dim);
  }
  .status.error {
    color: #ffb4b4;
    background: rgba(127, 29, 29, 0.35);
    border-bottom: 1px solid rgba(248, 113, 113, 0.3);
  }
  .layout {
    min-height: 0;
    display: grid;
    grid-template-columns: 1.5fr 1fr;
  }
  .month-grid-wrap {
    min-width: 0;
    display: grid;
    grid-template-rows: auto 1fr auto;
    border-right: 1px solid var(--glass-border);
  }
  .weekday-row {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    padding: 8px 10px;
    border-bottom: 1px solid var(--glass-border);
  }
  .weekday-row span {
    font-size: 11px;
    color: var(--text-dim);
    text-align: center;
  }
  .month-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    grid-template-rows: repeat(6, minmax(0, 1fr));
    gap: 6px;
    padding: 10px;
  }
  .day-cell {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.03);
    color: rgba(255, 255, 255, 0.5);
    display: grid;
    grid-template-rows: auto 1fr;
    align-content: start;
    padding: 6px;
    cursor: pointer;
  }
  .day-cell.in-month {
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.05);
  }
  .day-cell.selected {
    border-color: rgba(88, 166, 255, 0.8);
    box-shadow: 0 0 0 1px rgba(88, 166, 255, 0.45);
  }
  .day-cell.today {
    border-color: rgba(52, 211, 153, 0.8);
  }
  .day-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
  }
  .day-head small {
    font-size: 10px;
    opacity: 0.75;
  }
  .dots {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .dots span {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    opacity: 0.9;
  }
  .side-panel {
    min-height: 0;
    overflow: auto;
    display: grid;
    gap: 10px;
    padding: 10px;
    grid-template-rows: auto auto 1fr;
  }
  .composer,
  .google-panel,
  .event-list {
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    background: rgba(9, 14, 22, 0.55);
    padding: 10px;
    display: grid;
    gap: 8px;
    align-content: start;
  }
  h3 {
    margin: 0;
    font-size: 13px;
  }
  .composer p {
    margin: 0;
    font-size: 11px;
    color: var(--text-dim);
  }
  .panel-title-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .panel-title-row p,
  .google-meta {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--text-dim);
  }
  .panel-title-row > span {
    height: fit-content;
    border: 1px solid rgba(248, 113, 113, 0.35);
    border-radius: 999px;
    padding: 3px 8px;
    color: #fecaca;
    background: rgba(127, 29, 29, 0.24);
    font-size: 10px;
  }
  .panel-title-row > span.connected {
    border-color: rgba(52, 211, 153, 0.38);
    color: #bbf7d0;
    background: rgba(20, 83, 45, 0.24);
  }
  .google-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .google-actions button {
    flex: 1 1 auto;
  }
  .google-meta {
    display: grid;
    gap: 3px;
  }
  .mini-status {
    border-radius: 8px;
    padding: 7px 8px;
    font-size: 11px;
  }
  .mini-status.success {
    color: #bbf7d0;
    background: rgba(20, 83, 45, 0.24);
  }
  .mini-status.error {
    color: #fecaca;
    background: rgba(127, 29, 29, 0.28);
  }
  input,
  textarea,
  button {
    font: inherit;
  }
  input,
  textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-main);
    padding: 8px;
    font-size: 12px;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .inline {
    display: inline-flex;
    gap: 8px;
    align-items: center;
  }
  .inline input {
    width: auto;
    margin: 0;
  }
  button {
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-main);
    padding: 7px 9px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 12px;
  }
  button.primary {
    background: rgba(59, 130, 246, 0.3);
    border-color: rgba(96, 165, 250, 0.6);
  }
  button.ghost {
    background: rgba(255, 255, 255, 0.04);
  }
  button.danger {
    color: #fecaca;
    background: rgba(127, 29, 29, 0.3);
    border-color: rgba(248, 113, 113, 0.35);
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .event-list {
    min-height: 180px;
    align-content: start;
    overflow: auto;
  }
  .event-item {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-left: 4px solid var(--event-color, #58a6ff);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.04);
    padding: 8px;
    display: grid;
    gap: 6px;
  }
  .event-item header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .event-item strong {
    font-size: 12px;
  }
  .event-title {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .source-badge {
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 999px;
    padding: 2px 6px;
    color: rgba(255, 255, 255, 0.72);
    background: rgba(255, 255, 255, 0.06);
    font-size: 10px;
    line-height: 1.2;
    text-transform: uppercase;
  }
  .actions {
    display: inline-flex;
    gap: 4px;
  }
  .actions button {
    width: 24px;
    height: 24px;
    padding: 0;
  }
  .meta {
    margin: 0;
    font-size: 11px;
    color: var(--text-dim);
  }
  .note {
    margin: 0;
    font-size: 12px;
    white-space: pre-wrap;
    color: rgba(255, 255, 255, 0.85);
  }
  .edit-form {
    display: grid;
    gap: 6px;
  }
  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .empty {
    font-size: 12px;
    color: var(--text-dim);
    padding: 6px 2px;
  }
  @media (max-width: 980px) {
    .layout {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(300px, 56%) 1fr;
    }
    .month-grid-wrap {
      border-right: none;
      border-bottom: 1px solid var(--glass-border);
    }
  }
</style>
