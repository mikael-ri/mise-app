import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ShoppingListId } from '@mise/contracts';
import { createListEventHub } from './events.js';

const listId = ShoppingListId.parse(randomUUID());
const ev = (seq: number) => ({ listId, seq });

describe('list event hub (FR-37, ADR-004)', () => {
  it.each([
    ['same household and list', 'h1', listId, 1],
    ['another household, same list id', 'h2', listId, 0],
    ['same household, another list', 'h1', randomUUID(), 0],
  ])('delivers only to the matching household and list: %s', (_name, household, list, calls) => {
    const hub = createListEventHub();
    const fn = vi.fn();
    hub.subscribe(household, list, fn);
    hub.publish('h1', ev(3));
    expect(fn).toHaveBeenCalledTimes(calls);
  });

  it('stops delivering after unsubscribe and survives a throwing listener', () => {
    const hub = createListEventHub();
    const gone = vi.fn();
    const after = vi.fn();
    hub.subscribe('h1', listId, () => {
      throw new Error('broken stream');
    });
    const stop = hub.subscribe('h1', listId, gone);
    hub.subscribe('h1', listId, after);
    stop();
    hub.publish('h1', ev(1));
    expect(gone).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith(ev(1));
  });
});
