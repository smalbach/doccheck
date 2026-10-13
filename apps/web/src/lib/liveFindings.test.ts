import { describe, expect, it } from 'vitest';
import type { ProgressEvent } from '../api/types';
import { applyFindingEvent, dismissedFindings, findingAnchorId, type LiveFinding } from './liveFindings';
import { agentStatus, applyEvent, EMPTY_PROGRESS } from './progressTimeline';

let nextId = 1;
/** A validation event of run-1; `t` is seconds after a fixed start. */
const v = (stage: string, status: ProgressEvent['status'], detail: Record<string, unknown> = {}, t = 0): ProgressEvent =>
  ({ id: nextId++, shipmentId: 's', userId: 'u', runId: 'run-1', kind: 'validation', stage, status, at: new Date(Date.UTC(2026, 9, 13, 10, 0, t)).toISOString(), detail }) as ProgressEvent;

const X1 = { id: 's:X1:0', severity: 'HIGH', message: 'Consignee differs' } as const;
const X2 = { id: 's:X2:0', severity: 'MEDIUM', message: 'Package count differs' } as const;
const A1 = { id: 's:A1:0', severity: 'MEDIUM', message: 'The BL describes other goods' } as const;

const apply = (events: ProgressEvent[], from: readonly LiveFinding[] = []) => events.reduce(applyFindingEvent, from);

describe('live findings', () => {
  it('adds the findings each rule reports, once, under their stored id', () => {
    const rule = v('rules', 'progress', { rule: 'X1', index: 1, total: 2, findings: 1, found: [X1] });
    const findings = apply([v('rules', 'started', { documents: 3 }), rule, v('rules', 'progress', { rule: 'X3', index: 2, total: 2, findings: 0 }), rule]);
    expect(findings).toEqual([{ ...X1, ruleId: 'X1' }]);
  });

  it('attaches the regulation title during the citations, ignoring unknown findings', () => {
    const found = apply([v('rules', 'progress', { rule: 'X1', found: [X1] }), v('rules', 'progress', { rule: 'X2', found: [X2] })]);
    const cited = apply([v('citations', 'progress', { findingId: X2.id, title: 'D1-4-1 — Field 11' }), v('citations', 'progress', { findingId: 'nope', title: 'x' })], found);
    expect(cited.map((f) => f.regulation)).toEqual([undefined, 'D1-4-1 — Field 11']);
    expect(applyFindingEvent(cited, v('citations', 'done', { citations: 1 }))).toBe(cited);
  });

  it('marks the finding a question is about, then the effect of the answer; adds what the agent found', () => {
    const found = apply([v('rules', 'progress', { rule: 'X1', found: [X1] })]);
    const asked = apply([v('agent', 'progress', { index: 1, total: 2, ruleId: 'X1', question: 'Same consignee?', findingId: X1.id })], found);
    expect(asked[0]).toMatchObject({ question: 1 });
    expect(asked[0]?.effect).toBeUndefined();
    const answered = apply(
      [
        v('agent', 'progress', { index: 1, total: 2, ruleId: 'X1', findingId: X1.id, answer: { verdict: 'yes', confidence: 0.9, rationale: 'Same company.', effect: 'dismissed' } }),
        v('agent', 'progress', { index: 2, total: 2, ruleId: 'A1', question: 'BL consistent?' }),
        v('agent', 'progress', { index: 2, total: 2, ruleId: 'A1', findingId: A1.id, added: A1, answer: { verdict: 'no', confidence: 0.8, rationale: 'Other goods.', effect: 'added' } }),
      ],
      asked,
    );
    expect(answered).toEqual([
      { ...X1, ruleId: 'X1', question: 1, effect: 'dismissed', rationale: 'Same company.' },
      { ...A1, ruleId: 'A1', question: 2, effect: 'added', rationale: 'Other goods.' },
    ]);
    expect(dismissedFindings(answered).map((f) => f.id)).toEqual([X1.id]);
  });

  it('leaves a finding without an effect when the answer changes nothing', () => {
    const found = apply([v('rules', 'progress', { rule: 'X1', found: [X1] })]);
    const after = apply([v('agent', 'progress', { index: 1, findingId: X1.id, answer: { verdict: 'unsure', confidence: 0.4, effect: 'none' } })], found);
    expect(after[0]?.effect).toBeUndefined();
    expect(after[0]?.question).toBe(1);
  });

  it('builds into the validation run, with the time each question was asked and answered', () => {
    const state = [
      v('started', 'started', { agent: true }, 0),
      v('rules', 'started', { documents: 3 }, 0),
      v('rules', 'progress', { rule: 'X1', index: 1, total: 1, findings: 1, found: [X1] }, 0),
      v('rules', 'done', { ran: 1, total: 1, findings: 1 }, 1),
      v('agent', 'started', { total: 1 }, 2),
      v('agent', 'progress', { index: 1, total: 1, ruleId: 'X1', question: 'Same?', findingId: X1.id }, 2),
      v('agent', 'progress', { index: 1, total: 1, ruleId: 'X1', question: 'Same?', findingId: X1.id, answer: { verdict: 'no', confidence: 0.8, effect: 'kept' } }, 5),
    ].reduce(applyEvent, EMPTY_PROGRESS);
    const run = state.validation!;
    expect(run.findings).toMatchObject([{ id: X1.id, effect: 'kept' }]);
    expect(run.questions[0]).toMatchObject({ findingId: X1.id, askedAt: '2026-10-13T10:00:02.000Z', answeredAt: '2026-10-13T10:00:05.000Z' });
    expect(agentStatus(run)).toBe('asking');
  });

  it('gives each finding card a DOM id', () => {
    expect(findingAnchorId('s:X1:0')).toBe('finding-card-s:X1:0');
  });
});

describe('agent status', () => {
  const run = (events: ProgressEvent[]) => events.reduce(applyEvent, EMPTY_PROGRESS).validation!;
  it('says when the agent was off, failed, had nothing to ask or is not reached yet', () => {
    expect(agentStatus(run([v('rules', 'started')]))).toBe('pending');
    expect(agentStatus(run([v('agent', 'skipped', { reason: 'disabled' })]))).toBe('disabled');
    expect(agentStatus(run([v('agent', 'skipped', { reason: 'citations-failed' })]))).toBe('failed');
    expect(agentStatus(run([v('agent', 'started', { total: 1 }), v('agent', 'failed', { error: 'Ollama is not reachable' })]))).toBe('failed');
    expect(agentStatus(run([v('agent', 'started', { total: 0 }), v('agent', 'done', { decisions: 0 })]))).toBe('none');
  });
});
