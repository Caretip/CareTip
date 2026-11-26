const STAFF_TONES = ["from-orange-400 to-amber-500", "from-rose-400 to-orange-400", "from-amber-400 to-orange-500", "from-orange-500 to-rose-400"] as const;

type StaffPreset = {
  roleKey: string;
  displayName: string;
  photoUrl: string;
};

/** Curated hospitality portraits — preview only, not real staff. */
const STAFF_PRESETS: Record<string, readonly StaffPreset[]> = {
  Restaurant: [
    {
      roleKey: "server",
      displayName: "Maya",
      photoUrl:
        "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "host",
      displayName: "James",
      photoUrl:
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "chef",
      displayName: "Sofia",
      photoUrl:
        "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "server",
      displayName: "Daniel",
      photoUrl:
        "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=240&h=240&fit=crop&crop=face&q=80",
    },
  ],
  Hotel: [
    {
      roleKey: "concierge",
      displayName: "Elena",
      photoUrl:
        "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "housekeeping",
      displayName: "Priya",
      photoUrl:
        "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "bellhop",
      displayName: "Marcus",
      photoUrl:
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "concierge",
      displayName: "Amira",
      photoUrl:
        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&h=240&fit=crop&crop=face&q=80",
    },
  ],
  Hospital: [
    {
      roleKey: "nurse",
      displayName: "Rachel",
      photoUrl:
        "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "caregiver",
      displayName: "David",
      photoUrl:
        "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "therapist",
      displayName: "Lina",
      photoUrl:
        "https://images.unsplash.com/photo-1594824476967-48c8b964273f?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "nurse",
      displayName: "Chris",
      photoUrl:
        "https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=240&h=240&fit=crop&crop=face&q=80",
    },
  ],
  Salon: [
    {
      roleKey: "stylist",
      displayName: "Zoe",
      photoUrl:
        "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "colorist",
      displayName: "Nina",
      photoUrl:
        "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "reception",
      displayName: "Olivia",
      photoUrl:
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "stylist",
      displayName: "Leo",
      photoUrl:
        "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=240&h=240&fit=crop&crop=face&q=80",
    },
  ],
  Bar: [
    {
      roleKey: "bartender",
      displayName: "Alex",
      photoUrl:
        "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "server",
      displayName: "Jordan",
      photoUrl:
        "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "barback",
      displayName: "Sam",
      photoUrl:
        "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "bartender",
      displayName: "Taylor",
      photoUrl:
        "https://images.unsplash.com/photo-1531427186611-ecfd6d936c79?w=240&h=240&fit=crop&crop=face&q=80",
    },
  ],
  Cafe: [
    {
      roleKey: "barista",
      displayName: "Emma",
      photoUrl:
        "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "server",
      displayName: "Noah",
      photoUrl:
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "pastry",
      displayName: "Chloe",
      photoUrl:
        "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "barista",
      displayName: "Lucas",
      photoUrl:
        "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=240&h=240&fit=crop&crop=face&q=80",
    },
  ],
  Other: [
    {
      roleKey: "teamMember",
      displayName: "Maya",
      photoUrl:
        "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "teamMember",
      displayName: "James",
      photoUrl:
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "teamMember",
      displayName: "Sofia",
      photoUrl:
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=240&h=240&fit=crop&crop=face&q=80",
    },
    {
      roleKey: "teamMember",
      displayName: "Daniel",
      photoUrl:
        "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=240&h=240&fit=crop&crop=face&q=80",
    },
  ],
};

const STAFF_ROLE_KEYS: Record<string, readonly [string, string]> = {
  Restaurant: ["server", "host"],
  Hotel: ["concierge", "housekeeping"],
  Hospital: ["nurse", "caregiver"],
  Salon: ["stylist", "colorist"],
  Bar: ["bartender", "server"],
  Cafe: ["barista", "server"],
  Other: ["teamMember", "teamMember"],
};

export type PreviewStaffSlot = {
  initials: string;
  displayName: string;
  roleKey: string;
  photoUrl: string;
  tone: (typeof STAFF_TONES)[number];
  isPlaceholder: boolean;
};

export function buildPreviewStaffSlots(
  businessName: string,
  businessType: string,
  options?: { count?: number },
): PreviewStaffSlot[] {
  const count = options?.count ?? 2;
  const presets = STAFF_PRESETS[businessType] ?? STAFF_PRESETS.Other;
  const isPlaceholder = businessName.trim().length === 0;

  return presets.slice(0, count).map((preset, i) => ({
    initials: preset.displayName.slice(0, 2).toUpperCase(),
    displayName: preset.displayName,
    roleKey: preset.roleKey,
    photoUrl: preset.photoUrl,
    tone: STAFF_TONES[i % STAFF_TONES.length]!,
    isPlaceholder,
  }));
}

export function previewStaffRoleKeys(businessType: string): readonly [string, string] {
  return STAFF_ROLE_KEYS[businessType] ?? STAFF_ROLE_KEYS.Other;
}
