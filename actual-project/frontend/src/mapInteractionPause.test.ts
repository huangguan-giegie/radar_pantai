import { describe, expect, it, vi } from 'vitest';
import { pauseMapInteractions } from './mapInteractionPause';

const handler = (initial: boolean) => {
  let enabled = initial;
  return {
    enabled: () => enabled,
    enable: vi.fn(() => { enabled = true; }),
    disable: vi.fn(() => { enabled = false; }),
  };
};

function createMap() {
  const listeners = new Set<() => void>();
  const handlers = {
    scrollWheelZoom: handler(true), dragging: handler(true), touchZoom: handler(true),
    doubleClickZoom: handler(true), boxZoom: handler(false), keyboard: handler(true),
  };
  const map = {
    ...handlers,
    on: vi.fn((_event: string, listener: () => void) => { listeners.add(listener); }),
    off: vi.fn((_event: string, listener: () => void) => { listeners.delete(listener); }),
    stop: vi.fn(),
    panBy: vi.fn(),
  };
  return {
    handlers, map,
    unload: () => { listeners.forEach(listener => listener()); },
    listenerCount: () => listeners.size,
    pause: () => pauseMapInteractions(map as unknown as Parameters<typeof pauseMapInteractions>[0]),
  };
}

describe('selected beach map interactions', () => {
  it('pauses user movement while leaving programmatic anchoring available and restores the original states', () => {
    const fixture = createMap();
    const restore = fixture.pause();
    expect(Object.values(fixture.handlers).every(item => !item.enabled())).toBe(true);
    fixture.map.panBy([0, 30]);
    expect(fixture.map.panBy).toHaveBeenCalledWith([0, 30]);
    restore();
    for (const [name, item] of Object.entries(fixture.handlers)) expect(item.enabled()).toBe(name !== 'boxZoom');
    expect(fixture.handlers.boxZoom.enable).not.toHaveBeenCalled();
    expect(fixture.listenerCount()).toBe(0);
    restore();
    expect(fixture.handlers.scrollWheelZoom.enable).toHaveBeenCalledOnce();
  });

  it('restores between beach selections so repeated opening and closing does not lose enabled states', () => {
    const fixture = createMap();
    const closeFirst = fixture.pause();
    closeFirst();
    const closeSecond = fixture.pause();
    expect(fixture.handlers.scrollWheelZoom.enabled()).toBe(false);
    closeSecond();
    expect(fixture.handlers.scrollWheelZoom.enabled()).toBe(true);
    expect(fixture.handlers.boxZoom.enabled()).toBe(false);
    expect(fixture.listenerCount()).toBe(0);
  });

  it('does not reactivate handlers after the map has been removed during route teardown', () => {
    const fixture = createMap();
    const restore = fixture.pause();
    fixture.unload();
    restore();
    expect(Object.values(fixture.handlers).every(item => !item.enabled())).toBe(true);
    expect(Object.values(fixture.handlers).every(item => item.enable.mock.calls.length === 0)).toBe(true);
    expect(fixture.listenerCount()).toBe(0);
  });
});
