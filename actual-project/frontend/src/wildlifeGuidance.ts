import type { WildlifeGuidance } from "./iteration3Personal";

/** Local safety copy so a network request can never remove emergency contacts. */
export const WILDLIFE_GUIDANCE_FALLBACK: WildlifeGuidance = {
  tips: [
    "Keep away from nests and burrows",
    "Leave seaweed and driftwood in place",
    "Do not handle stranded or entangled animals",
    "Keep people and dogs away from wildlife",
    "Avoid walking on seagrass and dunes",
  ],
  reminder: [
    "Do not handle stranded or entangled animals",
    "Keep away from nests and burrows",
  ],
  incident: "Do not touch, move or disentangle the animal. Keep people and dogs back and contact the relevant authority.",
  authorities: [
    {
      name: "PERHILITAN: Peninsular Malaysia",
      phone: "1-800-88-5151",
      telephoneUri: "tel:1800885151",
      hours: "Daily, 8:00 AM to 6:00 PM Malaysia time",
      url: "https://wildpedia.wildlife.gov.my/page/help",
      lastChecked: "2026-10-09",
    },
    {
      name: "Department of Fisheries Malaysia: stranded turtles",
      phone: "03-8888 5019",
      telephoneUri: "tel:+60388885019",
      hours: "For stranded turtles; see the official marine park guidance.",
      url: "https://www.dof.gov.my/en/services/marine-park-resource-management/marine-park-management/",
      lastChecked: "2026-10-09",
    },
  ],
  reviewDate: "2026-10-09",
  note: "General guidance; follow the relevant authority. Radar Pantai does not report incidents on your behalf.",
};

/** Merge remote editorial updates without allowing a stale response to erase local contacts. */
export function mergeWildlifeGuidance(remote: WildlifeGuidance | null | undefined): WildlifeGuidance {
  if (!remote) return WILDLIFE_GUIDANCE_FALLBACK;
  const authorities = remote.authorities ?? [];
  const remoteFisheries = authorities.find(authority => authority.name.toLowerCase().includes("fisheries"));
  const remoteAuthorities = authorities.filter(authority => !authority.name.toLowerCase().includes("fisheries"));
  return {
    ...WILDLIFE_GUIDANCE_FALLBACK,
    ...remote,
    note: (remote.note ?? WILDLIFE_GUIDANCE_FALLBACK.note).replace(/Radar Sampah/g, "Radar Pantai"),
    authorities: [
      ...remoteAuthorities,
      { ...remoteFisheries, ...WILDLIFE_GUIDANCE_FALLBACK.authorities[1] },
    ],
  };
}
