"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const sqlite3_1 = __importDefault(require("sqlite3"));
const sqlite_1 = require("sqlite");
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.static(path_1.default.join(__dirname, "../../frontend/dist")));
// Open SQLite database
async function openDb() {
    return (0, sqlite_1.open)({
        filename: "./pathways.db", // your .db file in same folder
        driver: sqlite3_1.default.Database,
    });
}
// -----------------------
// Routes
// -----------------------
// Get all colleges
app.get("/api/colleges", async (req, res) => {
    const db = await openDb();
    const colleges = await db.all("SELECT * FROM College ORDER BY name");
    res.json(colleges);
});
// Get distinct pathway names for a given college
app.get("/api/pathways/distinct", async (req, res) => {
    const { collegeId } = req.query;
    if (!collegeId)
        return res.status(400).json({ error: "collegeId is required" });
    const db = await openDb();
    const pathways = await db.all(`
    SELECT DISTINCT name
    FROM Pathway
    WHERE college_id = ?
    ORDER BY name
    `, [collegeId]);
    res.json(pathways); // returns array of { name: string }
});
// Get degrees for a given pathway name
app.get("/api/degrees/by-pathway", async (req, res) => {
    const { pathwayName } = req.query;
    if (!pathwayName)
        return res.status(400).json({ error: "pathwayName is required" });
    const db = await openDb();
    const degrees = await db.all(`
    SELECT DISTINCT d.degree_id, d.code, d.name
    FROM Degree d
    JOIN Pathway p ON p.degree_id = d.degree_id
    WHERE p.name = ?
    ORDER BY d.name
    `, [pathwayName]);
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
        const standalone = await db.all(`
      SELECT c.course_id, c.code
      FROM RequirementStandalone rs
      JOIN Course c ON rs.course_id = c.course_id
      WHERE rs.pathway_id = ?
      ORDER BY c.code
      `, [pathwayId]);
        // 2. Group requirements (with instances expansion)
        const groups = await db.all(`
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
  `, [pathwayId]);
        res.json({
            standaloneRequirements: standalone,
            groupRequirements: groups,
        });
    }
    catch (err) {
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
    const pathway = await db.get(`
    SELECT pathway_id
    FROM Pathway
    WHERE college_id = ?
      AND name = ?
      AND degree_id = ?
    `, [collegeId, pathwayName, degreeId]);
    if (!pathway)
        return res.status(404).json({ error: "Pathway not found" });
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
        const coursesA = await db.all(`SELECT course_id, code FROM Course WHERE UPPER(code) = ?`, [courseCodeInput]);
        if (coursesA.length === 0) {
            return res.json({ valid: false, message: `Course code ${courseCodeInput} does not exist` });
        }
        // Get all courses in the group (CoursesB)
        const coursesB = await db.all(`SELECT c.course_id, c.code
       FROM RequirementGroupCourse rgc
       JOIN Course c ON rgc.course_id = c.course_id
       WHERE rgc.group_id = ?`, [groupId]);
        if (coursesB.length === 0) {
            return res.json({ valid: false, message: `No courses found in this group` });
        }
        const directMatch = coursesB.find((b) => coursesA.some((a) => a.course_id === b.course_id && a.code === b.code));
        // Filter CoursesB for any non-numeral after first 2 characters
        const nonNumeralCoursesB = coursesB.filter((b) => /[^0-9]/.test(b.course_id.slice(2)));
        // Check for direct match first
        if (directMatch && !nonNumeralCoursesB.some((c) => c.course_id === directMatch.course_id)) {
            return res.json({ valid: true, course: directMatch });
        }
        if (nonNumeralCoursesB.length === 0) {
            return res.json({ valid: false, message: `No valid courses in group to match` });
        }
        // Check user input against CoursesB
        let acceptedCourse = null;
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
            if (acceptedCourse)
                break; // stop after first valid match
        }
        if (acceptedCourse) {
            return res.json({ valid: true, course: acceptedCourse });
        }
        else {
            return res.json({
                valid: false,
                message: `Course ${courseCodeInput} does not satisfy group requirements`,
            });
        }
    }
    catch (err) {
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
        const standalone = await db.all(`
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
      `, [collegeId, ...standaloneCourseIds]);
        // Group availabilities (union of all courses in each group)
        const rawGroupCourses = await db.all(`
  SELECT rgc.group_id, rgc.course_id
  FROM RequirementGroupCourse rgc
  WHERE rgc.group_id IN (${groupIds.map(() => "?").join(",")})
  `, groupIds);
        // Map to collect results
        const groups = [];
        // Helper: turn booleans into "Fall, Winter, ..." string
        function formatAvailability(rows) {
            if (rows.length === 0)
                return "";
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
        const grouped = rawGroupCourses.reduce((acc, row) => {
            acc[row.group_id] = acc[row.group_id] || [];
            acc[row.group_id].push(row.course_id);
            return acc;
        }, {});
        for (const [groupIdStr, courseIds] of Object.entries(grouped)) {
            const groupId = Number(groupIdStr);
            let availability = "";
            let expandedCourseIds = [];
            for (const cid of courseIds) {
                const X = cid.slice(0, 2);
                const Y = cid.slice(2).replace(/^0+/, ""); // remove leading zeros
                // detect special case (Y has non-digit)
                const isSpecial = /\D/.test(Y);
                if (!isSpecial) {
                    // Normal course
                    expandedCourseIds.push(cid);
                }
                else if (Y === "ANY") {
                    // ANY placeholder: full availability
                    availability = "Fall, Winter, Spring, Summer";
                    break; // no need to check others
                }
                else {
                    // Placeholder like SC00ANTH → expand
                    const matches = await db.all(`
        SELECT course_id
        FROM Course
        WHERE course_id LIKE ?
          AND code LIKE ?
        `, [`${X}%`, `${Y}%`]);
                    expandedCourseIds.push(...matches.map((m) => m.course_id));
                }
            }
            if (!availability) {
                if (expandedCourseIds.length > 0) {
                    const rows = await db.all(`
        SELECT Fall, Winter, Spring, Summer
        FROM CourseAvailability
        WHERE college_id = ?
          AND course_id IN (${expandedCourseIds.map(() => "?").join(",")})
        `, [collegeId, ...expandedCourseIds]);
                    availability = formatAvailability(rows);
                }
                else {
                    availability = ""; // no matches
                }
            }
            groups.push({ group_id: groupId, availability });
        }
        return res.json({ standalone, groups });
    }
    catch (err) {
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
        const rawGroupCourses = await db.all(`SELECT course_id FROM RequirementGroupCourse WHERE group_id = ?`, [groupId]);
        let expandedCourseIds = [];
        let hasAny = false;
        for (const cidObj of rawGroupCourses) {
            const cid = cidObj.course_id;
            const X = cid.slice(0, 2);
            const Y = cid.slice(2).replace(/^0+/, "");
            const isSpecial = /\D/.test(Y);
            if (!isSpecial) {
                expandedCourseIds.push(cid);
            }
            else if (Y === "ANY") {
                hasAny = true;
                break; // ANY placeholder → all courses in group
            }
            else {
                const matches = await db.all(`SELECT course_id FROM Course WHERE course_id LIKE ? AND code LIKE ?`, [`${X}%`, `${Y}%`]);
                expandedCourseIds.push(...matches.map((m) => m.course_id));
            }
        }
        if (hasAny) {
            // Return all course_ids in the group
            const allCourses = await db.all(`SELECT course_id, code FROM Course
         WHERE course_id IN (SELECT course_id FROM RequirementGroupCourse WHERE group_id = ?)`, [groupId]);
            return res.json(allCourses);
        }
        // Filter by availability term
        const termColumn = term; // assume term matches the column name: Fall/Winter/Spring/Summer
        const coursesWithTerm = await db.all(`
      SELECT ca.course_id, c.code
      FROM CourseAvailability ca
      JOIN Course c ON ca.course_id = c.course_id
      WHERE ca.college_id = ?
        AND ca.course_id IN (${expandedCourseIds.map(() => "?").join(",")})
        AND ca.${termColumn} = 1
      `, [collegeId, ...expandedCourseIds]);
        return res.json(coursesWithTerm);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
app.get(/^\/.*$/, (req, res) => {
    res.sendFile(path_1.default.join(__dirname, "../../frontend/dist/index.html"));
});
// -----------------------
// Start server
// -----------------------
const PORT = 4000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
