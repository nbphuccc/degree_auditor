// Types
export type College = { college_id: number; name: string; abbreviation: string | null };
export type PathwayName = { name: string };
export type Degree = { degree_id: number; code: string | null; name: string };
export type GroupRequirement = {group_id: number; description: string, group_instance: string}
export type StandaloneRequirement = {course_id: string; code: string}
export type TakenCourse = StandaloneRequirement & { associatedKey?: string }; // associatedKey is optional — present only for group requirements
export type RemainingGroupRequirement = GroupRequirement & {availability: string};
export type RemainingStandaloneRequirement = StandaloneRequirement & {availability: string}
// Planner slot type
export type PlannerSlot = {
  course?: RemainingStandaloneRequirement | RemainingGroupRequirement;
  groupKey?: string; // used only for groups
  chosenCourse?: StandaloneRequirement // chosen course in the group
};
// Quarter type
export type Quarter = {
  name: "Fall" | "Winter" | "Spring" | "Summer";
  year: string;
  slots: PlannerSlot[];
  isPlaceholder?: boolean; // for "click to add Summer" card
};

export type Violation = {
  course_id: string; // dependent course that has violation
  message: string; // description of violation
  missingPrereqs?: string[]; // prereq ids missing / scheduled too late
};

export type Advisory = {
  course_id?: string;
  message: string;
    missingPrereqs?: string[];
};

export type VerifyPlannerResponse = {
  violations: Violation[];
  advisory: Advisory[];
  suggestedOrder: string[]; // topologically sorted list of course codes
  details: {
    nodesCount: number;
    edgesCount: number;
    topoHasCycle: boolean;
  };
};

export type MemberInfo = {
  scheduledTerm: number | null;
  id: string;
};

export type GroupWithMembers = {
  group_id: number;
  course_id: string | null;
  min_courses: number;
  members: string[];
};