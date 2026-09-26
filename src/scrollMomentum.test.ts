import { describe, expect, it } from 'vitest';
import { ScrollMomentum } from './scrollMomentum';

function decay(interval: number, width = 200, direction = 1) {
  const momentum = new ScrollMomentum();
  let position = direction, snap: { time: number; target: number; position: number; delta: number } | undefined;
  momentum.push(direction, 0, 0, width);
  const velocity = width * 0.03, tau = 140;
  for (let time = interval; time <= 900; time += interval) {
    const delta = direction * velocity * tau * (Math.exp(-(time - interval) / tau) - Math.exp(-time / tau));
    const result = momentum.push(delta, time, position, width);
    if (result.target !== undefined) {
      expect(snap).toBeUndefined();
      snap = { time, target: result.target, position, delta };
      position = result.target;
    } else if (!result.ignore) position += delta;
    if (snap) expect(result.ignore).toBe(true);
  }
  return { snap: snap!, momentum, position };
}

describe('momentum destination prediction', () => {
  it.each([8, 16, 32])('predicts the landing day at %ims input intervals before the tiny tail', interval => {
    const { snap } = decay(interval);
    expect(snap).toBeDefined();
    expect(snap.target).toBe(800);
    expect(snap.time).toBeGreaterThan(180); // Remaining travel still exceeds a column earlier.
    expect(snap.time).toBeLessThanOrEqual(288);
    expect(snap.delta).toBeGreaterThan(4);
    expect(Math.round(snap.position / 200) * 200).toBeLessThan(snap.target);
  });
  it.each([100, 300])('scales the remaining-distance threshold with a %ipx column', width => {
    const { snap } = decay(16, width);
    expect(snap.target).toBe(width * 4);
    expect(snap.time).toBe(decay(16).snap.time);
  });
  it('predicts leftward movement symmetrically', () => {
    expect(decay(16, 200, -1).snap.target).toBe(-800);
  });
  it('does not snap constant slow input', () => {
    const momentum = new ScrollMomentum();
    for (let i = 0; i < 40; i++) expect(momentum.push(2, i * 16, i * 2, 200)).toEqual({ ignore: false });
  });
  it('resumes after two faster samples, a reversal, or a pause', () => {
    const { momentum, position } = decay(16);
    expect(momentum.push(20, 912, position, 200)).toEqual({ ignore: true });
    expect(momentum.push(20, 928, position, 200)).toEqual({ ignore: false });
    const second = decay(16);
    expect(second.momentum.push(-2, 912, second.position, 200)).toEqual({ ignore: false });
    const third = decay(16);
    expect(third.momentum.push(2, 1100, third.position, 200)).toEqual({ ignore: false });
  });
});
