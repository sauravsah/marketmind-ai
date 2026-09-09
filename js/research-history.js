const DEFAULT_RUN_LIMIT = 5;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function countResearchSignals(research) {
  return ['marketSignals', 'audienceSignals', 'industryDevelopments', 'culturalSignals', 'competitorSignals', 'events', 'technologySignals']
    .reduce((total, key) => total + (Array.isArray(research?.[key]) ? research[key].length : 0), 0);
}

export function createResearchRunSnapshot(research, { id, now = new Date() } = {}) {
  const snapshot = clone(research || {});
  delete snapshot.runs;
  delete snapshot.activeRunId;
  const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const runId = id || `research-run-${timestamp.replace(/[^0-9]/g, '')}`;
  return {
    id: runId,
    researchedAt: snapshot.meta?.researchedAt || timestamp,
    depth: snapshot.meta?.depth || 'balanced',
    sourceCount: Array.isArray(snapshot.sources) ? snapshot.sources.length : 0,
    signalCount: countResearchSignals(snapshot),
    providerStatus: snapshot.meta?.providerStatus || 'unknown',
    aiStatus: snapshot.meta?.aiStatus || 'unknown',
    summary: snapshot.researchSummary || '',
    snapshot,
  };
}

export function appendResearchRun(previousResearch, nextResearch, { id, now = new Date(), maxRuns = DEFAULT_RUN_LIMIT } = {}) {
  const priorRuns = Array.isArray(previousResearch?.runs) ? previousResearch.runs.map(clone) : [];
  const run = createResearchRunSnapshot(nextResearch, { id, now });
  const runs = [...priorRuns, run].slice(-Math.max(1, Number(maxRuns) || DEFAULT_RUN_LIMIT));
  return { ...clone(nextResearch), activeRunId: run.id, runs };
}

export function researchRunIsCurrent(run, research) {
  return Boolean(run?.id && run.id === research?.activeRunId);
}
