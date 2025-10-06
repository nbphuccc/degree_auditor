// Types
export type College = { college_id: number; name: string; abbreviation: string | null };
export type PathwayName = { name: string };
export type Degree = { degree_id: number; code: string | null; name: string };
export type TakenCourse = StandaloneRequirement & { associatedKey?: string }; // associatedKey is optional — present only for group requirements
export type GroupRequirement = {group_id: number; description: string, group_instance: string}
export type StandaloneRequirement = {course_id: string; code: string}
export type RemainingGroupRequirement = GroupRequirement & {availability: string};
export type RemainingStandaloneRequirement = StandaloneRequirement & {availability: string}
// Planner slot type
export type PlannerSlot = {
  course?: RemainingStandaloneRequirement | RemainingGroupRequirement;
  groupKey?: string; // used only for groups
  chosenCourse?: RemainingStandaloneRequirement // chosen course in the group
};
// Quarter type
export type Quarter = {
  name: "Fall" | "Winter" | "Spring" | "Summer";
  year: string;
  slots: PlannerSlot[];
  isPlaceholder?: boolean; // for "click to add Summer" card
};

export type Violation = {
  course: RemainingStandaloneRequirement; // dependent course that has violation
  message: string; // description of violation
  missingPrereqs?: RemainingStandaloneRequirement[]; // prereqs missing / scheduled too late
};

export type Advisory = {
  course?: RemainingStandaloneRequirement;
  message: string;
  missingPrereqs?: RemainingStandaloneRequirement[];
};

export type VerifyPlannerResponse = {
  violations: Violation[];
  advisory: Advisory[];
  suggestedOrder: RemainingStandaloneRequirement[]; // topologically sorted list of courses
  details: {
    nodesCount: number;
    edgesCount: number;
    topoHasCycle: boolean;
  };
};

export type PlannerScheduleItem = {
  course: RemainingStandaloneRequirement;
  termIndex: number;
  termName: "Fall" | "Winter" | "Spring" | "Summer";
};

export type PrerequisiteGroupRow = {
  group_id: number;
  course_id: string; // dependent
  min_courses: number;
};

export type PrerequisiteGroupCourseRow = {
  group_id: number;
  prereq_id: string;
};

export type CourseMeta = {
  course_id: string;
  code: string;
};