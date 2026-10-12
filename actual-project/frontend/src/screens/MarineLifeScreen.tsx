import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import content from "../content/coastalContent.json";
import photoOverrides from "../content/speciesPhotoOverrides.json";
import {
  CoastalPage,
  DataUnavailable,
  LinkRow,
  SectionHeading,
  Sheet,
  SummaryCard,
  WhiteCard,
} from "../components/CoastalUI";
import { BackButton, GhostButton, PrimaryButton } from "../components/ui";
import { Search } from "../components/Icon";
import { C } from "../theme";
import { useAppBack } from "../navigation";

import { SpeciesPicture } from "../components/SpeciesPicture";
import { MarineRecordCard } from "../components/MarineRecordCard";
import { SpeciesQuestions } from "../components/SpeciesQuestions";
import { groupMarineRecords, originBeachId, withBeach } from "../biodiversity";
import { PlaceThumb } from "../components/Visuals";
import { habitatPhoto as habitatCover, regionPhoto } from "../visuals";

function speciesImageMedia(id: string) {
  return Object.entries(photoOverrides).find(([key]) => key === id)?.[1];
}
export default function MarineLifeScreen() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const filter = params.get("filter") ?? "all";
  const updateFilter = (key: string, value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    return next;
  }, { replace: true });
  const list = content.species.filter(
    (s) =>
      (filter === "all" || s.category === filter) &&
      (s.name + " " + s.subtitle).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <CoastalPage
      title="Marine Life"
      subtitle="38 species & groups · Tap to explore"
      back="/home"
    >
      <div className="filter-chips" style={{ margin: 0 }}>
        {[
          ["all", "All"],
          ["animal", "Animals · 26"],
          ["plant", "Plants · 12"],
        ].map(([id, name]) => (
          <button
            key={id}
            aria-pressed={filter === id}
            onClick={() => updateFilter("filter", id)}
          >
            {name}
          </button>
        ))}
      </div>
      <button className="marine-map-link" onClick={() => nav("/map?marine=on")}>Explore on Map →</button>
      <label className="coastal-search">
        <Search />
        <input
          aria-label="Search marine life"
          placeholder="Search species and habitats"
          value={search}
          onChange={(e) => updateFilter("q", e.target.value)}
        />
      </label>
      {(["animal", "plant"] as const).map((category) => {
        const rows = list.filter((s) => s.category === category);
        return rows.length ? (
          <section key={category}>
            <SectionHeading>
              {category === "animal"
                ? "Coastal Animals"
                : "Mangroves & Seagrass"}
            </SectionHeading>
            <div className="coastal-grid-two" style={{ marginTop: 16 }}>
              {rows.map((s) => (
                <button key={s.id} onClick={() => nav("/species/" + s.id)}>
                  <SpeciesPicture image={s.image} name={s.name} />
                  <strong>{s.name}</strong>
                  {s.id === "grubeulepis-malayensis" && <small>Scientific schematic</small>}
                  <small>Learn more →</small>
                </button>
              ))}
            </div>
          </section>
        ) : null;
      })}
      {!list.length && (
        <DataUnavailable title="No matching species">
          Try a different name.
        </DataUnavailable>
      )}
      <p className="coastal-footnote">
        Photos and labelled schematics show species examples, not sightings at your beach. Explore their
        habitats.
      </p>
      <GhostButton onClick={() => nav("/habitats")}>
        Explore Habitats
      </GhostButton>
      <button
        onClick={() => nav("/credits")}
        style={{ textAlign: "center", color: C.navy }}
      >
        Species & Habitat Photo Credits
      </button>
    </CoastalPage>
  );
}

