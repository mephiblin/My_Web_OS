const packageLifecycleService = require('./packageLifecycleService');

const CHANNEL_ORDER = ['stable', 'beta', 'alpha', 'canary'];
const CHANNEL_DELAY_MS = {
  stable: 24 * 60 * 60 * 1000,
  beta: 6 * 60 * 60 * 1000,
  alpha: 60 * 60 * 1000,
  canary: 0
};

function normalizeChannel(value, fallback = 'stable') {
  const normalized = String(value || '').trim().toLowerCase();
  if (CHANNEL_ORDER.includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function getChannelRank(channel) {
  const normalized = normalizeChannel(channel);
  return CHANNEL_ORDER.indexOf(normalized);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toIso(value) {
  const date = value instanceof Date ? value : null;
  if (!date) return '';
  return date.toISOString();
}

function isChannelEligible(targetChannel, candidateChannel) {
  const targetRank = getChannelRank(targetChannel);
  const candidateRank = getChannelRank(candidateChannel);
  return candidateRank <= targetRank;
}

function evaluateCandidate(options = {}) {
  const installedVersion = String(options.installedVersion || '0.0.0').trim() || '0.0.0';
  const candidateVersion = String(options.candidateVersion || '0.0.0').trim() || '0.0.0';
  const targetChannel = normalizeChannel(options.targetChannel, 'stable');
  const candidateChannel = normalizeChannel(options.candidateChannel, 'stable');
  const now = options.now instanceof Date ? options.now : new Date();
  const publishedAt = parseDate(options.publishedAt);
  const rolloutDelayMs = Number.isFinite(Number(options.rolloutDelayMs))
    ? Math.max(0, Number(options.rolloutDelayMs))
    : CHANNEL_DELAY_MS[candidateChannel] || 0;
  const availableAt = publishedAt ? new Date(publishedAt.getTime() + rolloutDelayMs) : null;

  const eligibleByChannel = isChannelEligible(targetChannel, candidateChannel);
  const eligibleByTime = !availableAt || now >= availableAt;
  const isNewer = packageLifecycleService.compareVersions(candidateVersion, installedVersion) > 0;
  const allowed = isNewer && eligibleByChannel && eligibleByTime;
  const blockedReason = !isNewer
    ? 'not-newer'
    : !eligibleByChannel
      ? 'channel-policy-blocked'
      : !eligibleByTime
        ? 'rollout-delay-active'
        : '';

  return {
    installedVersion,
    candidateVersion,
    targetChannel,
    candidateChannel,
    rolloutDelayMs,
    publishedAt: toIso(publishedAt),
    availableAt: toIso(availableAt),
    isNewer,
    eligibleByChannel,
    eligibleByTime,
    allowed,
    blockedReason
  };
}

function selectBestUpdate(options = {}) {
  const installedVersion = String(options.installedVersion || '0.0.0').trim() || '0.0.0';
  const targetChannel = normalizeChannel(options.targetChannel, 'stable');
  const now = options.now instanceof Date ? options.now : new Date();
  const candidates = Array.isArray(options.candidates) ? options.candidates : [];

  const evaluations = candidates
    .map((candidate) => ({
      candidate,
      policy: evaluateCandidate({
        installedVersion,
        candidateVersion: candidate.version,
        candidateChannel: candidate.channel,
        targetChannel,
        publishedAt: candidate.publishedAt,
        rolloutDelayMs: candidate.rolloutDelayMs,
        now
      })
    }));

  const allowed = evaluations
    .filter((entry) => entry.policy.allowed)
    .sort((a, b) => packageLifecycleService.compareVersions(b.policy.candidateVersion, a.policy.candidateVersion));

  return {
    targetChannel,
    installedVersion,
    hasUpdate: allowed.length > 0,
    selected: allowed.length > 0
      ? {
        ...allowed[0].candidate,
        policy: allowed[0].policy
      }
      : null,
    evaluations: evaluations.map((entry) => ({
      id: String(entry.candidate.id || '').trim(),
      version: String(entry.candidate.version || '').trim(),
      channel: normalizeChannel(entry.candidate.channel, 'stable'),
      publishedAt: entry.policy.publishedAt,
      availableAt: entry.policy.availableAt,
      policy: entry.policy
    }))
  };
}

module.exports = {
  CHANNEL_ORDER: [...CHANNEL_ORDER],
  CHANNEL_DELAY_MS: { ...CHANNEL_DELAY_MS },
  normalizeChannel,
  getChannelRank,
  isChannelEligible,
  evaluateCandidate,
  selectBestUpdate
};
