import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import type { MemberInfo, GroupWithMembers } from "@shared/types";

const app = express();
app.use(cors({
origin: "https://degree-auditor-frontend.onrender.com"}));
app.use(express.json());
app.use(express.static(path.join(__dirname, "../../frontend/dist")));

// Open SQLite database
async function openDb() {
  return open({
    filename: "./pathways.db", // your .db file in same folder
    driver: sqlite3.Database,
  });
}

// -----------------------
// Routes
// -----------------------

app.get("/api/hello", (req, res) => {
  res.json({ message: "Hello from backend" });
});

// Get all colleges
app.get("/api/colleges", async (req, res) => {
  const db = await openDb();
  const colleges = await db.all("SELECT * FROM College ORDER BY name");
  res.json(colleges);
});

// Get distinct pathway names for a given college
app.get("/api/pathways/distinct", async (req, res) => {
  const { collegeId } = req.query;
  if (!collegeId) return res.status(400).json({ error: "collegeId is required" });

  const db = await openDb();
  const pathways = await db.all(
    `
    SELECT DISTINCT name
    FROM Pathway
    WHERE college_id = ?
    ORDER BY name
    `,
    [collegeId]
  );
  res.json(pathways); // returns array of { name: string }
});

// Get degrees for a given pathway name
app.get("/api/degrees/by-pathway", async (req, res) => {
  const { pathwayName } = req.query;
  if (!pathwayName) return res.status(400).json({ error: "pathwayName is required" });

  const db = await openDb();
  const degrees = await db.all(
    `
    SELECT DISTINCT d.degree_id, d.code, d.name
    FROM Degree d
    JOIN Pathway p ON p.degree_id = d.degree_id
    WHERE p.name = ?
    ORDER BY d.name
    `,
    [pathwayName]
  );
  res.json(degrees);
});

