import { createActor } from 'xstate';
import {
  dmSessionMachine,
  getNextState,
  isSessionExpired,
  stateValueToStatus,
  statusToStateValue,
} from '../dm-state-machine.js';
import type { DMStateValue } from '../dm-state-machine.js';

describe('dmSessionMachine', () => {
  it('starts in waiting state', () => {
    const actor = createActor(dmSessionMachine).start();
    expect(actor.getSnapshot().value).toBe('waiting');
    actor.stop();
  });

  it('transitions from waiting to active on START', () => {
    const actor = createActor(dmSessionMachine).start();
    actor.send({ type: 'START' });
    expect(actor.getSnapshot().value).toBe('active');
    actor.stop();
  });

  it('transitions from active to scene_submission on BEGIN_SCENE', () => {
    const actor = createActor(dmSessionMachine).start();
    actor.send({ type: 'START' });
    actor.send({ type: 'BEGIN_SCENE' });
    expect(actor.getSnapshot().value).toBe('scene_submission');
    actor.stop();
  });

  it('accumulates SUBMIT_RESPONSE events', () => {
    const actor = createActor(dmSessionMachine).start();
    actor.send({ type: 'START' });
    actor.send({ type: 'BEGIN_SCENE' });
    actor.send({ type: 'SUBMIT_RESPONSE', userId: 'user-a' });
    expect(actor.getSnapshot().context.responsesSubmitted).toContain('user-a');
    actor.send({ type: 'SUBMIT_RESPONSE', userId: 'user-b' });
    expect(actor.getSnapshot().context.responsesSubmitted).toEqual(['user-a', 'user-b']);
    actor.stop();
  });

  it('moves from scene_submission to scene_review when both responded', () => {
    const actor = createActor(dmSessionMachine).start();
    actor.send({ type: 'START' });
    actor.send({ type: 'BEGIN_SCENE' });
    actor.send({ type: 'SUBMIT_RESPONSE', userId: 'user-a' });
    actor.send({ type: 'SUBMIT_RESPONSE', userId: 'user-b' });
    actor.send({ type: 'REVIEW_SCENE' });
    expect(actor.getSnapshot().value).toBe('scene_review');
    actor.stop();
  });

  it('transitions from scene_review to active on ADVANCE_SCENE', () => {
    const actor = createActor(dmSessionMachine).start();
    actor.send({ type: 'START' });
    actor.send({ type: 'BEGIN_SCENE' });
    actor.send({ type: 'SUBMIT_RESPONSE', userId: 'user-a' });
    actor.send({ type: 'SUBMIT_RESPONSE', userId: 'user-b' });
    actor.send({ type: 'REVIEW_SCENE' });
    actor.send({ type: 'ADVANCE_SCENE' });
    expect(actor.getSnapshot().value).toBe('active');
    actor.stop();
  });

  it('transitions from scene_review to debrief on BEGIN_DEBRIEF', () => {
    const actor = createActor(dmSessionMachine).start();
    actor.send({ type: 'START' });
    actor.send({ type: 'BEGIN_SCENE' });
    actor.send({ type: 'SUBMIT_RESPONSE', userId: 'user-a' });
    actor.send({ type: 'SUBMIT_RESPONSE', userId: 'user-b' });
    actor.send({ type: 'REVIEW_SCENE' });
    actor.send({ type: 'BEGIN_DEBRIEF' });
    expect(actor.getSnapshot().value).toBe('debrief');
    actor.stop();
  });

  it('transitions from debrief to completed on COMPLETE', () => {
    const actor = createActor(dmSessionMachine).start();
    actor.send({ type: 'START' });
    actor.send({ type: 'BEGIN_SCENE' });
    actor.send({ type: 'SUBMIT_RESPONSE', userId: 'user-a' });
    actor.send({ type: 'SUBMIT_RESPONSE', userId: 'user-b' });
    actor.send({ type: 'REVIEW_SCENE' });
    actor.send({ type: 'BEGIN_DEBRIEF' });
    actor.send({ type: 'COMPLETE' });
    expect(actor.getSnapshot().value).toBe('completed');
    actor.stop();
  });

  it('transitions from waiting to expired on EXPIRE', () => {
    const actor = createActor(dmSessionMachine).start();
    actor.send({ type: 'EXPIRE' });
    expect(actor.getSnapshot().value).toBe('expired');
    actor.stop();
  });

  it('marks expired sessions as done', () => {
    const actor = createActor(dmSessionMachine).start();
    actor.send({ type: 'EXPIRE' });
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });
});

describe('getNextState', () => {
  it('returns debrief when on last scene', () => {
    expect(getNextState(2, 3)).toBe('debrief');
    expect(getNextState(4, 5)).toBe('debrief');
  });

  it('returns scene_submission when more scenes remain', () => {
    expect(getNextState(0, 3)).toBe('scene_submission');
    expect(getNextState(1, 3)).toBe('scene_submission');
  });
});

describe('isSessionExpired', () => {
  it('returns false when deadline is null', () => {
    expect(isSessionExpired(null)).toBe(false);
  });

  it('returns false when deadline is in the future', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    expect(isSessionExpired(future)).toBe(false);
  });

  it('returns true when deadline has passed', () => {
    const past = new Date(Date.now() - 60 * 1000);
    expect(isSessionExpired(past)).toBe(true);
  });
});

describe('stateValueToStatus / statusToStateValue', () => {
  it('maps identity roundtrips correctly', () => {
    const states: DMStateValue[] = [
      'waiting',
      'active',
      'scene_submission',
      'scene_review',
      'debrief',
      'completed',
      'expired',
    ];
    for (const s of states) {
      expect(statusToStateValue(stateValueToStatus(s))).toBe(s);
    }
  });
});