export function SpeciesScreen() {
  const { speciesId } = useParams();
  const nav = useNavigate();
  const goBack = useAppBack("/marine-life");
  const s = content.species.find((s) => s.id === speciesId);
  if (!s)
    return (
      <CoastalPage title="Marine Life" back="/marine-life">
        <DataUnavailable title="Species not found" />
      </CoastalPage>
    );
  const media = speciesImageMedia(s.id);
  return (
    <main className="screen scroll-y coastal-screen">
      <div className="species-hero">
        <SpeciesPicture image={s.image} name={s.name} />
        <div className="back-overlay">
          <BackButton onClick={goBack} />
        </div>
      </div>
      <div className="coastal-page measure species-body">
        <div>
          <h1>{s.name}</h1>
          {s.subtitle && <p className="subtle" style={{ fontStyle: "italic" }}>
            {s.subtitle}
          </p>}
          {media?.imageCaption && <p className="coastal-footnote">{media.imageCaption}</p>}
          <p style={{ fontSize: 17, lineHeight: 1.5 }}>{s.intro}</p>
          <p className="coastal-footnote">{s.evidence}</p>
        </div>
        <SpeciesQuestions key={s.id} species={s} />
        <section>
          <h3>{s.id === "grubeulepis-malayensis" ? "Sources & Illustration Credit" : "Sources & Photo Credit"}</h3>
          {s.sources.map((source, i) => (
            <a
              key={i}
              className="species-source"
              href={source.url}
              target="_blank"
              rel="noreferrer"
            >
              {source.label} ↗
            </a>
          ))}
          {s.credit && <p className="coastal-footnote">{s.credit}</p>}
          <p className="coastal-footnote">Reviewed {s.reviewDate}</p>
          {s.photoSource && (
            <a
              className="species-source"
              href={s.photoSource}
              target="_blank"
              rel="noreferrer"
            >
              {s.id === "grubeulepis-malayensis" ? "Schematic reference ↗" : "Photo source ↗"}
            </a>
          )}
          {media && (
            <a className="species-source" href={media.imageLicenseUrl} target="_blank" rel="noreferrer">
              Image license ↗
            </a>
          )}
        </section>
        <GhostButton onClick={() => nav("/community/wildlife-help")}>
          Hurt or stranded animal? Get help
        </GhostButton>
        <PrimaryButton onClick={goBack}>Back</PrimaryButton>
      </div>
    </main>
  );
}


export function HabitatScreen() {
  const { habitatId } = useParams();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const h = content.habitats.find((h) => h.id === habitatId);
  const beachId = originBeachId(params.get("beach"));
  const habitatRegion: Record<string, string> = { langkawi: "north", matang: "perak", "morib-mudflat": "selangor", "pulau-tinggi": "johor", "sungai-pulai": "johor", setiu: "tganu", "kuching-wetlands": "borneo", lawas: "borneo", "sandakan-bay": "borneo" };
  const mapPath = withBeach("/map?layer=bio" + (habitatRegion[habitatId ?? ""] ? "&region=" + habitatRegion[habitatId!] : ""), beachId);
  if (!habitatId)
    return (
      <CoastalPage
        title="Coastal Habitats"
        subtitle="Published records · not live sightings"
        back="/marine-life"
      >
        {content.habitats.map((h) => (
          <WhiteCard key={h.id}>
            <LinkRow
              title={h.title}
              subtitle={h.area}
              onClick={() => nav("/habitats/" + h.id)}
              leading={<PlaceThumb image={habitatCover(h.id)} size={56} />}
            />
          </WhiteCard>
        ))}
      </CoastalPage>
    );
  if (!h)
    return (
      <CoastalPage title="Habitat" back="/habitats">
        <DataUnavailable title="Habitat not found" />
      </CoastalPage>
    );
  const species = h.species
    .map((id) => content.species.find((s) => s.id === id))
    .filter((s) => !!s);
  const helpIndex = h.texts.indexOf("Help Protect This Habitat");
  const scopeIndex = h.texts.indexOf("Sources & scope");
  const habitatPhoto = content.photos.find(
    (p) =>
      p.name ===
      (h.id === "morib-mudflat"
        ? "Mudflat illustration"
        : /seagrass|tinggi|pulai/i.test(h.title)
          ? "Seagrass illustration"
          : "Mangrove illustration"),
  );
  return (
    <CoastalPage
      title="Habitat"
      back="/habitats"
      tabs={false}
      action={<button onClick={() => nav(mapPath)}>Map</button>}
    >
      {habitatPhoto?.image && (
        <section className="habitat-photo">
          <img
            src={habitatPhoto.image}
            alt="Habitat illustration, not a photograph of this site"
          />
          <span>
            Habitat illustration ·{" "}
            <a href={habitatPhoto.source} target="_blank" rel="noreferrer">
              Photo credit ↗
            </a>
          </span>
        </section>
      )}
      <SummaryCard eyebrow={h.area} description={h.title}>
        <p style={{ lineHeight: 1.5, color: "#ffffffcf" }}>{h.intro}</p>
      </SummaryCard>
      <SectionHeading>Life in This Habitat</SectionHeading>
      <p className="subtle" style={{ marginTop: -8 }}>
        Species of this habitat · not local sightings
      </p>
      {species.map((s) => (
        <WhiteCard key={s.id}>
          <LinkRow
            title={s.name}
            subtitle={s.intro}
            leading={
              <span className="row-thumb">
                <SpeciesPicture image={s.image} name={s.name} />
              </span>
            }
            onClick={() => nav("/species/" + s.id)}
          />
        </WhiteCard>
      ))}
      <SummaryCard eyebrow="Help Protect This Habitat">
        <p>
          {helpIndex >= 0
            ? h.texts[helpIndex + 1]
            : "Leave roots and burrows undisturbed."}
        </p>
        <GhostButton
          onClick={() =>
            nav(
              beachId ? "/beach/" + beachId : mapPath,
            )
          }
        >
          {beachId ? "Back to Beach" : "View Map"}
        </GhostButton>
        <GhostButton
          style={{ marginTop: 10 }}
          onClick={() => nav("/community")}
        >
          Browse Cleanups
        </GhostButton>
      </SummaryCard>
      <WhiteCard>
        <h3>Sources & Scope</h3>
        <p className="subtle">
          {scopeIndex >= 0 ? h.texts[scopeIndex + 1] : ""}
        </p>
        {h.sources.map((s, i) => (
          <a
            key={i}
            className="species-source"
            href={s.url}
            target="_blank"
            rel="noreferrer"
          >
            {s.label}
          </a>
        ))}
      </WhiteCard>
      <button onClick={() => nav("/credits")}>Habitat Photo Credits</button>
    </CoastalPage>
  );
}

