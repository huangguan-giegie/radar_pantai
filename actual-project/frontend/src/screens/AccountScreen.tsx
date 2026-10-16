import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  storedRecoveryToken,
  USE_MOCK,
} from "../api";
import { useApp } from "../AppContext";
import {
  getAccountProfile,
  getContributions,
  getLeaderboard,
  updateAccountProfile,
  type AccountProfile,
  type Contributions,
  type Leaderboard,
} from "../accountApi";
import { useAsyncData } from "../useAsyncData";
import {
  CoastalPage,
  DataUnavailable,
  LinkRow,
  Sheet,
  SummaryCard,
  WhiteCard,
} from "../components/CoastalUI";
import {
  GhostButton,
  PrimaryButton,
  downloadRecoveryKit,
  Skeleton,
} from "../components/ui";
import {
  BarChart,
  BookmarkIcon,
  MailIcon,
  ShieldCheck,
  SpeciesIcon,
  UserIcon,
} from "../components/Icon";
import { formatDate } from "../theme";
import { validNickname } from "../accountPreview";
export default function AccountScreen() {
  const { section } = useParams();
  const nav = useNavigate();
  const { user, signOut, reportsVersion, showToast } = useApp();
  const id = user?.participantId ?? "";
  const { data: contributions, loading, error, refresh: refreshContributions } = useAsyncData<Contributions | null>(
    () => getContributions(id),
    [reportsVersion, id],
    null,
  );
  const { data: profile, setData: setProfile, loading: profileLoading, error: profileError, refresh: refreshProfile } = useAsyncData<AccountProfile | null>(
    () => getAccountProfile(id),
    [reportsVersion, id],
    null,
  );
  const { data: leaderboard, loading: leaderboardLoading, error: leaderboardError, refresh: refreshLeaderboard } = useAsyncData<Leaderboard | null>(
    () => section === "leaderboard" ? getLeaderboard() : Promise.resolve(null),
    [id, reportsVersion, section, profile?.joinedLeaderboard],
    null,
  );
  const ready = !loading && !error && contributions !== null;
  const points = ready ? contributions.points : null;
  const counted = ready ? contributions.countedReports : "—";
  const contributionSummary = loading ? "Loading contributions…" : error ? "Contributions unavailable" : `${contributions?.attendanceCount ?? 0} recorded attendance · ${counted} counted reports`;
  const loadError = error ? (
    <DataUnavailable title="Couldn’t Load Contributions" retry={() => { void refreshContributions(); void refreshProfile(); }}>{error}</DataUnavailable>
  ) : null;
  const profileLoadError = profileError ? (
    <DataUnavailable title="Couldn’t Load Your Profile" retry={() => { void refreshProfile(); }}>{profileError}</DataUnavailable>
  ) : null;
  const [nickname, setNickname] = useState("");
  const [validation, setValidation] = useState("");
  const [saving, setSaving] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const recoveryToken = storedRecoveryToken();
  useEffect(() => {
    setNickname(profile?.nickname ?? "");
  }, [id, profile?.nickname]);
  async function save(join?: boolean) {
    if (saving || profileLoading || !profile || profileError) return;
    if (join !== false && !validNickname(nickname)) {
      setValidation(
        "Use 3–30 characters. Don’t use an email address or phone number.",
      );
      return;
    }
    const input = join === false ? { joinedLeaderboard: false } : {
      nickname: nickname.trim(), ...(join === true ? { joinedLeaderboard: true } : {}),
    };
    setSaving(true);
    setValidation("");
    try {
      const next = await updateAccountProfile(id, input);
      setProfile(next);
      showToast(USE_MOCK ? "Saved on this device" : join === false ? "You left the leaderboard" : "Profile saved");
      if (join === undefined) nav("/account");
    } catch (reason) {
      setValidation(reason instanceof Error ? reason.message : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }
  const icon = (child: JSX.Element) => (
    <span
      className="row-thumb"
      style={{ width: 36, height: 36, borderRadius: 10 }}
    >
      {child}
    </span>
  );
  const nicknameInput = (
    <WhiteCard>
      <label className="eyebrow" htmlFor="public-nickname">
        Nickname
      </label>
      <input
        id="public-nickname"
        className="coastal-input"
        maxLength={30}
        autoComplete="off"
        value={nickname}
        disabled={saving || profileLoading || !!profileError}
        onChange={(e) => setNickname(e.target.value)}
      />
      <p className="coastal-footnote">
        3–30 characters. Not your name, email or phone.
      </p>
      {validation && (
        <p
          role="alert"
          className="coastal-footnote"
          style={{ color: "#9c4237" }}
        >
          {validation}
        </p>
      )}
    </WhiteCard>
  );
  if (section === "nickname")
    return (
      <CoastalPage
        title="Public Nickname"
        back="/account"
        subtitle="Only shown on the leaderboard if you join."
      >
        {profileLoading ? <Skeleton h={160} /> : profileLoadError || (
          <>
            {nicknameInput}
            <PrimaryButton disabled={saving || !profile} onClick={() => { void save(); }}>{saving ? "Saving…" : "Save Nickname"}</PrimaryButton>
            {USE_MOCK && <p className="demo-label">Preview · saved only on this device</p>}
          </>
        )}
      </CoastalPage>
    );
  if (section === "history")
    return (
      <CoastalPage title="Contribution History" back="/account">
        <SummaryCard
          eyebrow={USE_MOCK ? "Your Points · Preview" : "Your Contributions"}
          value={points ?? "—"}
          description="points"
        >
          <p className="account-divider">
            {contributionSummary}
          </p>
        </SummaryCard>
        {loading ? <Skeleton h={160} /> : loadError}
        {ready && contributions.history.map((entry) => (
          <WhiteCard key={entry.kind + ":" + entry.id}>
            <LinkRow
              title={entry.kind === "attendance" ? "Recorded attendance" : "Counted report"}
              subtitle={entry.beachName + " · " + formatDate(entry.createdAt)}
              trailing={<b>+{entry.points}</b>}
              onClick={() => nav((entry.kind === "attendance" ? "/events/" : "/reports/") + entry.id)}
            />
          </WhiteCard>
        ))}
        {ready && !contributions.history.length && (
          <DataUnavailable title="Your History Starts Here">
            Counted reports and recorded attendance will appear here.
          </DataUnavailable>
        )}
        <p className="coastal-footnote">
          Duplicate and incomplete reports are not included.{" "}
          Recorded attendance +5, counted report +1.
        </p>
      </CoastalPage>
    );
  if (section === "leaderboard")
    return (
      <CoastalPage
        title="Leaderboard"
        back="/account"
        subtitle={
          profile?.joinedLeaderboard
            ? "Nicknames only. You opted in."
            : "Off until you join. Leave any time."
        }
      >
        {loadError}
        {profileLoading ? <Skeleton h={160} /> : profileLoadError || (profile?.joinedLeaderboard ? (
          <>
            <SummaryCard
              eyebrow={USE_MOCK ? "Your Preview Profile" : "Your Profile"}
              description={profile.nickname}
              value={points ?? "—"}
            >
              <p className="account-divider">
                {USE_MOCK ? "points · personal rank not calculated" : `points · ${profile.rank === null ? "rank unavailable" : "rank #" + profile.rank}`}
              </p>
            </SummaryCard>
            {leaderboardLoading ? <Skeleton h={160} /> : leaderboardError ? (
              <DataUnavailable title="Couldn’t Load Leaderboard" retry={() => { void refreshLeaderboard(); }}>{leaderboardError}</DataUnavailable>
            ) : <WhiteCard>
              {leaderboard?.entries.map((entry, i) => (
                <div className="leaderboard-row" key={entry.nickname + ":" + i}>
                  <span>#{entry.rank}</span>
                  <strong>{entry.nickname}</strong>
                  <span>{entry.points}</span>
                </div>
              ))}
              {!leaderboard?.entries.length && <p className="subtle">No volunteers have joined yet.</p>}
            </WhiteCard>}
            {USE_MOCK && <p className="demo-label">Example leaderboard · as of 27-09-2026</p>}
            {validation && <p role="alert" className="coastal-footnote" style={{ color: "#9c4237" }}>{validation}</p>}
            <GhostButton
              disabled={saving}
              onClick={() => { void save(false); }}
            >
              {saving ? "Saving…" : "Leave Leaderboard"}
            </GhostButton>
          </>
        ) : (
          <>
            {nicknameInput}
            <SummaryCard eyebrow="Others Will See">
              <div className="leaderboard-row">
                <strong style={{ color: "white" }}>
                  {nickname || "Your nickname"}
                </strong>
                <span style={{ color: "#b8ff36" }}>{points ?? "—"} pts</span>
              </div>
            </SummaryCard>
            <PrimaryButton disabled={saving || !profile} onClick={() => { void save(true); }}>
              {saving ? "Saving…" : "Join Leaderboard"}
            </PrimaryButton>
            {USE_MOCK ? <p className="demo-label">Preview · this choice stays on your device</p> : <p className="coastal-footnote">Only your nickname, rank and points are public. You can leave any time.</p>}
          </>
        ))}
      </CoastalPage>
    );
  return (
    <CoastalPage title="Account">
      <SummaryCard eyebrow="">
        <div className="account-id">
          <div>
            <p className="eyebrow">Participant ID</p>
            <strong>{id}</strong>
          </div>
          <div>
            <p className="eyebrow">Points</p>
            <strong>
              {points ?? "—"}
            </strong>
          </div>
        </div>
        <p className="account-divider">
          {contributionSummary}
        </p>
      </SummaryCard>
      {loadError}
      {profileLoadError}
      <WhiteCard>
        <LinkRow
          title="Marine Life"
          subtitle="Explore species and habitats"
          leading={icon(<SpeciesIcon glyph="turtle" />)}
          onClick={() => nav("/marine-life")}
        />
      </WhiteCard>
      <WhiteCard>
        <LinkRow
          title="Public Nickname"
          trailing={<small>{profileLoading ? "Loading…" : profileError ? "Unavailable" : profile?.nickname || "Not set"}</small>}
          leading={icon(<UserIcon />)}
          onClick={() => nav("/account/nickname")}
        />
        <LinkRow
          title="Contribution History"
          leading={icon(<BarChart />)}
          onClick={() => nav("/account/history")}
        />
        <LinkRow
          title="Leaderboard"
          leading={icon(<BarChart />)}
          onClick={() => nav("/account/leaderboard")}
        />
        <LinkRow
          title="My Reports"
          trailing={<small>{loading || error ? "—" : contributions?.reportCount ?? "—"}</small>}
          leading={icon(<BookmarkIcon />)}
          onClick={() => nav("/reports")}
        />
      </WhiteCard>
      <WhiteCard>
        <LinkRow
          title="How It’s Rated"
          leading={icon(<BarChart />)}
          onClick={() => nav("/method")}
        />
      </WhiteCard>
      <WhiteCard>
        <LinkRow
          title="Location Privacy"
          leading={icon(<ShieldCheck />)}
          onClick={() => setPrivacy(true)}
        />
        {recoveryToken && (
          <LinkRow
            title="Save Recovery Details"
            leading={icon(<ShieldCheck />)}
            onClick={() => downloadRecoveryKit(id, recoveryToken)}
          />
        )}
        <LinkRow
          title="Sign Out"
          onClick={async () => {
            if (!window.confirm("Have you saved your participant ID and recovery token? You need them to restore this profile.")) return;
            await signOut();
            nav("/welcome", { replace: true });
          }}
        />
      </WhiteCard>
      <WhiteCard>
        <LinkRow
          title="Feedback"
          subtitle="Email the Radar Pantai team"
          leading={icon(<MailIcon />)}
          href="mailto:1838217031@qq.com?subject=Radar%20Pantai%20Feedback"
        />
      </WhiteCard>
      <p className="coastal-footnote" style={{ textAlign: "center" }}>
        Save your ID and recovery token before signing out.
      </p>
      {USE_MOCK && (
        <p className="demo-label">
          Preview · points are calculated on this device
        </p>
      )}
      {privacy && (
        <Sheet title="Your Privacy Matters" onClose={() => setPrivacy(false)}>
          <p className="subtle">
            You can browse beaches and Insights without sharing device location.
          </p>
          <ul className="subtle">
            <li>
              For a report, GPS can suggest a beach and check for matching
              litter. You can select a beach manually.
            </li>
            <li>
              Personalised suggestions use beach-level context. Device location
              is optional.
            </li>
          </ul>
          <SummaryCard eyebrow="Your location">
            <p>
              Report GPS is used for checks, then discarded. Others see only the
              beach.
            </p>
          </SummaryCard>
          <PrimaryButton
            style={{ marginTop: 16 }}
            onClick={() => setPrivacy(false)}
          >
            Understood
          </PrimaryButton>
        </Sheet>
      )}
    </CoastalPage>
  );
}
