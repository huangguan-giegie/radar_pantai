import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getBeach } from "../api";
import { useApp } from "../AppContext";
import {
  CoastalPage,
  DataUnavailable,
  SummaryCard,
  WhiteCard,
} from "../components/CoastalUI";
import { Alert, InfoChip } from "../components/ds";
import { Camera, Check, Pin } from "../components/Icon";
import {
  DraftChoiceDialog,
  GhostButton,
  PrimaryButton,
  Skeleton,
} from "../components/ui";
import { applyConfirmedCleanupBands } from "../cleanupFlow";
import {
  cleanupDraftScope,
  cleanupTargetVersion,
  clearCleanupDraft,
  readCleanupDraft,
  writeCleanupDraft,
} from "../cleanupDraft";
import {
  analyseCleanupPhoto,
  CLEANUP_BAND_UNITS,
  QUANTITY_BANDS,
} from "../iteration2";
import {
  fetchCleanupEvent,
  fetchCleanupTarget,
  submitCleanup,
} from "../iteration2Api";
import { hasDraftProgress, resumePath } from "../flowRules";
import { useAsyncData } from "../useAsyncData";
import { C, QUANTITY_DESC } from "../theme";
import type { CleanupAfterBand, LitterCategory, QuantityBand } from "../types";

export default function CleanupScreen() {
  const { beachId = "" } = useParams();
  const [params] = useSearchParams();
  const eventId = params.get("event");
  const nav = useNavigate();
  const {
    user,
    draft,
    resetDraft,
    patchDraft,
    setLastSavedReport,
    bumpReports,
  } = useApp();
  const {
    data: target,
    loading,
    error: targetError,
    refresh,
  } = useAsyncData(() => fetchCleanupTarget(beachId), [beachId], null);
  const { data: beach } = useAsyncData(
    () => getBeach(beachId),
    [beachId],
    null,
  );
  const { data: event } = useAsyncData(
    () => (eventId ? fetchCleanupEvent(eventId) : Promise.resolve(null)),
    [eventId],
    null,
  );
  const [category, setCategory] = useState<LitterCategory | null>(null);
  const [after, setAfter] = useState<CleanupAfterBand | null>(null);
  const [afterBands, setAfterBands] = useState<Partial<Record<LitterCategory, CleanupAfterBand>>>({});
  const [step, setStep] = useState<"linked" | "amount" | "ai">("linked");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftChoice, setDraftChoice] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<QuantityBand | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const key = useRef<string>(crypto.randomUUID());
  const operation = useRef(0);
  const busyRef = useRef(false);
  const scope = cleanupDraftScope(user?.participantId ?? "guest", beachId, eventId);
  const context = target ? scope + cleanupTargetVersion(target) : null;
  const [restoredContext, setRestoredContext] = useState<string | null>(null);
  const categories = Object.keys(
    target?.remainingBands ?? {},
  ) as LitterCategory[];
  const selected =
    category && categories.includes(category)
      ? category
      : (categories.find(
          (c) => CLEANUP_BAND_UNITS[target!.remainingBands[c]!] > 1,
        ) ?? categories[0]);
  const before = selected ? target?.remainingBands[selected] : undefined;
  const selectedAfter = selected ? afterBands[selected] ?? after : after;
  const chooseAfterFor = (item: LitterCategory, value: CleanupAfterBand | null) => {
    if (item === selected) setAfter(value);
    setAfterBands((previous) => {
      const next = { ...previous };
      if (value) next[item] = value;
      else delete next[item];
      return next;
    });
  };
  const chooseAfter = (value: CleanupAfterBand | null) => {
    if (selected) chooseAfterFor(selected, value);
  };
  useEffect(() => {
    operation.current += 1;
    busyRef.current = false;
    setBusy(false);
    return () => { operation.current += 1; };
  }, [scope, context]);
  useEffect(() => {
    if (loading || targetError) return;
    if (!target) {
      clearCleanupDraft(scope);
      setRestoredContext(null);
      return;
    }
    const saved = readCleanupDraft(scope, target);
    setCategory(saved.category);
    setAfter(saved.after);
    setAfterBands(saved.afterBands ?? (saved.category && saved.after ? { [saved.category]: saved.after } : {}));
    setStep(saved.step);
    setPhoto(saved.photo);
    setSuggestion(saved.suggestion);
    key.current = saved.idempotencyKey;
    setError(null);
    setRestoredContext(context);
  }, [scope, context, loading, targetError]);
  useEffect(() => {
    if (!target || restoredContext !== context || loading) return;
    writeCleanupDraft(scope, target, {
      category, after, afterBands, step, photo, suggestion, idempotencyKey: key.current,
    });
  }, [scope, context, restoredContext, loading, category, after, afterBands, step, photo, suggestion]);
  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  const back = eventId ? "/events/" + eventId : "/beach/" + beachId;
  const startReport = () => {
    resetDraft();
    setLastSavedReport(null);
    patchDraft({
      beachId,
      beachName: beach?.name ?? target?.beachName ?? null,
      linkedEventId: event?.joined ? event.id : null,
    });
    nav("/report/photo");
  };
  async function analyse(file: File) {
    if (!target || !selected || busyRef.current) return;
    const request = ++operation.current;
    busyRef.current = true;
    setPhoto(file);
    setStep("ai");
    setBusy(true);
    setError(null);
    setSuggestion(null);
    try {
      const result = await analyseCleanupPhoto(file, target);
      if (request !== operation.current) return;
      setSuggestion(result[selected] ?? null);
      if (!result[selected])
        setError(
          "No reliable suggestion for this litter type. Choose the amount yourself.",
        );
    } catch (reason) {
      if (request !== operation.current) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "The photo could not be checked. You can choose the amount yourself.",
      );
    } finally {
      if (request === operation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function save() {
    if (busyRef.current) return;
    if (!after && !Object.keys(afterBands).length) {
      setStep("amount");
      return;
    }
    if (!target || !selected || !user) return;
    const request = ++operation.current;
    const submissionKey = key.current;
    setError(null);
    try {
      const submittedBands = applyConfirmedCleanupBands(target.remainingBands, afterBands);
      if (Object.entries(submittedBands).every(([item, value]) => value === target.remainingBands[item as LitterCategory])) {
        setStep("amount");
        return;
      }
      setBusy(true);
      busyRef.current = true;
      const cleanup = await submitCleanup({
        participantId: user.participantId,
        targetReportId: target.reportId,
        eventId,
        afterBands: submittedBands,
        handling: "Not recorded",
        idempotencyKey: submissionKey,
      });
      clearCleanupDraft(scope, submissionKey);
      bumpReports();
      if (request !== operation.current) return;
      nav("/cleanup/result/" + cleanup.id, { replace: true });
    } catch (reason) {
      if (request !== operation.current) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save cleanup. Please try again.",
      );
    } finally {
      if (request === operation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  if (loading)
    return (
      <CoastalPage title="Log Your Cleanup" back={back} tabs={false}>
        <Skeleton h={260} r={22} />
      </CoastalPage>
    );
  if (targetError)
    return (
      <CoastalPage title="Log Your Cleanup" back={back} tabs={false}>
        <DataUnavailable
          title="Could not load the linked report"
          retry={() => void refresh()}
        >
          {targetError}
        </DataUnavailable>
      </CoastalPage>
    );
  if (!target)
    return (
      <CoastalPage
        title="Add a Litter Report First"
        eyebrow="Log cleanup"
        subtitle={beach?.name}
        back={back}
        tabs={false}
      >
        {draftChoice && (
          <DraftChoiceDialog
            onCancel={() => setDraftChoice(false)}
            onResume={() => nav(resumePath(draft))}
            onStartNew={() => {
              setDraftChoice(false);
              startReport();
            }}
          />
        )}
        <WhiteCard>
          <span className="empty-symbol">
            <Pin size={26} />
          </span>
          <h2>A cleanup needs a report</h2>
          <p className="subtle">
            Add a counted litter report at this beach first. It records the
            litter type and amount so you can compare what remains after
            cleaning.
          </p>
        </WhiteCard>
        <PrimaryButton
          onClick={() =>
            hasDraftProgress(draft) ? setDraftChoice(true) : startReport()
          }
          trailingArrow
        >
          Report Litter Here
        </PrimaryButton>
        <GhostButton onClick={() => nav(back, { replace: true })}>
          {eventId ? "Back to Event" : "Back to Beach"}
        </GhostButton>
      </CoastalPage>
    );
  const photoInput = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      capture="environment"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void analyse(file);
        e.target.value = "";
      }}
    />
  );
  if (step === "amount")
    return (
      <CoastalPage
        title="Litter Left After Cleanup"
        eyebrow={selected}
        subtitle="Check with AI first, or choose the amount yourself."
        back={undefined}
        tabs={false}
      >
        <button disabled={busy} onClick={() => setStep("linked")} style={{ color: C.navy }}>
          ← Back to Linked Report
        </button>
        {photoInput}
        <p className="subtle">
          Reported as <span className="band-pill">{before}</span>
        </p>
        <SummaryCard eyebrow="AI check">
          <Camera color={C.lime} size={26} />
          <h2 style={{ color: "white", marginTop: 12 }}>
            Take an After-Cleanup Photo
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#ffffffbf" }}>
            AI suggests how much is left. You confirm the amount.
          </p>
          <button
            className="lime-button"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            Take Photo
          </button>
          <p className="coastal-footnote" style={{ color: "#ffffffa6" }}>
            Used for analysis, then deleted. Not saved to your cleanup record.
          </p>
        </SummaryCard>
        <p className="eyebrow">Or choose yourself</p>
        <div role="radiogroup" aria-label="Remaining litter amount">
          <button
            className="amount-option"
            role="radio"
            aria-checked={selectedAfter === "None"}
            disabled={busy}
            onClick={() => {
              chooseAfter("None");
              setStep("linked");
              setError(null);
            }}
          >
            <span className="amount-radio" />
            <span>
              <strong>None</strong>
              <small>No litter remains in this category</small>
            </span>
          </button>
          {QUANTITY_BANDS.map((b) => (
            <button
              className="amount-option"
              role="radio"
              aria-checked={selectedAfter === b}
              disabled={busy}
              key={b}
              onClick={() => {
                chooseAfter(b);
                setStep("linked");
                setError(null);
              }}
            >
              <span className="amount-radio" />
              <span className="grow">
                <strong>{b}</strong>
                <small>{QUANTITY_DESC[b]}</small>
              </span>
              <span style={{ fontSize: 12, color: C.dim }}>
                {"▮".repeat(CLEANUP_BAND_UNITS[b])}
              </span>
            </button>
          ))}
        </div>
        <p className="coastal-footnote">
          If more litter remains than the report describes, add a new litter
          report. Small means a small amount remains.
        </p>
      </CoastalPage>
    );
  if (step === "ai")
    return (
      <CoastalPage
        title="Check the AI Suggestion"
        eyebrow="AI suggestion · review before saving"
        subtitle="You decide the final amount. A suggestion is never saved on its own."
        tabs={false}
      >
        <button disabled={busy} onClick={() => setStep("amount")}>
          ← Choose Remaining Amount
        </button>
        {photoInput}
        {photoUrl && (
          <img
            src={photoUrl}
            alt="Your after-cleanup photo"
            style={{
              width: "100%",
              height: 230,
              objectFit: "contain",
              background: "#e8ecf0",
              borderRadius: 20,
            }}
          />
        )}
        {busy ? (
          <div role="status">
            <Skeleton h={140} />
            <p className="subtle">Checking the photo…</p>
          </div>
        ) : (
          <WhiteCard>
            <h2>{selected}</h2>
            <div className="band-comparison">
              <div>
                <small>Reported before</small>
                <span className="band-pill">{before}</span>
              </div>
              <span>→</span>
              <div>
                <small>AI suggests</small>
                <span className="band-pill after">
                  {suggestion ?? "No suggestion"}
                </span>
              </div>
            </div>
            <p className="subtle">
              Small or hidden litter may be missed. Check what is left before
              using the suggestion.
            </p>
          </WhiteCard>
        )}
        {error && <Alert tone="caution">{error}</Alert>}
        <PrimaryButton
          disabled={busy || !suggestion}
          onClick={() => {
            chooseAfter(suggestion);
            setStep("linked");
            setPhoto(null);
            setError(null);
          }}
        >
          Use {suggestion ?? "Suggestion"} <Check />
        </PrimaryButton>
        <GhostButton
          disabled={busy}
          onClick={() => {
            setStep("amount");
            setPhoto(null);
            setError(null);
          }}
        >
          Choose a Different Amount
        </GhostButton>
        <button disabled={busy} onClick={() => nav("/method/ai")}>
          How the AI Suggestion Works
        </button>
      </CoastalPage>
    );
  return (
    <CoastalPage
      title="Log Your Cleanup"
      eyebrow="Log cleanup"
      subtitle="Compare what was reported with what remains."
      back={back}
      backDisabled={busy}
      tabs={false}
    >
      <WhiteCard>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <p className="eyebrow" style={{ margin: 0 }}>
            Linked litter report
          </p>
          <InfoChip>Counted</InfoChip>
        </div>
        <div className="coastal-link-row">
          <span className="row-thumb">
            <Pin size={22} />
          </span>
          <span>
            <strong>{target.beachName}</strong>
            <small>Counted litter report</small>
          </span>
        </div>
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          <p className="eyebrow" style={{ margin: 0 }}>Remaining amount for each litter type</p>
          {categories.map((item) => {
            const itemBefore = target.remainingBands[item]!;
            return (
              <label key={item} style={{ display: "grid", gap: 6, fontSize: 12, color: C.muted }}>
                <span>{item} · before cleanup {itemBefore}</span>
                <select
                  aria-label={`${item} remaining amount`}
                  value={afterBands[item] ?? ""}
                  disabled={busy}
                  onChange={(e) => {
                    const value = e.target.value as CleanupAfterBand | "";
                    setCategory(item);
                    chooseAfterFor(item, value || null);
                    setPhoto(null);
                    setSuggestion(null);
                    setError(null);
                  }}
                  style={{ width: "100%", padding: 11, border: "1px solid #dde3ec", borderRadius: 12, fontSize: 16, fontWeight: 650, color: C.navy, background: "white" }}
                >
                  <option value="">Choose amount left</option>
                  <option value="None">None · nothing remains</option>
                  {QUANTITY_BANDS
                    .filter((band) => CLEANUP_BAND_UNITS[band] < CLEANUP_BAND_UNITS[itemBefore])
                    .map((band) => <option key={band} value={band}>{band} · {QUANTITY_DESC[band]}</option>)}
                </select>
              </label>
            );
          })}
        </div>
        <div className="band-comparison">
          <div>
            <small>Before cleanup</small>
            <span className="band-pill">{before}</span>
          </div>
          <span>→</span>
          <div>
            <small>Left after cleanup</small>
            <button
              className={"band-pill " + (selectedAfter ? "after" : "choose")}
              disabled={busy}
              onClick={() => setStep("amount")}
            >
              {selectedAfter ?? "Choose Amount"}
            </button>
          </div>
        </div>
        <p className="coastal-footnote">
          Estimate the amount left. Exact counts are not needed.
        </p>
      </WhiteCard>
      <WhiteCard>
        <h3>What this records</h3>
        <p className="subtle">
          The remaining amount updates the linked report. A later report helps
          track how beach conditions change.
        </p>
      </WhiteCard>
      {error && <Alert tone="error">{error}</Alert>}
      <PrimaryButton disabled={busy} onClick={() => void save()} trailingArrow>
        {busy ? "Saving…" : "Save Cleanup"}
      </PrimaryButton>
    </CoastalPage>
  );
}
