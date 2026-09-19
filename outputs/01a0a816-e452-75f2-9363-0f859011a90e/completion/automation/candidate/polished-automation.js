(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AvenAutomation = api;
})(globalThis, function () {
  'use strict';

  const VERSION = 1;
  const MAX_SCHEDULES = 100;
  const MAX_HISTORY = 100;
  const MAX_FAILURES = 20;
  const MAX_NOTIFICATIONS = 100;
  const CADENCES = Object.freeze(['hourly', 'daily', 'weekly']);
  const EVENT_TYPES = Object.freeze(['completion', 'failure', 'input_required']);
  const TZ_FALLBACK = 'UTC';

  const PLUGIN_REGISTRY = Object.freeze([
    Object.freeze({
      id: 'local-workspace',
      name: 'Local workspace',
      description: 'Goals, schedules, procedures and evidence stored in this browser.',
      capabilities: Object.freeze(['local checklists', 'while-open schedule preview', 'evidence links']),
      requiredPermissions: Object.freeze(['None']),
      availability: 'available',
      connectionHealth: 'local-only',
      availabilityReason: 'Available locally; it does not connect to a provider or device.',
    }),
    Object.freeze({
      id: 'opencode-runtime',
      name: 'OpenCode runtime',
      description: 'Model-backed conversation and diagnostic interpretation.',
      capabilities: Object.freeze(['chat responses', 'read-only diagnostic interpretation']),
      requiredPermissions: Object.freeze(['Provider session', 'local service']),
      availability: 'unavailable',
      connectionHealth: 'unavailable',
      availabilityReason: 'No runtime connection is asserted by this workspace module.',
    }),
    Object.freeze({
      id: 'catalyst-center',
      name: 'Catalyst Center',
      description: 'Read-only network inventory and CLI evidence through a configured adapter.',
      capabilities: Object.freeze(['inventory', 'read-only CLI evidence']),
      requiredPermissions: Object.freeze(['Catalyst Center account', 'approved adapter']),
      availability: 'unavailable',
      connectionHealth: 'unavailable',
      availabilityReason: 'No network connection or credentials are configured here.',
    }),
    Object.freeze({
      id: 'nornir-ssh',
      name: 'Nornir + Netmiko',
      description: 'Read-only SSH diagnostics through a configured lab profile.',
      capabilities: Object.freeze(['read-only SSH diagnostics']),
      requiredPermissions: Object.freeze(['Approved SSH profile', 'approved adapter']),
      availability: 'unavailable',
      connectionHealth: 'unavailable',
      availabilityReason: 'No SSH profile or device connection is configured here.',
    }),
  ]);

  const WORKFLOW_REGISTRY = Object.freeze([
    Object.freeze({
      id: 'network-health-check',
      name: 'Network health check',
      version: '1.0.0',
      purpose: 'Review a bounded set of read-only health signals for a named target.',
      inputs: Object.freeze(['target', 'time window']),
      requiredAccess: Object.freeze(['Local workspace', 'An approved read-only network adapter']),
      evidenceRequirements: Object.freeze(['Saved message or run evidence', 'Target and operation provenance']),
      procedure: 'Collect bounded health evidence, show the raw result, then record an interpretation.',
    }),
    Object.freeze({
      id: 'evidence-review',
      name: 'Evidence review',
      version: '1.0.0',
      purpose: 'Review saved run evidence without issuing a new command.',
      inputs: Object.freeze(['conversation or run']),
      requiredAccess: Object.freeze(['Local workspace']),
      evidenceRequirements: Object.freeze(['Existing saved message or artifact reference']),
      procedure: 'Open saved evidence, compare provenance, and record an explicit conclusion.',
    }),
  ]);

  const clone = (value) => {
    if (value === undefined) return undefined;
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch (_) { /* JSON fallback below is adequate for persisted records. */ }
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  };
  const text = (value) => typeof value === 'string' ? value : value == null ? '' : String(value);
  const nonEmpty = (value) => text(value).trim();
  const nowIso = () => new Date().toISOString();
  const uid = () => globalThis.crypto?.randomUUID?.() || `aven-automation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const validDate = (value) => Number.isFinite(Date.parse(value));
  const validId = (value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(nonEmpty(value));
  const safeArray = (value) => Array.isArray(value) ? value : [];
  const short = (value, limit = 400) => text(value).trim().slice(0, limit);

  function systemTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || TZ_FALLBACK; } catch (_) { return TZ_FALLBACK; }
  }

  function isValidTimezone(value) {
    const zone = nonEmpty(value) === 'Follow system' ? systemTimezone() : nonEmpty(value) || systemTimezone();
    try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(); return true; } catch (_) { return false; }
  }

  function resolvedTimezone(value) {
    const zone = nonEmpty(value);
    if (!zone || zone === 'Follow system') return systemTimezone();
    return isValidTimezone(zone) ? zone : '';
  }

  function zonedParts(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date);
    const result = {};
    parts.forEach((part) => { if (part.type !== 'literal') result[part.type] = Number(part.value); });
    // Some engines represent midnight as 24:xx. Treat it as the start of the day.
    if (result.hour === 24) result.hour = 0;
    return result;
  }

  function zonedDateToUtc(parts, timezone) {
    let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
    for (let i = 0; i < 4; i += 1) {
      const actual = zonedParts(new Date(guess), timezone);
      const asUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
      const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
      guess += desired - asUtc;
    }
    return new Date(guess);
  }

  function parseTime(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(nonEmpty(value));
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2]);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
  }

  function nextRunAt(input = {}) {
    const timezone = resolvedTimezone(input.timezone);
    if (!timezone) return null;
    const cadence = CADENCES.includes(input.cadence) ? input.cadence : 'daily';
    const time = parseTime(input.timeOfDay) || { hour: 9, minute: 0 };
    const base = new Date(input.from || nowIso());
    if (Number.isNaN(base.valueOf())) return null;
    const local = zonedParts(base, timezone);
    let year = local.year, month = local.month, day = local.day;
    let hour = time.hour, minute = time.minute;
    if (cadence === 'hourly') {
      const candidate = new Date(base);
      candidate.setUTCMinutes(0, 0, 0);
      candidate.setUTCHours(candidate.getUTCHours() + 1);
      return candidate.toISOString();
    }
    const targetWeekday = Number.isInteger(input.weekday) && input.weekday >= 0 && input.weekday <= 6 ? input.weekday : 1;
    let candidate = zonedDateToUtc({ year, month, day, hour, minute, second: 0 }, timezone);
    if (cadence === 'weekly') {
      const currentWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      let add = (targetWeekday - currentWeekday + 7) % 7;
      if (add === 0 && candidate <= base) add = 7;
      if (add > 0) {
        const d = new Date(Date.UTC(year, month - 1, day + add));
        year = d.getUTCFullYear(); month = d.getUTCMonth() + 1; day = d.getUTCDate();
        candidate = zonedDateToUtc({ year, month, day, hour, minute, second: 0 }, timezone);
      }
    } else if (candidate <= base) {
      const d = new Date(Date.UTC(year, month - 1, day + 1));
      year = d.getUTCFullYear(); month = d.getUTCMonth() + 1; day = d.getUTCDate();
      candidate = zonedDateToUtc({ year, month, day, hour, minute, second: 0 }, timezone);
    }
    return candidate.toISOString();
  }

  function workflow(id, version) {
    const found = WORKFLOW_REGISTRY.find((item) => item.id === nonEmpty(id));
    return found && (!version || found.version === nonEmpty(version)) ? found : null;
  }

  function workflowSelectionError(schedule) {
    if (!workflow(schedule.workflowId, schedule.workflowVersion)) return 'The selected procedure version is unavailable. Choose a current procedure before enabling this schedule.';
    return '';
  }

  function normalizeHistory(item, index) {
    const value = item && typeof item === 'object' ? item : {};
    const runId = nonEmpty(value.runId) || `legacy-run-${index}`;
    const status = ['SUCCESS', 'FAILED', 'BLOCKED', 'UNKNOWN'].includes(value.status) ? value.status : 'UNKNOWN';
    return {
      id: nonEmpty(value.id) || `${runId}-${index}`,
      runId,
      dispatchId: nonEmpty(value.dispatchId),
      trigger: value.trigger === 'manual' ? 'manual' : 'schedule',
      status,
      startedAt: validDate(value.startedAt) ? new Date(value.startedAt).toISOString() : '',
      finishedAt: validDate(value.finishedAt) ? new Date(value.finishedAt).toISOString() : '',
      error: short(value.error, 1000),
      outputRef: value.outputRef && typeof value.outputRef === 'object' ? { chatId: nonEmpty(value.outputRef.chatId), messageId: nonEmpty(value.outputRef.messageId) } : null,
    };
  }

  function normalizeSchedule(item, index) {
    const value = item && typeof item === 'object' ? item : {};
    const timezone = nonEmpty(value.timezone) || 'Follow system';
    const history = safeArray(value.history).slice(-MAX_HISTORY).map(normalizeHistory);
    const failures = safeArray(value.failures).slice(-MAX_FAILURES).map((failure, failureIndex) => ({
      id: nonEmpty(failure?.id) || `legacy-failure-${index}-${failureIndex}`,
      at: validDate(failure?.at) ? new Date(failure.at).toISOString() : '',
      message: short(failure?.message || failure?.error, 1000),
      runId: nonEmpty(failure?.runId),
    }));
    const normalized = {
      id: nonEmpty(value.id) || `legacy-schedule-${index}`,
      title: short(value.title || value.name, 160),
      taskId: nonEmpty(value.taskId || value.chatId || value.conversationId),
      workflowId: nonEmpty(value.workflowId || value.procedureId),
      workflowVersion: nonEmpty(value.workflowVersion || value.procedureVersion),
      cadence: CADENCES.includes(value.cadence) ? value.cadence : 'daily',
      timezone,
      timeOfDay: parseTime(value.timeOfDay) ? value.timeOfDay : '09:00',
      weekday: Number.isInteger(value.weekday) && value.weekday >= 0 && value.weekday <= 6 ? value.weekday : 1,
      enabled: value.enabled === true,
      reviewRequired: value.reviewRequired === true,
      nextRunAt: validDate(value.nextRunAt) ? new Date(value.nextRunAt).toISOString() : '',
      lastRunAt: validDate(value.lastRunAt) ? new Date(value.lastRunAt).toISOString() : '',
      lastStatus: ['SUCCESS', 'FAILED', 'BLOCKED', 'UNKNOWN', 'PAUSED', 'NEVER'].includes(value.lastStatus) ? value.lastStatus : 'NEVER',
      failures,
      history,
      createdAt: validDate(value.createdAt) ? new Date(value.createdAt).toISOString() : '',
      updatedAt: validDate(value.updatedAt) ? new Date(value.updatedAt).toISOString() : '',
    };
    if (!normalized.nextRunAt && normalized.enabled) normalized.nextRunAt = nextRunAtAt(normalized, nowIso());
    return normalized;
  }

  function nextRunAtAt(schedule, from) {
    return nextRunAt({ cadence: schedule.cadence, timezone: schedule.timezone, timeOfDay: schedule.timeOfDay, weekday: schedule.weekday, from });
  }

  function normalizeNotification(value, index) {
    const event = value && typeof value === 'object' ? value : {};
    const type = EVENT_TYPES.includes(event.type) ? event.type : 'completion';
    const taskId = nonEmpty(event.taskId || event.scheduleId || event.goalId);
    const runId = nonEmpty(event.runId);
    const id = nonEmpty(event.id) || `aven-notification:${type}:${taskId || 'workspace'}:${runId || 'event'}`;
    return {
      id, type, taskId, runId,
      title: short(event.title || (type === 'input_required' ? 'Input required' : type === 'failure' ? 'Run failed' : 'Run completed'), 160),
      message: short(event.message || event.error || '', 1000),
      createdAt: validDate(event.createdAt) ? new Date(event.createdAt).toISOString() : nowIso(),
      read: event.read === true,
      muted: event.muted === true,
    };
  }

  function normalizeState(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const notifications = source.notifications && typeof source.notifications === 'object' ? source.notifications : {};
    const delivered = safeArray(notifications.delivered).slice(-MAX_NOTIFICATIONS).map(normalizeNotification);
    const selectedPluginIds = safeArray(source.selectedPluginIds).filter((id) => PLUGIN_REGISTRY.some((plugin) => plugin.id === id && plugin.availability === 'available'));
    return {
      version: VERSION,
      schedules: safeArray(source.schedules).slice(0, MAX_SCHEDULES).map(normalizeSchedule),
      notifications: { muted: notifications.muted === true, delivered },
      selectedPluginIds: [...new Set(selectedPluginIds)],
    };
  }

  function validateSchedule(schedule) {
    const value = normalizeSchedule(schedule, 0);
    const errors = [];
    if (!nonEmpty(value.title)) errors.push('Add a schedule name.');
    const procedureError = workflowSelectionError(value);
    if (procedureError) errors.push(procedureError);
    if (!CADENCES.includes(value.cadence)) errors.push('Choose a supported cadence.');
    if (!parseTime(value.timeOfDay)) errors.push('Choose a valid time of day.');
    if (!isValidTimezone(value.timezone)) errors.push('Choose a valid time zone.');
    if (value.cadence === 'weekly' && (!Number.isInteger(value.weekday) || value.weekday < 0 || value.weekday > 6)) errors.push('Choose a valid weekday.');
    return [...new Set(errors.filter(Boolean))];
  }

  function makeSchedule(input = {}, from = nowIso()) {
    const timestamp = new Date(from);
    const schedule = normalizeSchedule({
      id: nonEmpty(input.id) || uid(), title: input.title, taskId: input.taskId, workflowId: input.workflowId,
      workflowVersion: input.workflowVersion, cadence: input.cadence, timezone: input.timezone,
      timeOfDay: input.timeOfDay, weekday: input.weekday, enabled: false,
      nextRunAt: nextRunAt({ ...input, from }), lastStatus: 'NEVER',
      createdAt: timestamp.toISOString(), updatedAt: timestamp.toISOString(), history: [], failures: [],
    }, 0);
    const errors = validateSchedule(schedule);
    if (errors.length) return { ok: false, errors, schedule: null };
    schedule.enabled = false;
    schedule.lastStatus = 'PAUSED';
    return { ok: true, errors: [], schedule };
  }

  function updateSchedule(state, id, patch, at = nowIso()) {
    const next = normalizeState(state);
    const index = next.schedules.findIndex((item) => item.id === nonEmpty(id));
    if (index < 0) return { ok: false, errors: ['That schedule is no longer available.'], state: next };
    const current = next.schedules[index];
    const candidate = normalizeSchedule({ ...current, ...clone(patch), id: current.id, updatedAt: at }, index);
    const errors = validateSchedule(candidate);
    if (errors.length) return { ok: false, errors, state: next };
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
      candidate.enabled = patch.enabled === true;
      candidate.reviewRequired = false;
      candidate.lastStatus = candidate.enabled ? 'NEVER' : 'PAUSED';
      candidate.nextRunAt = candidate.enabled ? nextRunAtAt(candidate, at) : candidate.nextRunAt;
    } else if (candidate.enabled && ['cadence', 'timezone', 'timeOfDay', 'weekday', 'workflowId', 'workflowVersion'].some((key) => Object.prototype.hasOwnProperty.call(patch || {}, key))) {
      candidate.nextRunAt = nextRunAtAt(candidate, at);
    }
    next.schedules[index] = candidate;
    return { ok: true, errors: [], state: next };
  }

  function selectPlugin(state, id, selected = true) {
    const next = normalizeState(state);
    const plugin = PLUGIN_REGISTRY.find((item) => item.id === nonEmpty(id));
    if (!plugin) return { ok: false, error: 'That plugin is not in the local capability registry.', state: next };
    if (plugin.availability !== 'available') return { ok: false, error: `${plugin.name} is unavailable and cannot be selected.`, state: next };
    next.selectedPluginIds = selected ? [...new Set([...next.selectedPluginIds, plugin.id])] : next.selectedPluginIds.filter((item) => item !== plugin.id);
    return { ok: true, error: '', state: next };
  }

  function notificationEvent(input = {}) {
    const type = EVENT_TYPES.includes(input.type) ? input.type : '';
    if (!type) throw new TypeError('Notification event type must be completion, failure, or input_required.');
    const event = normalizeNotification({ ...input, type }, 0);
    event.id = nonEmpty(input.id) || `aven-notification:${type}:${event.taskId || 'workspace'}:${event.runId || 'event'}`;
    return event;
  }

  function recordNotification(state, input) {
    const next = normalizeState(state);
    const event = notificationEvent(input);
    if (next.notifications.delivered.some((item) => item.id === event.id)) return { state: next, event, delivered: false, duplicate: true, muted: next.notifications.muted };
    event.muted = next.notifications.muted;
    next.notifications.delivered = [...next.notifications.delivered, event].slice(-MAX_NOTIFICATIONS);
    return { state: next, event, delivered: !next.notifications.muted, duplicate: false, muted: next.notifications.muted };
  }

  function dueSchedules(state, at = nowIso()) {
    const time = new Date(at);
    if (Number.isNaN(time.valueOf())) return [];
    return normalizeState(state).schedules.filter((schedule) => schedule.enabled && schedule.nextRunAt && Date.parse(schedule.nextRunAt) <= time.valueOf()).sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt));
  }

  function historyHasDispatch(schedule, dispatchId) {
    return schedule.history.some((entry) => entry.dispatchId === dispatchId);
  }

  function scheduleFingerprint(schedule) {
    return JSON.stringify({
      id: schedule.id, title: schedule.title, taskId: schedule.taskId,
      workflowId: schedule.workflowId, workflowVersion: schedule.workflowVersion,
      cadence: schedule.cadence, timezone: schedule.timezone,
      timeOfDay: schedule.timeOfDay, weekday: schedule.weekday,
      enabled: schedule.enabled, reviewRequired: schedule.reviewRequired,
      nextRunAt: schedule.nextRunAt,
    });
  }

  function scheduleIdentity(schedule) {
    return JSON.stringify({
      id: schedule.id, title: schedule.title, taskId: schedule.taskId,
      workflowId: schedule.workflowId, workflowVersion: schedule.workflowVersion,
      cadence: schedule.cadence, timezone: schedule.timezone,
      timeOfDay: schedule.timeOfDay, weekday: schedule.weekday,
    });
  }

  function recordRun(schedule, result, at, dispatchId, trigger = 'schedule') {
    const completedAt = new Date(at).toISOString();
    const status = result.status;
    const runId = nonEmpty(result.runId) || uid();
    const entry = { id: uid(), runId, dispatchId, trigger, status, startedAt: completedAt, finishedAt: completedAt, error: short(result.error, 1000), outputRef: result.outputRef || null };
    schedule.history = [...schedule.history, entry].slice(-MAX_HISTORY);
    schedule.lastRunAt = completedAt;
    schedule.lastStatus = status;
    if (status === 'FAILED' || status === 'BLOCKED') schedule.failures = [...schedule.failures, { id: uid(), at: completedAt, message: entry.error || 'The local dispatch failed.', runId }].slice(-MAX_FAILURES);
    schedule.nextRunAt = nextRunAtAt(schedule, completedAt);
    return entry;
  }

  async function dispatchDue(state, options = {}) {
    const at = options.now || nowIso();
    const next = normalizeState(state);
    const adapter = options.adapter;
    const due = dueSchedules(next, at);
    const results = [];
    for (const dueSchedule of due) {
      const schedule = next.schedules.find((item) => item.id === dueSchedule.id);
      if (!schedule || !schedule.enabled) continue;
      const dispatchId = typeof options.dispatchIdFor === 'function' ? options.dispatchIdFor(schedule) : `${schedule.id}:${schedule.nextRunAt}`;
      const scheduleRevision = scheduleFingerprint(schedule);
      if (historyHasDispatch(schedule, dispatchId)) {
        schedule.nextRunAt = nextRunAtAt(schedule, at);
        results.push({ scheduleId: schedule.id, status: 'DEDUPED', dispatchId, scheduleRevision, trigger: options.trigger || 'schedule', executed: false });
        continue;
      }
      if (!adapter || typeof adapter.dispatch !== 'function' || adapter.authorized === false) {
        const entry = recordRun(schedule, { status: 'BLOCKED', error: 'No authorized dispatch adapter is injected. This local scheduler cannot contact providers or devices.' }, at, dispatchId, options.trigger || 'schedule');
        results.push({ scheduleId: schedule.id, status: entry.status, dispatchId, scheduleRevision, trigger: options.trigger || 'schedule', executed: false, error: entry.error });
        continue;
      }
      const definition = workflow(schedule.workflowId, schedule.workflowVersion);
      if (!definition) {
        const entry = recordRun(schedule, { status: 'BLOCKED', error: 'The procedure version is unavailable; dispatch was blocked.' }, at, dispatchId, options.trigger || 'schedule');
        results.push({ scheduleId: schedule.id, status: entry.status, dispatchId, scheduleRevision, trigger: options.trigger || 'schedule', executed: false, error: entry.error });
        continue;
      }
      try {
        const response = await adapter.dispatch({ schedule: clone(schedule), procedure: clone(definition), dispatchId });
        const entry = recordRun(schedule, { status: 'SUCCESS', runId: response?.runId, outputRef: response?.outputRef }, at, dispatchId, options.trigger || 'schedule');
        results.push({ scheduleId: schedule.id, status: entry.status, dispatchId, scheduleRevision, trigger: options.trigger || 'schedule', executed: true, runId: entry.runId });
      } catch (error) {
        const entry = recordRun(schedule, { status: 'FAILED', error: error?.message || 'Authorized adapter failed.' }, at, dispatchId, options.trigger || 'schedule');
        results.push({ scheduleId: schedule.id, status: entry.status, dispatchId, scheduleRevision, trigger: options.trigger || 'schedule', executed: true, error: entry.error });
      }
    }
    return { state: next, results };
  }

  // Apply only the occurrence result to the latest user state. A scheduler
  // tick can overlap a settings edit, so replacing the whole snapshot would
  // resurrect a disabled/deleted job or overwrite a mute preference.
  function mergeDispatchState(latestState, dispatchResult) {
    const latest = normalizeState(latestState);
    const source = normalizeState(dispatchResult?.state);
    for (const result of safeArray(dispatchResult?.results)) {
      const current = latest.schedules.find((item) => item.id === result.scheduleId);
      const completed = source.schedules.find((item) => item.id === result.scheduleId);
      if (!current || !completed) continue;
      // A changed cadence/time or an explicit disable means this occurrence is
      // stale. Only merge when the user still owns the exact due occurrence.
      const manual = result.trigger === 'manual';
      if (!manual && !current.enabled) continue;
      if (!manual && `${current.id}:${current.nextRunAt}` !== result.dispatchId) continue;
      if (result.scheduleRevision && (manual ? scheduleIdentity(current) !== scheduleIdentity(completed) : scheduleFingerprint(current) !== result.scheduleRevision)) continue;
      if (result.status === 'DEDUPED') {
        if (!manual) current.nextRunAt = completed.nextRunAt;
        continue;
      }
      const newHistory = completed.history.filter((entry) => entry.dispatchId === result.dispatchId);
      const existingHistory = new Set(current.history.map((entry) => entry.id));
      current.history = [...current.history, ...newHistory.filter((entry) => !existingHistory.has(entry.id))].slice(-MAX_HISTORY);
      const newFailures = completed.failures.filter((entry) => newHistory.some((history) => history.status !== 'SUCCESS' && history.runId === entry.runId));
      const existingFailures = new Set(current.failures.map((entry) => entry.id));
      current.failures = [...current.failures, ...newFailures.filter((entry) => !existingFailures.has(entry.id))].slice(-MAX_FAILURES);
      const entry = newHistory.at(-1);
      if (entry) {
        current.lastRunAt = completed.lastRunAt;
        current.lastStatus = completed.lastStatus;
        if (!manual) current.nextRunAt = completed.nextRunAt;
      }
    }
    return latest;
  }

  async function dispatchScheduleNow(state, id, options = {}) {
    const at = options.now || nowIso();
    const latest = normalizeState(state);
    const current = latest.schedules.find((item) => item.id === nonEmpty(id));
    if (!current) return { state: latest, results: [], error: 'That schedule is no longer available.' };
    const forced = normalizeSchedule({ ...current, enabled: true, nextRunAt: at }, 0);
    const isolated = { ...latest, schedules: [forced] };
    const result = await dispatchDue(isolated, {
      now: at, adapter: options.adapter, trigger: 'manual',
      dispatchIdFor: (schedule) => `manual:${schedule.id}:${at}`,
    });
    const fresh = typeof options.readState === 'function' ? normalizeState(options.readState()) : latest;
    return { ...result, state: mergeDispatchState(fresh, result) };
  }

  function createScheduler(options = {}) {
    let timer = null;
    let busy = false;
    const uncertainDispatches = new Set();
    const intervalMs = Math.max(1000, Number(options.intervalMs) || 30000);
    const tick = async () => {
      if (busy || typeof options.readState !== 'function') return { state: null, results: [] };
      busy = true;
      try {
        const source = normalizeState(options.readState());
        // A successful adapter call whose result could not be saved is
        // uncertain. Keep that exact occurrence out of automatic ticks until
        // the user changes or explicitly reruns it.
        source.schedules = source.schedules.filter((schedule) => !uncertainDispatches.has(`${schedule.id}:${schedule.nextRunAt}`));
        const result = await dispatchDue(source, { now: options.now?.() || nowIso(), adapter: options.adapter });
        if (!result.results.length || typeof options.onSave !== 'function') return { ...result, persisted: true, appliedResults: 0 };
        let latest;
        try { latest = mergeDispatchState(options.readState(), result); } catch (error) {
          result.results.forEach((item) => uncertainDispatches.add(item.dispatchId));
          return { ...result, persisted: false, appliedResults: 0, saveError: error?.message || 'Latest workspace state could not be read; no automatic retry was made.' };
        }
        try {
          const saved = await options.onSave(latest, result);
          if (saved === false) {
            result.results.forEach((item) => uncertainDispatches.add(item.dispatchId));
            return { ...result, state: latest, persisted: false, appliedResults: 0, saveError: 'The occurrence result could not be saved; no automatic retry was made.' };
          }
          const appliedResults = result.results.filter((item) => latest.schedules.some((schedule) => {
            if (schedule.id !== item.scheduleId) return false;
            if (item.status === 'DEDUPED') return schedule.nextRunAt !== item.dispatchId.slice(`${item.scheduleId}:`.length);
            return schedule.history.some((entry) => entry.dispatchId === item.dispatchId);
          })).length;
          result.results.filter((item) => !latest.schedules.some((schedule) => schedule.id === item.scheduleId && (item.status === 'DEDUPED' ? schedule.nextRunAt !== item.dispatchId.slice(`${item.scheduleId}:`.length) : schedule.history.some((entry) => entry.dispatchId === item.dispatchId)))).forEach((item) => uncertainDispatches.add(item.dispatchId));
          return { ...result, state: latest, persisted: true, appliedResults };
        } catch (error) {
          result.results.forEach((item) => uncertainDispatches.add(item.dispatchId));
          return { ...result, state: latest, persisted: false, appliedResults: 0, saveError: error?.message || 'The occurrence result could not be saved; no automatic retry was made.' };
        }
      } finally { busy = false; }
    };
    return Object.freeze({
      start() { if (!timer) { timer = setInterval(() => { tick().catch((error) => options.onError?.(error)); }, intervalMs); tick().catch((error) => options.onError?.(error)); } return true; },
      stop() { if (timer) clearInterval(timer); timer = null; return true; },
      async tick() { return tick(); },
      isRunning() { return Boolean(timer); },
    });
  }

  function escapeText(value) { return text(value); }
  function createElement(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function uiButton(label, className, action) {
    const node = createElement('button', className, label); node.type = 'button'; if (action) node.addEventListener('click', action); return node;
  }
  function labelFor(label, input) { const node = createElement('label', 'aven-automation-label', label); node.htmlFor = input.id; return node; }
  function formatTime(value, timezone) {
    if (!validDate(value)) return 'Not scheduled';
    try { return new Intl.DateTimeFormat(undefined, { timeZone: resolvedTimezone(timezone) || TZ_FALLBACK, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); } catch (_) { return 'Time unavailable'; }
  }
  function workflowLabel(schedule) { const found = workflow(schedule.workflowId, schedule.workflowVersion); return found ? `${found.name} · v${found.version}` : 'Procedure version unavailable'; }
  function statusBadge(status) { return status === 'SUCCESS' ? 'Succeeded' : status === 'FAILED' ? 'Failed' : status === 'BLOCKED' ? 'Blocked' : status === 'PAUSED' ? 'Paused' : status === 'NEVER' ? 'Never run' : 'Unknown'; }

  function renderScheduleForm(container, state, options, onDone) {
    const form = createElement('form', 'aven-automation-form'); form.noValidate = true;
    const title = createElement('input'); title.id = 'aven-automation-title'; title.type = 'text'; title.maxLength = 160; title.required = true; title.autocomplete = 'off';
    const procedure = createElement('select'); procedure.id = 'aven-automation-procedure';
    WORKFLOW_REGISTRY.forEach((item) => { const option = createElement('option'); option.value = `${item.id}@${item.version}`; option.textContent = `${item.name} · v${item.version}`; procedure.append(option); });
    const task = document.createElement('select'); task.id = 'aven-automation-task'; task.setAttribute('aria-label', 'Saved conversation target'); const taskOptions = safeArray(options.taskOptions); if (taskOptions.length) taskOptions.forEach((item) => { const option = createElement('option'); option.value = nonEmpty(item.value || item.id); option.textContent = short(item.label || item.title || item.value || item.id, 160); task.append(option); }); else { const option = createElement('option'); option.value = ''; option.textContent = 'No saved conversation target'; task.append(option); } task.value = nonEmpty(options.selectedTaskId) || task.options[0]?.value || '';
    const cadence = createElement('select'); cadence.id = 'aven-automation-cadence'; [['daily', 'Daily'], ['weekly', 'Weekly'], ['hourly', 'Hourly']].forEach(([value, label]) => { const option = createElement('option'); option.value = value; option.textContent = label; cadence.append(option); });
    const time = createElement('input'); time.id = 'aven-automation-time'; time.type = 'time'; time.value = '09:00';
    const timezone = createElement('select'); timezone.id = 'aven-automation-timezone';
    [...new Set(['Follow system', 'UTC', 'Asia/Kolkata', 'America/Los_Angeles', systemTimezone()])].forEach((zone) => { const option = createElement('option'); option.value = zone; option.textContent = zone; timezone.append(option); });
    const weekday = createElement('select'); weekday.id = 'aven-automation-weekday'; [['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday'], ['0', 'Sunday']].forEach(([value, label]) => { const option = createElement('option'); option.value = value; option.textContent = label; weekday.append(option); });
    const weekdayWrap = createElement('div', 'aven-automation-field'); weekdayWrap.append(labelFor('Weekday', weekday), weekday);
    const fields = createElement('div', 'aven-automation-form-grid');
    fields.append(createElement('div', 'aven-automation-field'), createElement('div', 'aven-automation-field'));
    fields.children[0].append(labelFor('Name', title), title); fields.children[1].append(labelFor('Procedure', procedure), procedure);
    const cadenceWrap = createElement('div', 'aven-automation-field'); cadenceWrap.append(labelFor('Cadence', cadence), cadence);
    const timeWrap = createElement('div', 'aven-automation-field'); timeWrap.append(labelFor('Time', time), time);
    const tzWrap = createElement('div', 'aven-automation-field'); tzWrap.append(labelFor('Time zone', timezone), timezone);
    const targetWrap = createElement('div', 'aven-automation-field'); targetWrap.append(labelFor('Saved conversation target', task), task);
    fields.append(cadenceWrap, timeWrap, tzWrap, weekdayWrap, targetWrap); form.append(createElement('h3', '', 'Add a schedule'), fields);
    form.append(createElement('p', 'aven-automation-help', 'New schedules start disabled. Review the procedure, time zone and next run before enabling one.'));
    const status = createElement('p', 'aven-automation-form-status'); status.setAttribute('role', 'status');
    const actions = createElement('div', 'aven-automation-form-actions'); const cancel = uiButton('Cancel', 'button-secondary', onDone); const submit = uiButton('Save disabled schedule', 'button-primary'); submit.type = 'submit'; actions.append(cancel, submit); form.append(status, actions);
    form.addEventListener('change', () => { const parsed = procedure.value.split('@'); const preview = nextRunAt({ cadence: cadence.value, timezone: timezone.value, timeOfDay: time.value, weekday: Number(weekday.value), from: options.now?.() || nowIso() }); status.textContent = preview ? `Preview next run: ${formatTime(preview, timezone.value)} · paused until explicitly enabled.` : 'Next run unavailable for this time zone.'; weekdayWrap.hidden = cadence.value !== 'weekly'; });
    form.dispatchEvent(new Event('change'));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const [workflowId, workflowVersion] = procedure.value.split('@');
      const result = makeSchedule({ title: title.value, taskId: task.value, workflowId, workflowVersion, cadence: cadence.value, timezone: timezone.value, timeOfDay: time.value, weekday: Number(weekday.value) }, options.now?.() || nowIso());
      if (!result.ok) { status.textContent = result.errors.join(' '); return; }
      const next = normalizeState(state); next.schedules.unshift(result.schedule);
      if (next.schedules.length > MAX_SCHEDULES) { status.textContent = `You can keep up to ${MAX_SCHEDULES} schedules.`; return; }
      if (typeof options.onSave !== 'function' || options.onSave(next) !== true) { status.textContent = 'Could not save this schedule. Existing records are unchanged.'; return; }
      Object.keys(state).forEach((key) => { delete state[key]; }); Object.assign(state, normalizeState(next));
      onDone(); options.onStatus?.('Disabled schedule saved locally.');
    });
    return form;
  }

  function scheduleCard(schedule, state, options, rerender) {
    const card = createElement('article', 'aven-automation-card'); card.dataset.scheduleId = schedule.id;
    const top = createElement('div', 'aven-automation-card-top'); const heading = createElement('div'); heading.append(createElement('h3', '', schedule.title || 'Untitled schedule'), createElement('p', 'aven-automation-meta', workflowLabel(schedule))); const badge = createElement('span', `aven-automation-badge ${schedule.enabled ? 'is-enabled' : 'is-paused'}`, schedule.enabled ? 'Enabled' : 'Disabled'); top.append(heading, badge); card.append(top);
    card.append(createElement('p', 'aven-automation-body', schedule.enabled ? `Next run: ${formatTime(schedule.nextRunAt, schedule.timezone)} · ${schedule.timezone}` : `Paused · next preview ${formatTime(schedule.nextRunAt, schedule.timezone)} · ${schedule.timezone}`));
    if (schedule.taskId) card.append(createElement('p', 'aven-automation-meta', `Saved conversation target: ${schedule.taskId}`));
    if (schedule.reviewRequired) card.append(createElement('p', 'aven-automation-warning', 'Review required before enabling this imported schedule.'));
    const last = schedule.lastRunAt ? `Last run: ${formatTime(schedule.lastRunAt, schedule.timezone)} · ${statusBadge(schedule.lastStatus)}` : 'No run has been recorded.'; card.append(createElement('p', 'aven-automation-meta', last));
    if (schedule.failures.length) { const failure = schedule.failures.at(-1); card.append(createElement('p', 'aven-automation-warning', `Latest failure: ${failure.message || 'The local dispatch failed.'}`)); }
    const actions = createElement('div', 'aven-automation-card-actions');
    const toggle = uiButton(schedule.enabled ? 'Disable' : 'Enable', 'button-secondary', () => { const result = updateSchedule(state, schedule.id, { enabled: !schedule.enabled }, options.now?.() || nowIso()); if (!result.ok) { options.onStatus?.(result.errors.join(' ')); return; } if (options.onSave?.(result.state) !== true) { options.onStatus?.('Could not save that schedule.'); return; } options.onStatus?.(result.state.schedules.find((item) => item.id === schedule.id).enabled ? 'Schedule enabled explicitly.' : 'Schedule disabled. No dispatch will run.'); rerender(); }); actions.append(toggle);
    const runNow = uiButton('Run now', 'button-secondary', async () => { if (!options.adapter || typeof options.adapter.dispatch !== 'function' || options.adapter.authorized === false) { options.onStatus?.('Run blocked: no authorized local adapter is connected.'); return; } let result; try { result = await dispatchScheduleNow(state, schedule.id, { now: options.now?.() || nowIso(), readState: options.readState, adapter: options.adapter }); } catch (error) { options.onStatus?.(`Run failed: ${error?.message || 'The authorized adapter failed.'}`); return; } if (!result.results.length) { options.onStatus?.(result.error || 'That schedule could not be run.'); return; } let saved = false; try { saved = options.onSave?.(result.state) === true; } catch (_) { saved = false; } if (saved) { options.onStatus?.(`Run recorded: ${statusBadge(result.results[0].status)}.`); rerender(); } else options.onStatus?.('Run completed but the result could not be saved; no automatic retry was made.'); });
    runNow.title = options.adapter ? 'Dispatch through the injected authorized adapter' : 'Unavailable without an injected authorized adapter'; runNow.disabled = !options.adapter; actions.append(runNow);
    if (schedule.history.length) { const history = uiButton(`History (${schedule.history.length})`, 'button-quiet', () => { const list = card.querySelector('.aven-automation-history'); if (list) list.hidden = !list.hidden; }); actions.append(history); }
    card.append(actions);
    if (schedule.history.length) { const list = createElement('div', 'aven-automation-history'); list.hidden = true; schedule.history.slice().reverse().slice(0, 8).forEach((entry) => { list.append(createElement('p', 'aven-automation-history-row', `${statusBadge(entry.status)} · ${formatTime(entry.finishedAt, schedule.timezone)}${entry.error ? ` · ${entry.error}` : ''}`)); }); card.append(list); }
    return card;
  }

  function renderNotifications(state, options) {
    const section = createElement('section', 'aven-automation-section'); const header = createElement('div', 'aven-automation-section-header'); header.append(createElement('h3', '', 'Alerts')); const mute = createElement('input'); mute.type = 'checkbox'; mute.id = 'aven-automation-mute'; mute.checked = state.notifications.muted; const muteLabel = createElement('label', 'aven-automation-toggle', 'Mute local alerts'); muteLabel.htmlFor = mute.id; mute.addEventListener('click', (event) => event.stopPropagation()); mute.addEventListener('change', () => { const next = normalizeState(state); next.notifications.muted = mute.checked; if (options.onSave?.(next) === true) options.onStatus?.(mute.checked ? 'Local alerts muted.' : 'Local alerts unmuted.'); }); header.append(muteLabel, mute); section.append(header); section.append(createElement('p', 'aven-automation-help', 'Meaningful completion, failure and input-required events are deduplicated by event ID. Alerts open saved local work when a task opener is connected.'));
    const list = createElement('div', 'aven-automation-alert-list'); const events = state.notifications.delivered.slice().reverse(); if (!events.length) list.append(createElement('p', 'aven-automation-empty', 'No local alerts recorded.')); else events.forEach((event) => { const card = createElement('article', `aven-automation-alert ${event.read ? 'is-read' : ''}`); const top = createElement('div', 'aven-automation-card-top'); top.append(createElement('strong', '', event.title || 'Workspace alert'), createElement('span', 'aven-automation-meta', event.type)); card.append(top, createElement('p', 'aven-automation-body', event.message || 'No additional detail.')); const meta = [event.taskId && `Task ${event.taskId}`, event.runId && `Run ${event.runId}`, formatTime(event.createdAt)].filter(Boolean).join(' · '); card.append(createElement('p', 'aven-automation-meta', meta)); const actions = createElement('div', 'aven-automation-card-actions'); if (event.taskId && typeof options.onOpenTask === 'function') { const open = uiButton('Open task', 'button-secondary', () => options.onOpenTask(event.taskId)); actions.append(open); } const mark = uiButton(event.read ? 'Marked read' : 'Mark read', 'button-quiet', () => { const next = normalizeState(state); const found = next.notifications.delivered.find((item) => item.id === event.id); if (found) found.read = true; if (options.onSave?.(next) === true) options.onStatus?.('Alert marked read.'); }); actions.append(mark); card.append(actions); list.append(card); }); section.append(list); return section;
  }

  function renderPlugins(state, options) {
    const section = createElement('section', 'aven-automation-section'); section.append(createElement('h3', '', 'Plugin capability registry')); section.append(createElement('p', 'aven-automation-help', 'This is a local registry. It does not install plugins, request credentials or establish connections. Unavailable capabilities cannot be selected.'));
    const list = createElement('div', 'aven-automation-registry-list'); PLUGIN_REGISTRY.forEach((plugin) => { const card = createElement('article', 'aven-automation-registry-card'); const top = createElement('div', 'aven-automation-card-top'); top.append(createElement('h4', '', plugin.name), createElement('span', `aven-automation-badge ${plugin.availability === 'available' ? 'is-enabled' : 'is-paused'}`, plugin.availability === 'available' ? 'Available locally' : 'Unavailable')); card.append(top, createElement('p', 'aven-automation-body', plugin.description)); card.append(createElement('p', 'aven-automation-meta', `Capabilities: ${plugin.capabilities.join(', ')}`)); card.append(createElement('p', 'aven-automation-meta', `Required access: ${plugin.requiredPermissions.join(', ')}`)); card.append(createElement('p', 'aven-automation-meta', `Connection health: ${plugin.connectionHealth} · ${plugin.availabilityReason}`)); const selection = createElement('label', 'aven-automation-plugin-select', 'Use in local procedure'); const checkbox = createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.selectedPluginIds.includes(plugin.id); checkbox.disabled = plugin.availability !== 'available'; checkbox.addEventListener('change', () => { const result = selectPlugin(state, plugin.id, checkbox.checked); if (!result.ok) { checkbox.checked = false; options.onStatus?.(result.error); return; } if (options.onSave?.(result.state) === true) options.onStatus?.('Local capability selection saved.'); }); selection.prepend(checkbox); card.append(selection); list.append(card); }); section.append(list); return section;
  }

  function renderWorkflows() {
    const section = createElement('section', 'aven-automation-section'); section.append(createElement('h3', '', 'Reusable procedures')); section.append(createElement('p', 'aven-automation-help', 'Each procedure is versioned. A schedule stores the exact version selected; dispatch is blocked if that version is unavailable.'));
    const list = createElement('div', 'aven-automation-registry-list'); WORKFLOW_REGISTRY.forEach((item) => { const card = createElement('article', 'aven-automation-registry-card'); const top = createElement('div', 'aven-automation-card-top'); top.append(createElement('h4', '', item.name), createElement('span', 'aven-automation-badge is-enabled', `v${item.version}`)); card.append(top, createElement('p', 'aven-automation-body', item.purpose), createElement('p', 'aven-automation-meta', `Inputs: ${item.inputs.join(', ')}`), createElement('p', 'aven-automation-meta', `Required access: ${item.requiredAccess.join(', ')}`), createElement('p', 'aven-automation-meta', `Evidence: ${item.evidenceRequirements.join(', ')}`), createElement('p', 'aven-automation-meta', `Procedure: ${item.procedure}`)); list.append(card); }); section.append(list); return section;
  }

  function render(container, options = {}) {
    if (!container || typeof container.replaceChildren !== 'function') throw new TypeError('A DOM container is required.');
    const opts = options && typeof options === 'object' ? options : {};
    let state = normalizeState(opts.state || opts.data?.workspaceTools?.automation);
    let formOpen = false;
    let status = '';
    let destroyed = false;
    const rerender = () => { if (destroyed) return; container.replaceChildren(); const view = createElement('section', 'aven-automation-view'); const header = createElement('header', 'aven-automation-header'); header.append(createElement('div', '', undefined)); header.firstElementChild.append(createElement('p', 'aven-automation-eyebrow', 'LOCAL WORKSPACE'), createElement('h2', '', 'Schedules & procedures'), createElement('p', 'aven-automation-description', 'Define bounded work with visible access, timing, outcomes and alerts. The scheduler runs only while Aven is open and only through an injected authorized adapter.')); const count = createElement('span', 'aven-automation-count', `${state.schedules.length}/${MAX_SCHEDULES}`); header.append(count); view.append(header); const statusNode = createElement('p', 'aven-automation-status', status); statusNode.setAttribute('role', 'status'); statusNode.setAttribute('aria-live', 'polite'); view.append(statusNode); const toolbar = createElement('div', 'aven-automation-toolbar'); const add = uiButton(formOpen ? 'Close form' : 'Add schedule', 'button-primary', () => { formOpen = !formOpen; status = ''; rerender(); }); toolbar.append(add); view.append(toolbar); if (formOpen) view.append(renderScheduleForm(view, state, opts, () => { formOpen = false; rerender(); })); const schedules = createElement('section', 'aven-automation-section'); schedules.append(createElement('h3', '', `Schedules · ${state.schedules.length}`)); if (!state.schedules.length) schedules.append(createElement('p', 'aven-automation-empty', 'No schedules yet. Add one to preview a disabled job.')); state.schedules.forEach((schedule) => schedules.append(scheduleCard(schedule, state, { ...opts, onStatus: (message) => { status = message; }, onSave: (next) => { const accepted = typeof opts.onSave === 'function' && opts.onSave(clone(next)) === true; if (accepted) state = normalizeState(next); return accepted; } }, rerender))); view.append(schedules, renderNotifications(state, { ...opts, onSave: (next) => { const accepted = typeof opts.onSave === 'function' && opts.onSave(clone(next)) === true; if (accepted) state = normalizeState(next); return accepted; }, onStatus: (message) => { status = message; rerender(); } }), renderPlugins(state, { ...opts, onSave: (next) => { const accepted = typeof opts.onSave === 'function' && opts.onSave(clone(next)) === true; if (accepted) state = normalizeState(next); return accepted; }, onStatus: (message) => { status = message; rerender(); } }), renderWorkflows()); container.append(view); };
    const api = { refresh() { state = normalizeState(opts.state || opts.data?.workspaceTools?.automation); rerender(); return api; }, getState() { return clone(state); }, destroy() { destroyed = true; container.replaceChildren(); } };
    rerender(); return api;
  }

  function goalCompletionCheck(goal, resolveEvidence) {
    const value = goal && typeof goal === 'object' ? goal : {};
    const resolve = typeof resolveEvidence === 'function' ? resolveEvidence : () => false;
    const checked = safeArray(value.steps).filter((step) => step?.done === true);
    const missing = checked.filter((step) => !step?.evidence || !resolve(step.evidence));
    const completion = value.completion?.evidence || value.completionEvidence || value.evidenceRef;
    return { ok: missing.length === 0 && Boolean(completion && resolve(completion)), missingStepIds: missing.map((step) => step.id), missingGoalEvidence: !completion || !resolve(completion), reason: missing.length ? 'Every checked step must cite an existing chat message as evidence.' : !completion || !resolve(completion) ? 'Goal completion requires an existing chat message as evidence.' : '' };
  }

  return Object.freeze({ VERSION, CADENCES, EVENT_TYPES, PLUGIN_REGISTRY, WORKFLOW_REGISTRY, normalizeState, isValidTimezone, nextRunAt, workflow, validateSchedule, makeSchedule, updateSchedule, selectPlugin, notificationEvent, recordNotification, dueSchedules, dispatchDue, dispatchScheduleNow, mergeDispatchState, createScheduler, goalCompletionCheck, render });
});
