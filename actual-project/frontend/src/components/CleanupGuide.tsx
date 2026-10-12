import { CLEANUP_GUIDE as guide } from "../content/cleanupGuide";
import { WhiteCard } from "./CoastalUI";
import { iteration3Request } from "../iteration3Api";
import type { WildlifeGuidance } from "../iteration3Personal";
import { useAsyncData } from "../useAsyncData";
import { mergeWildlifeGuidance } from "../wildlifeGuidance";
import { marineLifeCopy } from "../presentation";
export function CleanupGuide({ recorded = false, imageFree = false }: { recorded?: boolean; imageFree?: boolean }) {
  const dropOffName = guide.dropOffName && !guide.dropOffName.startsWith("[") ? guide.dropOffName : null;
  const checkedDate = guide.checkedDate && !guide.checkedDate.startsWith("[") ? guide.checkedDate : null;
  const recyclingName = guide.recyclingName && !guide.recyclingName.startsWith("[") ? guide.recyclingName : null;
  const mapsUrl = guide.mapsUrl && !guide.mapsUrl.startsWith("[") ? guide.mapsUrl : null;
  return (
    <section>
      <p className="eyebrow">{recorded ? "Last step" : "Before you go"}</p>
      <article className="cleanup-guide">
        {!recorded && (
          <>
            <div className="guide-photo">
              {!imageFree && <img
                src="/images/cleanup/volunteers.jpg"
                alt="Volunteers gathering litter on a beach"
              />}
              <div>
                <span>No organiser on site</span>
                <h2>Everyone runs it together</h2>
              </div>
            </div>
            <section>
              <h3>
                <b>1</b>Prepare
              </h3>
              <div className="guide-equipment">
                {guide.equipment.map(([image, label]) => (
                  <div key={image}>
                    {!imageFree && <img src={"/images/cleanup/" + image + ".jpg"} alt="" />}
                    <span>{label === "Two bags" || label === "Closed shoes" ? <>{label.split(" ")[0]}<br />{label.split(" ")[1]}</> : label}</span>
                  </div>
                ))}
              </div>
              <div className="guide-reminders">
                {guide.reminders.map((text) => (
                  <span key={text}>{text}</span>
                ))}
              </div>
            </section>
            <section>
              <h3>
                <b>2</b>Sort as you go
              </h3>
              <div className="guide-sorting">
                {guide.sorting.map((item) => (
                  <div key={item.title}>
                    {!imageFree && <img
                      src={"/images/cleanup/" + item.image + ".jpg"}
                      alt=""
                    />}
                    <small>{item.eyebrow}</small>
                    <strong>{item.title}</strong>
                    <p>{item.text}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
        <section>
          <h3>
            {!recorded && <b>3</b>}
            {recorded ? "Drop off your bags" : "Drop off"}
          </h3>
          <div className="guide-dropoff">
            {!imageFree && <img src="/images/cleanup/bintop.jpg" alt="Litter bin" />}
            <div>
              <strong>{dropOffName ?? "Drop-off point not confirmed"}</strong>
              <small>{checkedDate
                ? `Checked by Radar Sampah · ${checkedDate}`
                : "No confirmed drop-off or recycling details are available."}</small>
            </div>
          </div>
          <p className="subtle">
            Tie every bag. {recyclingName
              ? `Recycling goes to ${recyclingName}.`
              : "A recycling point has not been confirmed. Check disposal arrangements with the local council."}{" "}
            If no suitable bin is available or it is full, take your bags with you.
          </p>
          {mapsUrl ? (
            <a
              className="lime-button"
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in Maps
            </a>
          ) : null}
        </section>
        <div className="guide-emergency">
          <div>
            <strong>In an emergency, call 999</strong>
            <small>Police, ambulance, fire and rescue</small>
          </div>
          <a href="tel:999">Call 999</a>
        </div>
      </article>
    </section>
  );
}
export function WildlifeGuide() {
  const { data: guidance } = useAsyncData(() => iteration3Request<WildlifeGuidance>('/wildlife-guidance'), [], null);
  const effectiveGuidance = mergeWildlifeGuidance(guidance);
  return (
    <section>
      <p className="eyebrow">Marine Life-Friendly Cleanup</p>
      <WhiteCard>
        {effectiveGuidance.tips.slice(0, 3).map((text, i) => (
          <div key={text} className="wildlife-rule">
            <span>{i + 1}</span>
            <p>{marineLifeCopy(text)}</p>
          </div>
        ))}
        <p className="coastal-footnote">Reviewed {effectiveGuidance.reviewDate} · {marineLifeCopy(effectiveGuidance.note)}</p>

      </WhiteCard>
    </section>
  );
}