// Get requirements split into standalone + groups (with recursive instances)
app.get("/api/pathway-requirements", async (req, res) => {
  const { pathwayId } = req.query;
  if (!pathwayId) {
    return res.status(400).json({ error: "pathwayId is required" });
  }

  const db = await openDb();

  try {
    // 1. Standalone requirements (direct course requirements)
    const standalone = await db.all(
      `
      SELECT c.course_id, c.code
      FROM RequirementStandalone rs
      JOIN Course c ON rs.course_id = c.course_id
      WHERE rs.pathway_id = ?
      ORDER BY c.code
      `,
      [pathwayId]
    );

    // 2. Group requirements (with instances expansion)
    const groups = await db.all(
  `
  WITH RECURSIVE GroupInstances AS (
    SELECT 
        rg.group_id, 
        rg.description, 
        rgp.instances, 
        1 AS instance_count
    FROM RequirementGroupPathway rgp
    JOIN RequirementGroup rg 
      ON rgp.group_id = rg.group_id
    WHERE rgp.pathway_id = ?

    UNION ALL

    SELECT 
        gi.group_id, 
        gi.description, 
        gi.instances, 
        gi.instance_count + 1
    FROM GroupInstances gi
    WHERE gi.instance_count < gi.instances
)
SELECT 
    group_id,
    CASE 
      WHEN instances > 1 THEN description || ' (' || instance_count || ')'
      ELSE description
    END AS description,
    CAST(group_id AS TEXT) || '-' || CAST(instance_count AS TEXT) AS group_instance
FROM GroupInstances
ORDER BY description, instance_count;
  `,
  [pathwayId]
);



    res.json({
      standaloneRequirements: standalone,
      groupRequirements: groups,
    });
  } catch (err) {
    console.error("Error fetching requirements:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// Get pathway_id by college + pathway name + degree
app.get("/api/pathway-id", async (req, res) => {
  const { collegeId, pathwayName, degreeId } = req.query;
  if (!collegeId || !pathwayName || !degreeId) {
    return res.status(400).json({ error: "collegeId, pathwayName, degreeId are required" });
  }

  const db = await openDb();
  const pathway = await db.get(
    `
    SELECT pathway_id
    FROM Pathway
    WHERE college_id = ?
      AND name = ?
      AND degree_id = ?
    `,
    [collegeId, pathwayName, degreeId]
  );

  if (!pathway) return res.status(404).json({ error: "Pathway not found" });

  res.json(pathway); // { pathway_id: ... }
});

// Validate course code for a group with advanced rules
app.get("/api/groups/:groupId/validate-v2", async (req, res) => {
  const groupId = Number(req.params.groupId);
  const courseCodeInput = String(req.query.courseCode || "").trim().toUpperCase();

  if (!groupId || !courseCodeInput) {
    return res.status(400).json({ valid: false, message: "Group ID and course code are required" });
  }

  try {
    const db = await openDb();

    // Get all courses that match the user input (CoursesA)
    const coursesA = await db.all<{ course_id: string; code: string }[]>(
      `SELECT course_id, code FROM Course WHERE UPPER(code) = ?`,
      [courseCodeInput]
    );

    if (coursesA.length === 0) {
      return res.json({ valid: false, message: `Course code ${courseCodeInput} does not exist` });
    }

    // Get all courses in the group (CoursesB)
    const coursesB = await db.all<{ course_id: string; code: string }[]>(
      `SELECT c.course_id, c.code
       FROM RequirementGroupCourse rgc
       JOIN Course c ON rgc.course_id = c.course_id
       WHERE rgc.group_id = ?`,
      [groupId]
    );

    if (coursesB.length === 0) {
      return res.json({ valid: false, message: `No courses found in this group` });
    }

    const directMatch = coursesB.find(
      (b) => coursesA.some((a) => a.course_id === b.course_id && a.code === b.code)
    );
    

    // Filter CoursesB for any non-numeral after first 2 characters
    const nonNumeralCoursesB = coursesB.filter((b) =>
      /[^0-9]/.test(b.course_id.slice(2))
    );

    // Check for direct match first
    if (directMatch && !nonNumeralCoursesB.some((c) => c.course_id === directMatch.course_id)) {
      return res.json({ valid: true, course: directMatch });
    }

    if (nonNumeralCoursesB.length === 0) {
      return res.json({ valid: false, message: `No valid courses in group to match` });
    }

    // Check user input against CoursesB
    let acceptedCourse: { course_id: string; code: string } | null = null;
    for (const b of nonNumeralCoursesB) {
      const Y = b.course_id.slice(0, 2); // first 2 chars of courseID
      const X = b.course_id.slice(2).replace(/^0+/, "").toUpperCase(); // trim leading zeros

      for (const a of coursesA) {
        if (X === "ANY" && X !== courseCodeInput) {
          // ANY case: accept if course_id prefix matches
          if (a.course_id.startsWith(Y)) {
            acceptedCourse = a;
            break;
          }
        } 
        if (X !== "ANY" && X !== courseCodeInput) {
          // Non-ANY case: course code must start with X and course_id prefix must match Y
          if (a.code.toUpperCase().startsWith(X) && a.course_id.startsWith(Y)) {
            acceptedCourse = a;
            break;
          }
        }
      }

      if (acceptedCourse) break; // stop after first valid match
    }

    if (acceptedCourse) {
      return res.json({ valid: true, course: acceptedCourse });
    } else {
      return res.json({
        valid: false,
        message: `Course ${courseCodeInput} does not satisfy group requirements`,
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ valid: false, message: "Internal server error" });
  }
});

// Get availabilities for selected standalone courses + group requirements
app.post("/api/requirements-availability", async (req, res) => {
  const { collegeId, standaloneCourseIds, groupIds } = req.body;
  //console.log(collegeId);
  //console.log(standaloneCourseIds);
  //console.log(groupIds);

  if (!collegeId || !Array.isArray(standaloneCourseIds) || !Array.isArray(groupIds)) {
    return res.status(400).json({ error: "collegeId, standaloneCourseIds, and groupIds are required" });
  }

  const db = await openDb();

  try {
    // Standalone course availabilities
    const standalone = await db.all(
      `
      SELECT ca.course_id,
             TRIM(
               CASE WHEN ca.Fall   = 1 THEN 'Fall, '   ELSE '' END ||
               CASE WHEN ca.Winter = 1 THEN 'Winter, ' ELSE '' END ||
               CASE WHEN ca.Spring = 1 THEN 'Spring, ' ELSE '' END ||
               CASE WHEN ca.Summer = 1 THEN 'Summer, ' ELSE '' END
             , ', ') AS availability
      FROM CourseAvailability ca
      WHERE ca.college_id = ?
        AND ca.course_id IN (${standaloneCourseIds.map(() => "?").join(",")})
      `,
      [collegeId, ...standaloneCourseIds]
    );

    // Group availabilities (union of all courses in each group)
const rawGroupCourses = await db.all(
  `
  SELECT rgc.group_id, rgc.course_id
  FROM RequirementGroupCourse rgc
  WHERE rgc.group_id IN (${groupIds.map(() => "?").join(",")})
  `,
  groupIds
);

type GroupAvailability = { group_id: number; availability: string };

// Map to collect results
const groups: GroupAvailability[] = [];

// Helper: turn booleans into "Fall, Winter, ..." string
function formatAvailability(rows: any[]): string {
  if (rows.length === 0) return "";
  const hasFall = rows.some(r => r.Fall === 1);
  const hasWinter = rows.some(r => r.Winter === 1);
  const hasSpring = rows.some(r => r.Spring === 1);
  const hasSummer = rows.some(r => r.Summer === 1);

  return [
    hasFall ? "Fall" : null,
    hasWinter ? "Winter" : null,
    hasSpring ? "Spring" : null,
    hasSummer ? "Summer" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

// Group raw courses by group_id
const grouped = rawGroupCourses.reduce<Record<number, string[]>>((acc, row) => {
  acc[row.group_id] = acc[row.group_id] || [];
  acc[row.group_id].push(row.course_id);
  return acc;
}, {});

for (const [groupIdStr, courseIds] of Object.entries(grouped)) {
  const groupId = Number(groupIdStr);

  let availability = "";
  let expandedCourseIds: string[] = [];

  for (const cid of courseIds) {
    const X = cid.slice(0, 2);
    const Y = cid.slice(2).replace(/^0+/, ""); // remove leading zeros

    // detect special case (Y has non-digit)
    const isSpecial = /\D/.test(Y);

    if (!isSpecial) {
      // Normal course
      expandedCourseIds.push(cid);
    } else if (Y === "ANY") {
      // ANY placeholder: full availability
      availability = "Fall, Winter, Spring, Summer";
      break; // no need to check others
    } else {
      // Placeholder like SC00ANTH → expand
      const matches = await db.all(
        `
        SELECT course_id
        FROM Course
        WHERE course_id LIKE ?
          AND code LIKE ?
        `,
        [`${X}%`, `${Y}%`]
      );
      expandedCourseIds.push(...matches.map((m: any) => m.course_id));
    }
  }

  if (!availability) {
    if (expandedCourseIds.length > 0) {
      const rows = await db.all(
        `
        SELECT Fall, Winter, Spring, Summer
        FROM CourseAvailability
        WHERE college_id = ?
          AND course_id IN (${expandedCourseIds.map(() => "?").join(",")})
        `,
        [collegeId, ...expandedCourseIds]
      );
      availability = formatAvailability(rows);
    } else {
      availability = ""; // no matches
    }
  }

  groups.push({ group_id: groupId, availability });
}

return res.json({ standalone, groups});

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


// Get courses availability by term
app.post("/api/group-term-courses", async (req, res) => {
  const { groupId, collegeId, term } = req.body;
  if (!groupId || !collegeId || !term) {
    return res.status(400).json({ error: "groupId, collegeId, and term are required" });
  }

  const db = await openDb();

  try {
    // Get all course_ids in the group
    const rawGroupCourses = await db.all(
      `SELECT course_id FROM RequirementGroupCourse WHERE group_id = ?`,
      [groupId]
    );

    let expandedCourseIds: string[] = [];
    let hasAny = false;

    for (const cidObj of rawGroupCourses) {
      const cid = cidObj.course_id;
      const X = cid.slice(0, 2);
      const Y = cid.slice(2).replace(/^0+/, "");
      const isSpecial = /\D/.test(Y);

      if (!isSpecial) {
        expandedCourseIds.push(cid);
      } else if (Y === "ANY") {
        hasAny = true;
        break; // ANY placeholder → all courses in group
      } else {
        const matches = await db.all(
          `SELECT course_id FROM Course WHERE course_id LIKE ? AND code LIKE ?`,
          [`${X}%`, `${Y}%`]
        );
        expandedCourseIds.push(...matches.map((m: any) => m.course_id));
      }
    }

    if (hasAny) {
      // Return all course_ids in the group
      const allCourses = await db.all(
        `SELECT course_id, code FROM Course
         WHERE course_id IN (SELECT course_id FROM RequirementGroupCourse WHERE group_id = ?)`,
        [groupId]
      );
      return res.json(allCourses);
    }

    // Filter by availability term
    const termColumn = term; // assume term matches the column name: Fall/Winter/Spring/Summer
    const coursesWithTerm = await db.all(
      `
      SELECT ca.course_id, c.code
      FROM CourseAvailability ca
      JOIN Course c ON ca.course_id = c.course_id
      WHERE ca.college_id = ?
        AND ca.course_id IN (${expandedCourseIds.map(() => "?").join(",")})
        AND ca.${termColumn} = 1
      `,
      [collegeId, ...expandedCourseIds]
    );

    return res.json(coursesWithTerm);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

function topoSort(nodes: string[], edges: [string, string][]) {
  // nodes: array of node ids
  // edges: array of [from,to]
  const adj = new Map();
  const indeg = new Map();
  for (const n of nodes) {
    adj.set(n, []);
    indeg.set(n, 0);
  }
  for (const [u, v] of edges) {
    if (!adj.has(u)) adj.set(u, []);
    if (!adj.has(v)) adj.set(v, []);
    adj.get(u).push(v);
    indeg.set(v, (indeg.get(v) || 0) + 1);
    if (!indeg.has(u)) indeg.set(u, indeg.get(u) || 0);
  }
  // Kahn's algorithm
  const q = [];
  for (const [n, d] of indeg.entries()) {
    if (d === 0) q.push(n);
  }
  const order = [];
  while (q.length) {
    const n: string = q.shift();
    order.push(n);
    const neighbors = adj.get(n) || [];
    for (const m of neighbors) {
      indeg.set(m, indeg.get(m) - 1);
      if (indeg.get(m) === 0) q.push(m);
    }
  }
  // If all nodes in order => no cycle
  const hasCycle = order.length !== adj.size;
  return { order, hasCycle };
}

// Helper: get course codes (map course_id -> code)
async function loadCourseCodes() {
  const db = await openDb();
  const rows: { course_id: string; code: string }[] = await db.all(
  `SELECT course_id, code FROM Course`
);
  const map = new Map<string, string>(
    rows.map(r => [r.course_id, r.code ?? r.course_id])
  );
  return map;
}



/**
 * POST /api/verify-planner
 * body:
 * {
 *   schedule: [{ course_id: string, termIndex: number }],
 *   remainingStandaloneCourseIds: string[]   // from frontend
 * }
 *
 * Response:
 * { violations: Violation[], advisory: Advisory[], suggestedOrder?: string[], details?: any }
 */
app.post("/api/verify-planner", async (req, res) => {
  
  try {
    const { schedule, remainingStandaloneCourseIds } = req.body || {};

    if (!Array.isArray(schedule)) {
      return res.status(400).json({ error: "Missing or invalid 'schedule' in request body." });
    }
    if (!Array.isArray(remainingStandaloneCourseIds)) {
      return res.status(400).json({ error: "Missing or invalid 'remainingStandaloneCourseIds' in request body." });
    }

    // 1) Load prerequisite groups and group members
    // PrerequisiteGroup: group_id, course_id (dependent), min_courses
    // PrerequisiteGroupCourse: group_id, prereq_id
    const db = await openDb();

const groups = await db.all<{
  group_id: number;
  course_id: string;
  min_courses: number;
}[]>(`SELECT group_id, course_id, min_courses FROM PrerequisiteGroup`);


const groupMembersRows: { group_id: number; prereq_id: string }[] = await db.all(`
  SELECT group_id, prereq_id FROM PrerequisiteGroupCourse `);

    // Map group_id -> { course_id, min_courses, members: [] }
    const groupsById = new Map<number, GroupWithMembers>();
    for (const g of groups) {
      groupsById.set(g.group_id, { group_id: g.group_id, course_id: g.course_id, min_courses: g.min_courses || 1, members: [] });
    }
    for (const r of groupMembersRows) {
      const g = groupsById.get(r.group_id);
      if (g) g.members.push(r.prereq_id);
      else {
        // orphan group member? ignore or create entry
        groupsById.set(r.group_id, { group_id: r.group_id, course_id: null, min_courses: 1, members: [r.prereq_id] });
      }
    }

    // 2) Build nodes and edges for DAG (edges: prereq -> dependent)
    // Collect all unique course_ids appearing in groups or group members
    const nodeSet: Set<string> = new Set();
    const edges: [string, string][] = []; // correct type for topoSort
    for (const [, g] of groupsById) {
      const to = g.course_id;
      if (to) nodeSet.add(to);
      for (const prereq of g.members) {
        nodeSet.add(prereq);
        if (to) edges.push([prereq, to]);
      }
    }

    // 3) Topological sort across these nodes
    const nodes = Array.from(nodeSet);
    const { order: topoOrder, hasCycle } = topoSort(nodes, edges);

    // load course codes to show labels in advisory
    const courseCodes = await loadCourseCodes();

    // 4) Build quick lookup for schedule: course_id -> termIndex
    const scheduleMap = new Map();
    for (const item of schedule) {
      scheduleMap.set(item.course_id, item.termIndex);
    }

    // 5) Verification rules:
    // For each group G (with dependent = course_id)
    //   - If dependent not scheduled, we skip verification for that dependent (could be advisory? user didn't ask)
    //   - Otherwise check how many of group's members are scheduled at termIndex < dependent's termIndex
    //     - if count < min_courses:
    //         - for each missing prereq p in group.members:
    //             - if p is present in remainingStandaloneCourseIds but not scheduled => VIOLATION (missing prereq but available)
    //             - if p is not in remainingStandaloneCourseIds and not scheduled => ADVISORY (prereq missing and not available)
    //         - record violation (with missingPrereqs list and message)
    //
    // Also check for scheduled prerequisites that appear in schedule but scheduled in same/later quarter than dependent -> VIOLATION

    const violations = [];
    const advisory = [];

    // for quick membership:
    const remainingStandaloneSet = new Set(remainingStandaloneCourseIds);

    // Helper to add advisory item listing missing prereq course codes
    function pushAdvisoryForMissingPrs(missingIds: string[], dependentCourseId: string) {
      if (!missingIds || missingIds.length === 0) return;
      const codes = missingIds.map(id => courseCodes.get(id) ?? id);
      advisory.push({
        course_id: dependentCourseId,
        message: `Prerequisite(s) not planned and not available in remainingStandalone: ${codes.join(", ")}`
      });
    }

    // Iterate groups
    for (const [, g] of groupsById) {
      const dependent = g.course_id;
      if (!dependent) continue; // skip malformed

      // If dependent not scheduled, we still want to emit advisories for missing prereqs? The user asked:
      // "note that if there is a prereq that does not exist in the planner or in RemainingStandaloneRequirement, that is an advisory.
      // if there is a prereq that is not in the planner, but does exist in RemainingStandaloneRequirement, that is a violation"
      // We'll produce advisories/violations for prereqs relative to group members even if dependent not scheduled.
      // However, main "violation" about ordering applies only when dependent is scheduled.

      // Count how many group members are scheduled before dependent
      const dependentTerm = scheduleMap.has(dependent) ? scheduleMap.get(dependent) : null;

      // Determine scheduled status for each member
      const memberInfo = g.members.map((pr:string) => {
        const scheduledTerm = scheduleMap.has(pr) ? scheduleMap.get(pr) : null;
        return { id: pr, scheduledTerm };
      });

      // If dependent scheduled -> check ordering requirements
      if (dependentTerm !== null) {
        // count how many members scheduled strictly earlier than dependentTerm
        const countEarlier = memberInfo.reduce((acc: number, m: MemberInfo) => acc + (m.scheduledTerm !== null && m.scheduledTerm < dependentTerm ? 1 : 0), 0);

        if (countEarlier < g.min_courses) {
          // need to determine which prereqs are missing (not scheduled or scheduled too late)
          const missing = memberInfo
            .filter((m: MemberInfo) => !(m.scheduledTerm !== null && m.scheduledTerm < dependentTerm))
            .map((m: MemberInfo) => m.id);

          // classify each missing prereq as violation vs advisory according to remainingStandaloneCourseIds
          const missingViolations = missing.filter((id: string) => remainingStandaloneSet.has(id));
          const missingAdvisories = missing.filter((id: string) => !remainingStandaloneSet.has(id));

          if (missingViolations.length > 0) {
            violations.push({
              course_id: dependent,
              message: `Not enough prerequisites from group ${g.group_id} scheduled before ${dependent}. Required ${g.min_courses}, got ${countEarlier}. Missing prerequisites (available): ${missingViolations.join(", ")}`,
              missingPrereqs: missingViolations,
            });
          }
          if (missingAdvisories.length > 0) {
            // include course codes if available
            const codes = missingAdvisories.map((id: string) => courseCodes.get(id) ?? id);
            advisory.push({
              course_id: dependent,
              message: `Prerequisite(s) not planned and not available in remainingStandalone: ${codes.join(", ")}`
            });
          }
        }
      } else {
        // Dependent not scheduled — still report missing prereqs as advisory/violation per your rule (helpful to user)
        const notScheduled = memberInfo.filter((m: MemberInfo) => m.scheduledTerm === null).map((m: MemberInfo) => m.id);
        const viol = notScheduled.filter((id: string) => remainingStandaloneSet.has(id));
        const adv = notScheduled.filter((id: string) => !remainingStandaloneSet.has(id));
        if (viol.length > 0) {
          violations.push({
            course_id: dependent,
            message: `Prerequisite(s) for ${dependent} exist in remainingStandalone but are not scheduled: ${viol.join(", ")}`,
            missingPrereqs: viol
          });
        }
        if (adv.length > 0) {
          const codes = adv.map((id: string) => courseCodes.get(id) ?? id);
          advisory.push({
            course_id: dependent,
            message: `Prerequisite(s) for ${dependent} not planned nor available: ${codes.join(", ")}`
          });
        }
      }

      // Additional check: even if group min_courses satisfied, ensure any scheduled prereq appears before dependent
      // For any member m that is scheduled (has scheduledTerm) but scheduledTerm >= dependentTerm (if dependentTerm exists), it's a violation.
      if (dependentTerm !== null) {
        for (const m of memberInfo) {
          if (m.scheduledTerm !== null && m.scheduledTerm >= dependentTerm) {
            // Violation: prereq scheduled same or after dependent
            violations.push({
              course_id: dependent,
              message: `Prerequisite ${m.id} is scheduled in the same or later term than ${dependent}. It must be scheduled earlier.`,
              missingPrereqs: [m.id]
            });
          }
        }
      }
    }

    // 6) Also check for prerequisites not attached to groups (if you have other individual prereq edges)
    // For now, schema implies prerequisites are encoded via groups, so the above covers edges.

    // 7) Add topological info: if cycle present, return advisory/violation
    if (hasCycle) {
      advisory.push({
        message: `Prerequisite graph contains a cycle (circular prerequisites). Topological sort not possible.`
      });
    }

    // also include suggested topological order of known nodes (helps user)
    const suggestedOrder = topoOrder; // array of course_ids in topological order for the subgraph

    // Return structured result
    return res.json({
      violations,
      advisory,
      suggestedOrder,
      details: {
        nodesCount: nodes.length,
        edgesCount: edges.length,
        topoHasCycle: hasCycle
      }
    });
  } catch (err) {
    console.error("Error in /api/verify-planner:", err);
    return res.status(500).json({ error: String(err) });
  }
});

app.get(/^\/.*$/, (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend/dist/index.html"));
});

// -----------------------
// Start server
// -----------------------
const PORT = process.env.PORT || 4000; // Use the environment variable if available
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

