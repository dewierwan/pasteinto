// When does a push to main release the extension? scripts/publish-extension.mjs
// compares manifest.json's version with what the Chrome Web Store has.
import { describe, it, expect } from 'vitest';
import { compareVersions, decide } from '../scripts/publish-extension.mjs';

describe('extension versions', () => {
  it.each([
    ['1.2.1', '1.2.0', 1],
    ['1.2.0', '1.2.1', -1],
    ['1.2.1', '1.2.1', 0],
    ['1.0.11', '1.0.4', 1], // parts are numbers, not decimals
    ['1.1.10', '1.1.9', 1],
    ['1.2', '1.2.0', 0],
    ['2.0.0', '1.99.99', 1],
  ])('%s against %s', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});

describe('whether to release', () => {
  it('releases a version the store has not seen', () => {
    expect(decide('1.2.1', '1.1.1', undefined).release).toBe(true);
  });
  it('releases the first version sent through the API', () => {
    expect(decide('1.0.0', undefined, undefined).release).toBe(true);
  });
  it('does nothing when the version is live', () => {
    expect(decide('1.2.1', '1.2.1', undefined)).toMatchObject({ release: false, why: '1.2.1 is already live' });
  });
  it('does nothing when the version is in review', () => {
    expect(decide('1.2.1', '1.1.1', '1.2.1')).toMatchObject({ release: false, why: '1.2.1 is already in review' });
  });
  it('releases over an older version that is still in review', () => {
    expect(decide('1.2.2', '1.1.1', '1.2.1').release).toBe(true);
  });
  it('does nothing, and says why, when the store is ahead (after a dashboard rollback)', () => {
    const decision = decide('1.0.4', '1.0.11', undefined);
    expect(decision).toMatchObject({ release: false, behind: true });
    expect(decision.why).toContain('1.0.11');
  });
});
