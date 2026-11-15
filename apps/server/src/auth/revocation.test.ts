import { describe, expect, it, vi } from 'vitest';
import { createRevocationHub } from './revocation.js';

describe('revocation hub (AC-11, SSE hook for A14)', () => {
  it('notifies only the listeners of the revoked session, once', () => {
    const hub = createRevocationHub();
    const a = vi.fn();
    const b = vi.fn();
    hub.subscribe('s1', a);
    hub.subscribe('s2', b);
    hub.publish('s1');
    hub.publish('s1');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('does not call an unsubscribed listener and survives a throwing one', () => {
    const hub = createRevocationHub();
    const gone = vi.fn();
    const after = vi.fn();
    hub.subscribe('s', () => {
      throw new Error('stream already closed');
    });
    const off = hub.subscribe('s', gone);
    hub.subscribe('s', after);
    off();
    hub.publish('s');
    expect(gone).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
  });
});
