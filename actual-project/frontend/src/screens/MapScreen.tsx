import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import L from "leaflet";
import { useLeafletMap } from "../components/useLeafletMap";
import { getCoastalBeaches, REGIONS, type CoastalBeach } from "../coastalData";
import { useApp } from "../AppContext";
import { apiRequest, USE_MOCK } from "../api";
import { useAsyncData } from "../useAsyncData";
import {
  DataUnavailable,
  LinkRow,
  Sheet,
} from "../components/CoastalUI";
import { GhostButton, PrimaryButton } from "../components/ui";
import { ChevronLeft as ArrowLeft, Search, SpeciesIcon } from "../components/Icon";
import { SeverityBadge } from "../components/ds";
import { severityLabel, SEVERITY } from "../theme";
import type { SeverityBand } from "../types";
import { BORNEO_VIEW_BOUNDS, getViewBounds, groupMapPoints, PENINSULA_VIEW_BOUNDS } from "../mapGeometry";
import { getLocatedMapBeaches, PRIMARY_MAP_BEACHES } from "../mapCatalogue";
import { placeMapLabels, type MapLabelOffset } from "../mapLabels";
import type { BeachWildlifeSpecies } from "../beachMarineLife";
import { MapMarineSelection } from "../components/MapMarineSelection";
import { SpeciesPicture } from "../components/SpeciesPicture";
import { marineLayerEnabled, marineLayerParams, selectMapBeach, regionMarineReferenceCount, radialSpecies, mapMarineCards, marineSelectionLayout, MIN_MARINE_SELECTION_HEIGHT } from "../mapMarineSelection";
import { searchBeaches, borneoReportCounts } from "../beachSearch";
import { pauseMapInteractions } from "../mapInteractionPause";
const COLORS: Record<string, string> = {
  Low: "#92ce55",
  Moderate: "#e7bb51",
  High: "#f08a38",
  Severe: "#c20e19",
};
function BorneoInset({ onClick, counts }: { onClick: () => void; counts: ReturnType<typeof borneoReportCounts> }) {
  const { elRef, mapRef, ready } = useLeafletMap({
    center: [4, 114.5],
    zoom: 4,
    interactive: false,
    zoomSnap: 0.25,
  });
  useEffect(() => {
    if (ready) mapRef.current?.fitBounds(BORNEO_VIEW_BOUNDS, { padding: [8, 8], animate: false });
  }, [ready]);
  return (
    <div className="borneo-inset">
      <div ref={elRef} />
      <button className="borneo-inset-open" aria-label="Sabah & Sarawak" onClick={onClick}><strong>Sabah & Sarawak ↗</strong></button>
      <div className="borneo-report-counts" aria-label={`Sabah ${counts.sabah} reports, Sarawak ${counts.sarawak} reports`}>
        <span><b>{counts.sarawak}</b>Sarawak</span><span><b>{counts.sabah}</b>Sabah</span>
      </div>
    </div>
  );
}
export default function MapScreen() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const regionId = params.get("region") ?? "";
  const layer = marineLayerEnabled(params) ? "bio" : "litter";
  const selectedId = layer === 'bio' ? params.get('beach') : null;
  const region = REGIONS.find((r) => r.id === regionId);
  const { reportsVersion, offline } = useApp();
  const [zoom, setZoom] = useState(6);
  const [minZoom, setMinZoom] = useState(5);
  const [viewSize, setViewSize] = useState("");
  const [viewRevision, setViewRevision] = useState(0);
  const [clusterIds, setClusterIds] = useState<string[] | null>(null);
  const [showMoreSpecies, setShowMoreSpecies] = useState(false);
  const userMoved = useRef(false);
  const fittedRegion = useRef<string | null>(null);
  const labelLayout = useRef({ key: '', offsets: new Map<string, MapLabelOffset>() });
  type Panel = "key" | "beaches" | "regions";
  const panel = params.get("panel");
  const sheet = ["key", "beaches", "regions"].includes(panel ?? "")
    ? panel as Panel : null;
  const search = params.get("q") ?? "";
  const setSheet = (value: Panel | null, ids: string[] | null = null) => {
    setClusterIds(ids);
    setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set("panel", value);
    else next.delete("panel");
    next.delete("record");
    if (ids) next.delete("q");
    return next;
    }, { replace: true });
  };
  const setSearch = (value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set("q", value);
    else next.delete("q");
    return next;
  }, { replace: true });
  const {
    data: beaches,
    loading,
    error,
    refresh,
  } = useAsyncData(getCoastalBeaches, [reportsVersion], []);
  useEffect(() => {
    if (panel === 'personal') nav('/insights?panel=personal', { replace: true });
  }, [panel, nav]);
  const { elRef, mapRef, ready } = useLeafletMap({
    center: region ? [region.lat, region.lng] : [4.05, 102],
    zoom: region?.zoom ?? 6,
    zoomSnap: 0.25,
    // Keep marker regrouping synchronous; a zoom transition must not outlive route teardown.
    zoomAnimation: false,
  });
  const areaBeaches = useMemo(() => region
    ? beaches.filter((b) => b.region === region.id)
    : beaches, [beaches, regionId]);
  const locatedBeaches = useMemo(() => getLocatedMapBeaches(areaBeaches, USE_MOCK), [areaBeaches]);
  const selectedBeach = locatedBeaches.find(beach => beach.id === selectedId);
  const selectedBeachId = selectedBeach?.id;
  const { data: wildlife, loading: wildlifeLoading, error: wildlifeError, refresh: refreshWildlife } = useAsyncData<{
    beachId: string; species: BeachWildlifeSpecies[];
  } | null>(() => !selectedBeachId || USE_MOCK ? Promise.resolve(null)
    : apiRequest(`/beaches/${encodeURIComponent(selectedBeachId)}/wildlife`, 'GET', undefined, 45_000, false),
    [selectedBeachId], null);
  const marineCards = useMemo(() => selectedBeachId ? mapMarineCards(selectedBeachId,
    wildlife?.beachId === selectedBeachId ? wildlife.species : []) : [], [selectedBeachId, wildlife]);
  const closeSelection = useCallback(() => setParams(previous => {
    const next = new URLSearchParams(previous); next.delete('beach'); return next;
  }, { replace: true }), [setParams]);
  const chooseBeach = useCallback((beach: CoastalBeach) => {
    if (layer !== 'bio' || !getLocatedMapBeaches([beach], USE_MOCK).length) {
      nav('/beach/' + beach.id); return;
    }
    setClusterIds(null);
    setParams(previous => selectMapBeach(previous, beach), { replace: true });
  }, [layer, nav, setParams]);
  const visible = search.trim() ? searchBeaches(beaches, search) : areaBeaches.filter(b => !clusterIds || clusterIds.includes(b.id));
  const setRegion = useCallback((id: string) => {
    setClusterIds(null);
    setParams({ ...(id ? { region: id } : {}), ...(layer === 'bio' ? { marine: 'on' } : {}) });
  }, [layer, setParams]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (fittedRegion.current !== regionId) {
      userMoved.current = false;
      fittedRegion.current = regionId;
    }
    const fit = () => {
      map.stop();
      map.invalidateSize({ pan: false });
      const size = map.getSize();
      setViewSize(`${size.x}x${size.y}`);
      // Reserve room for the hint and for labels anchored above beach locations.
      const padding = L.point(96, 96);
      const bounds = getViewBounds(regionId, regionId ? locatedBeaches : []);
      // getBoundsZoom respects existing limits; a smaller viewport may need a lower floor.
      map.setMinZoom(0);
      const floor = Math.min(
        map.getBoundsZoom(PENINSULA_VIEW_BOUNDS, false, padding),
        map.getBoundsZoom(bounds, false, padding),
      );
      map.setMinZoom(floor);
      map.setMaxZoom(18);
      setMinZoom(floor);
      if (!userMoved.current) map.fitBounds(bounds, {
        paddingTopLeft: [48, 60], paddingBottomRight: [48, 36], animate: false,
      });
      setZoom(map.getZoom());
    };
    const trackZoom = () => {
      setZoom(map.getZoom());
    };
    const trackMove = () => setViewRevision(value => value + 1);
    const trackDrag = () => { userMoved.current = true; };
    const container = map.getContainer();
    container.addEventListener("wheel", trackDrag, { passive: true });
    container.addEventListener("touchmove", trackDrag, { passive: true });
    container.addEventListener("keydown", trackDrag);
    container.addEventListener("dblclick", trackDrag);
    map.on("zoomend", trackZoom);
    map.on("moveend", trackMove);
    map.on("dragstart", trackDrag);
    fit();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(map.getContainer());
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      map.off("zoomend", trackZoom);
      map.off("moveend", trackMove);
      map.off("dragstart", trackDrag);
      container.removeEventListener("wheel", trackDrag);
      container.removeEventListener("touchmove", trackDrag);
      container.removeEventListener("keydown", trackDrag);
      container.removeEventListener("dblclick", trackDrag);
    };
  }, [ready, regionId, locatedBeaches]);
  useEffect(() => { setShowMoreSpecies(false); }, [selectedBeachId]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedBeachId) return;
    return pauseMapInteractions(map);
  }, [ready, selectedBeachId]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedBeach) return;
    userMoved.current = true;
    const point = map.latLngToContainerPoint([selectedBeach.lat, selectedBeach.lng]);
    const size = map.getSize();
    const layout = marineSelectionLayout(size, marineCards.length);
    // Fit captions and controls while keeping the circle on the beach coordinate.
    map.panBy([point.x - layout.x, point.y - layout.y], { animate: false });
    // Leaflet mutates the map ref outside React: refresh the radial overlay position after panning.
    setViewRevision(value => value + 1);
  }, [ready, selectedBeachId, viewSize, marineCards.length]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedBeachId) return;
    const followMap = () => setViewRevision(value => value + 1);
    map.on('click', closeSelection);
    map.on('move', followMap);
    return () => { map.off('click', closeSelection); map.off('move', followMap); };
  }, [ready, selectedBeachId, closeSelection]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const group = L.layerGroup().addTo(map);
    const marker = (
      lat: number,
      lng: number,
      label: string,
      html: string,
      onClick: () => void,
      size: [number, number],
      anchor: [number, number] = [size[0] / 2, size[1] / 2],
      priority = 0,
    ) => {
      const pin = L.marker([lat, lng], {
        icon: L.divIcon({
          className: "coastal-map-marker",
          html,
          iconSize: size,
          iconAnchor: anchor,
        }),
        title: label,
        alt: label,
        keyboard: true,
        bubblingMouseEvents: false,
        zIndexOffset: priority,
      })
        .addTo(group)
        .on("click", onClick);
      pin.getElement()?.setAttribute("aria-label", label);
      return pin;
    };
    const size = map.getSize();
    const containerRect = map.getContainer().getBoundingClientRect();
    const controls = Array.from(map.getContainer().parentElement?.querySelectorAll(".map-context-bar > *, .map-controls, .map-full-overview, .borneo-inset") ?? []).map(el => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left - containerRect.left, y: rect.top - containerRect.top, width: rect.width, height: rect.height };
    });
    if (!region) {
      for (const r of REGIONS) {
        if (r.id === "borneo") continue; // Borneo has its own inset in the overview.
        const rows = beaches.filter((b) => b.region === r.id);
        if (!rows.length && layer === "litter") continue;
        const count = rows.reduce((n, b) => n + b.validReports, 0);
        const levels = ["Low", "Moderate", "High", "Severe"];
        const highest = rows.reduce(
          (n, b) => Math.max(n, levels.indexOf(b.severity ?? "")),
          -1,
        );
        const colour = COLORS[levels[highest]] ?? "#70757c";
        const label = count;
        const diameter = map.getSize().y < 360 ? 30 : 42;
        const referenceCount = regionMarineReferenceCount(r.id);
        const showReferences = layer === 'bio' && referenceCount > 0;
        marker(
          r.lat,
          r.lng,
          r.name + (showReferences ? ` · ${referenceCount} coastal reference${referenceCount === 1 ? '' : 's'}` : ''),
          `<div class="region-map-pin" style="width:${diameter}px;height:${diameter}px;font-size:${diameter === 30 ? 11 : 15}px;line-height:${diameter - 8}px;border-color:` +
            colour +
            '"><b>' +
            label +
            '</b></div>' + (showReferences ? `<span class="region-marine-count">${referenceCount} ref${referenceCount === 1 ? '' : 's'}</span>` : ''),
          () => setRegion(r.id),
          [diameter, diameter + (showReferences ? 18 : 0)],
          [diameter / 2, diameter / 2],
        );
      }
    } else if (region) {
      const preferred = new Set(PRIMARY_MAP_BEACHES[region.id] ?? []);
      const compactLabels = size.y < 360;
      // Only the selected beach expands; the other beaches keep ordinary dots.
      const obstacles = controls;
      const previews = new Map(locatedBeaches.map(beach => [beach.id,
        layer === 'bio' ? mapMarineCards(beach.id).find(item => item.image) : undefined]));
      const labelPoints = locatedBeaches
        .filter(b => preferred.has(b.id) || zoom >= region.zoom + 1)
        .map(b => ({ id: b.id, name: b.name, preferred: preferred.has(b.id),
          labelHeight: previews.get(b.id) ? 90 : 48, fallbackHeight: previews.get(b.id) ? 48 : undefined,
          ...map.latLngToContainerPoint([b.lat, b.lng]) }));
      // Panning changes the viewport, not a beach label's side or distance from
      // its dot. Only a changed scale/layout starts a fresh set of assignments.
      const layoutKey = `${region.id}:${layer}:${map.getZoom()}:${size.x}:${size.y}`;
      if (labelLayout.current.key !== layoutKey) labelLayout.current = { key: layoutKey, offsets: new Map() };
      const labels = selectedBeachId ? [] : placeMapLabels(labelPoints,
        { width: size.x, height: size.y, obstacles, compact: compactLabels,
          previousOffsets: labelLayout.current.offsets });
      for (const label of labels) {
        const point = labelPoints.find(item => item.id === label.id)!;
        labelLayout.current.offsets.set(label.id, { x: label.x - point.x, y: label.y - point.y,
          width: label.width, height: label.height });
      }
      const labelled = new Set(labels.map(label => label.id));
      const displayDot = (b: typeof locatedBeaches[number]) => marker(b.lat, b.lng, b.name,
        `<span class="beach-coast-dot" style="background:${COLORS[b.severity ?? ""] ?? "#70757c"}"></span>`,
        () => chooseBeach(b), [24, 24]);

      // Every main beach keeps its clickable coastal dot, even when nearby
      // names cannot fit. Beach List and zoom remain available for dense areas.
      for (const b of locatedBeaches.filter(b => b.id !== selectedBeachId && (preferred.has(b.id) || labelled.has(b.id)))) displayDot(b);
      const clusters = groupMapPoints(locatedBeaches.filter(b => b.id !== selectedBeachId && !preferred.has(b.id) && !labelled.has(b.id)),
        (lat, lng) => map.project([lat, lng], zoom), { width: 22, height: 22 });
      for (const cluster of clusters) {
        if (cluster.points.length > 1) {
          marker(cluster.lat, cluster.lng, `${cluster.points.length} nearby beaches`,
            `<div class="beach-cluster-pin">+${cluster.points.length}</div>`,
            () => {
              userMoved.current = true;
              const samePlace = cluster.points.every(p => p.lat === cluster.lat && p.lng === cluster.lng);
              if (map.getZoom() >= map.getMaxZoom() || samePlace) {
                setSheet("beaches", cluster.points.map(p => p.id));
              } else {
                const bounds = L.latLngBounds(cluster.points.map(p => [p.lat, p.lng]));
                const size = map.getSize();
                const padding = L.point(Math.min(180, size.x / 2), Math.min(160, size.y / 2));
                const fitZoom = map.getBoundsZoom(bounds, false, padding);
                const nextZoom = Math.max(map.getZoom() + 1, Number.isFinite(fitZoom) ? fitZoom : map.getZoom() + 1);
                map.setView(bounds.getCenter(), Math.min(nextZoom, map.getMaxZoom()));
              }
            }, [28, 28]);
          continue;
        }
        displayDot(cluster.points[0]);
      }
      for (const placed of labels) {
        const b = locatedBeaches.find(beach => beach.id === placed.id)!;
        const point = map.latLngToContainerPoint([b.lat, b.lng]);
        const end = L.point(Math.max(placed.x, Math.min(point.x, placed.x + placed.width)),
          Math.max(placed.y, Math.min(point.y, placed.y + placed.height)));
        L.polyline([[b.lat, b.lng], map.containerPointToLatLng(end)], {
          color: "#51657c", weight: 1, opacity: 0.7, interactive: false,
        }).addTo(group);
        const node = document.createElement("div");
        node.className = "beach-map-label" + (compactLabels ? " compact" : "");
        const label = document.createElement("span");
        label.className = 'beach-map-name';
        label.textContent = b.name;
        label.style.color = '#fff';
        label.style.background = COLORS[b.severity ?? ""] ?? "#70757c";
        node.append(label);
        // Surface a place-specific reference before a beach is selected.
        // Clicking its marker still opens the full marine-life circle.
        const photo = previews.get(b.id);
        if (photo?.image && placed.height === 90) {
          node.classList.add('has-species-preview');
          const preview = document.createElement('span');
          preview.className = 'map-label-species';
          const image = document.createElement('img');
          image.src = photo.image;
          image.alt = photo.name;
          preview.append(image);
          const caption = document.createElement('small');
          caption.textContent = photo.name;
          preview.append(caption);
          const expand = document.createElement('b');
          expand.className = 'map-species-expand';
          expand.setAttribute('aria-hidden', 'true');
          expand.textContent = '›';
          preview.append(expand);
          node.append(preview);
        }
        marker(
          b.lat,
          b.lng,
          b.name + ' · ' + (b.severity ? severityLabel(b.severity) : 'Insufficient data') + (layer === 'bio' ? ' · Show nearby marine life' : ' · Open beach details'),
          node.outerHTML,
          () => chooseBeach(b),
          [placed.width, placed.height],
          [point.x - placed.x, point.y - placed.y],
          1000,
        );
      }
    }
    return () => {
      group.remove();
    };
  }, [ready, regionId, layer, beaches, zoom, viewSize, viewRevision, nav, setRegion, selectedBeachId, chooseBeach]);
  const map = mapRef.current;
  const selectionPosition = map && ready && selectedBeach ? {
    ...map.latLngToContainerPoint([selectedBeach.lat, selectedBeach.lng]),
    diameter: marineSelectionLayout(map.getSize(), marineCards.length).diameter,
  } : null;
  return (
    <main className={'screen coastal-map' + (selectedBeach ? ' has-selection' : '')}>
      <header className="map-coastal-header design-map-header">
        <div>
          {region && <button className="icon-button" aria-label="Full map" onClick={() => setRegion('')}><ArrowLeft size={18} /></button>}
          <h1>Choose a Beach</h1>
        </div>
        <form className="map-search-form" role="search" onSubmit={event => { event.preventDefault(); setSheet('beaches'); }}>
          <label className="coastal-search"><Search /><input type="search" aria-label="Search all beaches" placeholder="Search beaches in all regions" value={search} onChange={event => setSearch(event.target.value)} /></label>
        </form>
        <div className="map-overlay-toggle"><button aria-pressed={layer === 'bio'} onClick={() => setParams(previous => marineLayerParams(previous, layer !== 'bio'), { replace: true })}><SpeciesIcon glyph="turtle" size={18} />Marine Life <span className="map-layer-state">{layer === 'bio' ? 'On' : 'Off'}</span><span className="map-layer-switch" aria-hidden="true"><i /></span></button></div>
      </header>
      {search.trim() && sheet !== 'beaches' && <section className="map-search-results" aria-label="Beach search results">
        {loading ? <p role="status">Loading beaches…</p> : error ? <DataUnavailable title="Could not load beaches" retry={() => void refresh()}>{error}</DataUnavailable> : <>
          <p className="eyebrow">{visible.length} {visible.length === 1 ? 'match' : 'matches'} · all regions</p>
          {visible.slice(0, 30).map(beach => <button key={beach.id} onClick={() => chooseBeach(beach)}>
            <span><strong style={{ color: beach.severity ? SEVERITY[beach.severity].text : '#586070' }}>{beach.name}</strong><small>{beach.area}</small></span><SeverityBadge band={beach.severity} />
          </button>)}
          {!visible.length && <p>No matching beaches</p>}
          {visible.length > 30 && <GhostButton height={42} onClick={() => setSheet('beaches')}>View All {visible.length} Results</GhostButton>}
        </>}
      </section>}

      <div className={'coastal-map-viewport' + (selectedBeach ? ' has-marine-selection' : '')}
        style={selectedBeach ? { minHeight: MIN_MARINE_SELECTION_HEIGHT, flexShrink: 0 } : undefined}>
      <div ref={elRef} className="coastal-map-canvas" aria-label="Interactive coast map" />
      {selectedBeach && selectionPosition && <MapMarineSelection
        beachName={selectedBeach.name}
        rating={selectedBeach.severity ? severityLabel(selectedBeach.severity) : 'Insufficient data'}
        color={COLORS[selectedBeach.severity ?? ''] ?? '#70757c'}
        lightText
        cards={marineCards} position={selectionPosition}
        loading={!USE_MOCK && wildlifeLoading} error={!USE_MOCK && Boolean(wildlifeError)}
        onClose={closeSelection} onBeach={() => nav('/beach/' + selectedBeach.id, { state: { fromMarineMap: true } })}
        onSpecies={card => nav(card.destination)} onMore={() => setShowMoreSpecies(true)}
        onRetry={() => void refreshWildlife()}
      />}
      <div className={'map-context-bar' + (region ? ' is-region' : '')}>
        <div className="map-hint">{loading ? 'Loading the coast…' : region ? <><strong>{region.name}</strong><span>Tap a Beach</span></> : 'Report counts · tap a region'}</div>
        {region ? <div className="map-attention-legend" aria-label="Beach attention levels">
          {Object.entries(COLORS).map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}
          <span className="unrated-legend"><i style={{ background: '#70757c' }} />Insufficient Data</span>
        </div> : <button className="map-pill map-key-button" onClick={() => setSheet('key')}>Map Key</button>}
      </div>
      <div className="map-controls">
        <button className="map-pill" onClick={() => setSheet("regions")}>
          Regions
        </button>
        <button
          className="icon-button"
          aria-label="Zoom in"
          disabled={zoom >= 18}
          onClick={() => { userMoved.current = true; mapRef.current?.zoomIn(); }}
        >
          +
        </button>
        <button
          className="icon-button"
          aria-label="Zoom out"
          disabled={zoom <= minZoom}
          onClick={() => { userMoved.current = true; mapRef.current?.zoomOut(); }}
        >
          −
        </button>
      </div>
      {!region && <BorneoInset onClick={() => setRegion("borneo")} counts={borneoReportCounts(beaches)} />}
      {region && <button className="map-pill map-full-overview" onClick={() => setRegion("")}>Full Map</button>}
      </div>
      <div className="map-bottom-card">
        {(error || offline) && (
          <p className="coastal-footnote" role="alert">
            {error
              ? "Could not load beach data."
              : "You are viewing cached data."}{" "}
            <button onClick={() => void refresh()}>Retry</button>
          </p>
        )}
        <div>
          <span>
            <strong>{selectedBeach ? 'Nearby marine life' : region ? (loading ? region.name : `${areaBeaches.length} beaches`) : 'Malaysia’s Coast'}</strong>
            <small>{selectedBeach ? selectedBeach.name : loading ? 'Loading beaches…' : region ? `${areaBeaches.reduce((n, beach) => n + beach.validReports, 0)} counted reports` : `${beaches.length} beaches · tap a region`}</small>
          </span>
          {region && <PrimaryButton height={44} style={{ width: 'auto', paddingInline: 14, boxShadow: 'none' }} onClick={() => setSheet('beaches')}>Beach List</PrimaryButton>}
        </div>
        {region && locatedBeaches.length < areaBeaches.length && <p className="coastal-footnote">More beaches are available in the list.</p>}
        {layer === 'bio' && <p className="coastal-footnote map-photo-hint">{selectedBeach ? (marineCards.length ? 'Centre → beach details · outer circles → species guides' : 'Tap the centre for beach details.') : region ? 'Tap a beach to open its marine-life circle.' : 'Choose a region, then tap a beach.'}</p>}
        {USE_MOCK && <p className="demo-label">Preview · example counts</p>}
      </div>
      {sheet === "key" && (
        <Sheet title="Map Key" onClose={() => setSheet(null)}>
          <p className="subtle">
            Numbers show counted reports in this view. The ring shows the
            highest available attention level in that region. Each beach name is a coloured button showing its own level.
          </p>
          <p className="subtle">Marine Life starts on. Tap a beach to expand its nearby species. Tap the centre for beach details or an outer icon for a species or habitat guide. Close the circle or tap empty map space to collapse it.</p>
          {Object.entries(COLORS).map(([label, color]) => (
            <div className="legend-row" key={label}>
              <i style={{ background: color }} />
              {severityLabel(label as SeverityBand)}
            </div>
          ))}
          <div className="legend-row">
            <i style={{ background: "#70757c" }} />
            Insufficient data
          </div>
          <p className="subtle">
            An unrated beach is not necessarily clean. Regional “refs” count distinct coastal references. Published references and OBIS modelled context are not confirmed sightings.
          </p>
          <PrimaryButton
            style={{ marginTop: 18 }}
            onClick={() => setSheet(null)}
          >
            Understood
          </PrimaryButton>
        </Sheet>
      )}
      {sheet === "regions" && (
        <Sheet title="Choose a Region" onClose={() => setSheet(null)}>
          {REGIONS.map((r) => (
            <LinkRow
              key={r.id}
              title={r.name}
              subtitle={
                beaches.filter((b) => b.region === r.id).length + " beaches"
              }
              onClick={() => setRegion(r.id)}
            />
          ))}
        </Sheet>
      )}
      {sheet === "beaches" && (
        <Sheet title={search.trim() ? "Search All Beaches" : region?.name ?? "All Beaches"} onClose={() => setSheet(null)}>
          <label className="coastal-search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search beaches in all regions"
              aria-label="Search beaches"
            />
          </label>
          {loading ? (
            <p className="subtle" role="status">Loading beaches…</p>
          ) : error ? (
            <DataUnavailable title="Could not load beaches" retry={() => void refresh()}>{error}</DataUnavailable>
          ) : (
            <>
              {visible.map((beach) => (
                <section key={beach.id} className="map-beach-list-row">
                  <div>
                    <button style={{ color: beach.severity ? SEVERITY[beach.severity].text : "#586070" }} onClick={() => chooseBeach(beach)}>{beach.name}</button>
                    <SeverityBadge band={beach.severity} label={beach.severity ? undefined : "Insufficient Data"} />
                  </div>
                  <p className="coastal-footnote">{beach.area} · {beach.validReports} counted reports</p>
                </section>
              ))}
              {!visible.length && <DataUnavailable title="No matching beaches" />}
            </>
          )}
        </Sheet>
      )}
      {selectedBeach && showMoreSpecies && <Sheet title={`More marine life · ${selectedBeach.name}`} onClose={() => setShowMoreSpecies(false)}>
        <p className="subtle">Published references and modelled context, not confirmed sightings.</p>
        {radialSpecies(marineCards).remaining.map(card => <LinkRow key={card.id} title={card.name}
          subtitle={card.kind === 'habitat' ? 'Published habitat reference' : card.modelled ? (card.published ? 'Published reference + OBIS modelled context' : 'OBIS modelled context') : 'Published coastal reference'}
          leading={<span className="marine-more-photo">{card.kind === 'habitat' ? <SpeciesIcon glyph="grass" size={30} /> : <SpeciesPicture image={card.image} name={card.name} />}</span>}
          onClick={() => nav(card.destination)} />)}
      </Sheet>}
    </main>
  );
}