export function MarineAreaScreen() {
  const { regionId } = useParams();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [why, setWhy] = useState(false);
  const r = content.regions.find((r) => r.id === regionId);
  const beachId = originBeachId(params.get("beach"), regionId);
  if (!r)
    return (
      <CoastalPage title="Marine Life by Area" back="/map?layer=bio">
        {content.regions.map((r) => (
          <WhiteCard key={r.id}>
            <LinkRow
              title={r.name}
              subtitle={r.records.length + " published records"}
              leading={<PlaceThumb image={regionPhoto(r.id)} size={56} />}
              onClick={() => nav("/marine-area/" + r.id)}
            />
          </WhiteCard>
        ))}
      </CoastalPage>
    );
  const groups = groupMarineRecords(r.records, params.get("species"));
  return (
    <CoastalPage
      title={r.name}
      eyebrow="Marine Life"
      subtitle="Published records · species photos"
      back={withBeach("/map?layer=bio&region=" + r.id, beachId)}
      tabs={false}
    >
      <MarineRecordCard record={groups[0].records[0]} records={groups[0].records} name={groups[0].name} beachId={beachId} />
      <SummaryCard eyebrow="AI-Assisted Impact Summary">
        <p style={{ lineHeight: 1.5 }}>
          Choose a beach with litter-type data for a local explanation.
        </p>
        <p className="coastal-footnote" style={{ color: "#ffffffb3" }}>
          Local data needed
        </p>
        <button
          style={{ color: C.lime, marginTop: 14 }}
          onClick={() => setWhy(true)}
        >
          Why This?
        </button>
      </SummaryCard>
      {groups.slice(1).map(group => <MarineRecordCard key={group.id} record={group.records[0]} records={group.records} name={group.name} beachId={beachId} />)}
      <WhiteCard>
        <h3>Sources & Photo Credits</h3>
        {r.sources.map((s, i) => (
          <a
            key={i}
            className="species-source"
            href={s.url}
            target="_blank"
            rel="noreferrer"
          >
            {s.label} ↗
          </a>
        ))}
        <button onClick={() => nav("/credits")}>Photo Credits</button>
      </WhiteCard>
      <PrimaryButton onClick={() => nav(withBeach("/map?layer=bio&region=" + r.id, beachId))}>
        View Biodiversity Map
      </PrimaryButton>
      <GhostButton
        onClick={() =>
          nav(beachId ? "/beach/" + beachId : "/map?layer=bio&region=" + r.id)
        }
      >
        {beachId ? "Back to Beach" : "View Map"}
      </GhostButton>
      {why && (
        <Sheet title="Why this explanation?" onClose={() => setWhy(false)}>
          <p className="subtle">
            This page connects published regional records to the coast. A
            species record does not mean that an animal is at this beach today.
          </p>
          <WhiteCard>
            <h3>What the sources tell us</h3>
            <p className="subtle">
              The place, species or habitat and the scope of each record are
              shown with its source. A local litter impact explanation needs
              recorded litter types for the selected beach.
            </p>
          </WhiteCard>
          <PrimaryButton
            style={{ marginTop: 16 }}
            onClick={() => setWhy(false)}
          >
            Understood
          </PrimaryButton>
        </Sheet>
      )}
    </CoastalPage>
  );
}
