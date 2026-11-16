import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIST_ID, uuid } from './shopping-fixtures.js';
import { useListEvents } from './use-list-events.js';
import type { EventSourceLike } from './use-list-events.js';

class FakeSource implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 1;
  closed = false;
  constructor(readonly url: string) {}
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.(new Event('open'));
  }
  emit(seq: number, listId: string = LIST_ID) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ listId, seq }) }));
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup() {
  const sources: FakeSource[] = [];
  const refetch = vi.fn();
  const factory = (url: string) => {
    const s = new FakeSource(url);
    sources.push(s);
    return s;
  };
  const view = renderHook(() => useListEvents(LIST_ID, refetch, factory));
  return { sources, refetch, ...view, source: () => sources[sources.length - 1] as FakeSource };
}

describe('useListEvents (FR-34, AC-08)', () => {
  it('AC-08: connects to the list events URL; status follows open and error; refetches on (re)open', () => {
    const { source, refetch, result } = setup();
    expect(source().url).toBe(`/api/v1/shopping-lists/${LIST_ID}/events`);
    expect(result.current.status).toBe('connecting');
    act(() => source().open());
    expect(result.current.status).toBe('connected');
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => source().fail());
    expect(result.current.status).toBe('reconnecting');
    // error also refetches: a 401 on that refetch is how a revoked session is noticed
    expect(refetch).toHaveBeenCalledTimes(2);
    act(() => source().open());
    expect(result.current.status).toBe('connected');
    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it('AC-08: refetches on every new seq and ignores duplicate or out-of-order seq', () => {
    const { source, refetch } = setup();
    act(() => source().emit(5));
    act(() => source().emit(5));
    act(() => source().emit(4));
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => source().emit(6));
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('ignores events for another list and malformed payloads', () => {
    const { source, refetch } = setup();
    act(() => source().emit(9, uuid(1)));
    act(() => source().onmessage?.(new MessageEvent('message', { data: 'not json' })));
    act(() => source().onmessage?.(new MessageEvent('message', { data: '{"seq":"x"}' })));
    expect(refetch).not.toHaveBeenCalled();
  });

  it('FR-34: refetches when the tab becomes visible again', () => {
    const { refetch } = setup();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(refetch).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('opens a fresh stream when the browser gave up (readyState closed)', () => {
    vi.useFakeTimers();
    const { sources, source } = setup();
    source().readyState = 2;
    act(() => source().fail());
    act(() => void vi.advanceTimersByTime(3000));
    expect(sources).toHaveLength(2);
    vi.useRealTimers();
  });

  it('closes the stream on unmount', () => {
    const { source, unmount } = setup();
    const s = source();
    unmount();
    expect(s.closed).toBe(true);
  });
});
