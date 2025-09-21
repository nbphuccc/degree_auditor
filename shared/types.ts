// Types
export type College = { college_id: number; name: string; abbreviation: string | null };
export type PathwayName = { name: string };
export type Degree = { degree_id: number; code: string | null; name: string };
export type GroupRequirement = {group_id: number; description: string, group_instance: string}
export type StandaloneRequirement = {course_id: string; code: string}
export type TakenCourse = StandaloneRequirement & { associatedKey?: string };
export type RemainingGroupRequirement = GroupRequirement & {availability: string};
export type RemainingStandaloneRequirement = StandaloneRequirement & {availability: string}
// associatedKey is optional — present only for group requirements
