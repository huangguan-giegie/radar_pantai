import type { Map } from 'leaflet';

const USER_MOVEMENT_HANDLERS = [
  'scrollWheelZoom', 'dragging', 'touchZoom', 'doubleClickZoom', 'boxZoom', 'keyboard',
] as const;

type InteractiveMap = Pick<Map, typeof USER_MOVEMENT_HANDLERS[number] | 'on' | 'off' | 'stop'>;

/** Let a selected beach's page scroll without moving its map anchor. */
export function pauseMapInteractions(map: InteractiveMap) {
  const enabled = USER_MOVEMENT_HANDLERS.map(name => map[name]).filter(handler => handler.enabled());
  let finished = false;
  const unloaded = () => { finished = true; };
  map.on('unload', unloaded);
  map.stop();
  enabled.forEach(handler => handler.disable());
  return () => {
    map.off('unload', unloaded);
    // The map hook can remove the map before this effect's unmount cleanup.
    if (finished) return;
    finished = true;
    enabled.forEach(handler => handler.enable());
  };
}
