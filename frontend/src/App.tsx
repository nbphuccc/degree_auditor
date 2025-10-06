import { useEffect, useState, useMemo } from "react";
import type { College, PathwayName, Degree, GroupRequirement, StandaloneRequirement, TakenCourse,
   RemainingGroupRequirement, RemainingStandaloneRequirement, Quarter, VerifyPlannerResponse} from "@shared/types";
import "./App.css";

export default function App() {
  const [colleges, setColleges] = useState<College[]>([]);
  const [pathways, setPathways] = useState<PathwayName[]>([]);
  const [degrees, setDegrees] = useState<Degree[]>([]);
  const [selectedCollege, setSelectedCollege] = useState<number | null>(null);
  const [selectedPathway, setSelectedPathway] = useState<string | null>(null);
  const [selectedDegree, setSelectedDegree] = useState<number | null>(null);

  const [groupRequirements, setGroupRequirements] = useState<GroupRequirement[]>([]);
  const [standaloneRequirements, setStandaloneRequirements] = useState<StandaloneRequirement[]>([]);
  const [takenGroupRequirements, setTakenGroupRequirements] = useState<Map<string, string>>(new Map());
  const [takenStandaloneRequirements, setTakenStandaloneRequirements] = useState<StandaloneRequirement[]>([]);
  const [_allTakenCourses, setAllTakenCourses] = useState<TakenCourse[]>([]);
  const [groupErrors, setGroupErrors] = useState<Map<string, string>>(new Map());

  const [locked, setLocked] = useState<boolean>(false);

  const [remainingGroupAvailabilities, setRemainingGrouAvailabilities] = useState<RemainingGroupRequirement[]>([]);
  const [remainingStandaloneAvailabilities, setRemainingStandaloneAvailabilities] = useState<RemainingStandaloneRequirement[]>([]);

  const [clickedGroupCourses, setClickedGroupCourses] = useState<{ course_id: string; code: string }[]>([]);
  const [clickedGroupLabel, setClickedGroupLabel] = useState<string>(""); // optional, show "Group XYZ — Fall"

  const [selectedQuarter, setSelectedQuarter] = useState<string | null>(null); // initially null
  const [plannerYear, setPlannerYear] = useState<string | null>(null);
  const [summerSkip, setSummerSkip] = useState<boolean>(false);
  const [plannerQuarters, setPlannerQuarters] = useState<Quarter[]>([]);
  const [usedStandalone, setUsedStandalone] = useState<Set<string>>(new Set()); // set of course_ids
  const [usedGroup, setUsedGroup] = useState<Set<string>>(new Set()); // set of group_id - instance
  const [plannerGroupErrors, setPlannerGroupErrors] = useState<Map<string, string>>(new Map());

  const [verifyResult, setVerifyResult] = useState<VerifyPlannerResponse | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [warmingUp, setWarmingUp] = useState(true);

  // Order of quarters
  const quarterOrder = ["Fall", "Winter", "Spring", "Summer"] as const;

  const BASE_URL = import.meta.env.VITE_BACKEND_URL;

  /**
 * Returns true if any planner slot is a group (groupKey present) but has no chosenCourse.
 */
const canVerify = useMemo(() => {
  for (const q of plannerQuarters) {
    for (const slot of q.slots) {
      if (slot.groupKey && (!slot.chosenCourse || !slot.chosenCourse.course_id)) {
        return false; // there's at least one group without chosenCourse
      }
    }
  }
  return plannerQuarters.length > 0; // optional: require at least one quarter
}, [plannerQuarters]);

function buildScheduleFromPlannerQuarters() {
  // Map quarter name to cycle index to compute chronological order if necessary.
  // But simplest: assign increasing termIndex by iterating plannerQuarters in array order.
  const schedule: { course: RemainingStandaloneRequirement; termIndex: number; termName: string }[] = [];

  // assign termIndex by quarter position (all slots in same quarter share same termIndex)
  for (let qIndex = 0; qIndex < plannerQuarters.length; qIndex++) {
    const quarter = plannerQuarters[qIndex];
    const termIndex = qIndex; // 0-based index by quarter order (preserves chronological order)
    const termName = quarter.name;
    for (const slot of quarter.slots) {
      if (!slot.course) continue;

      if ("course_id" in slot.course) {
        // standalone course
        schedule.push({ course: slot.course, termIndex, termName });
      } else {
        // group; use chosenCourse (frontend ensures chosenCourse exists before enabling Verify)
        if (slot.chosenCourse) {
          schedule.push({ course: slot.chosenCourse, termIndex, termName });
        } else {
          // Do not include group slots with no chosenCourse.
        }
      }
    }
  }

  return schedule;
}

const handleVerifier = async () => {
  // guard
  if (!canVerify) return;

  setVerifyLoading(true);
  setVerifyResult(null);
  setVerifyError(null);

  try {
    const schedule = buildScheduleFromPlannerQuarters();

    const payload = {
      schedule, // [{courses, termIndex}, ...]
      remainingStandaloneCourses: remainingStandaloneAvailabilities, // for backend to determine advisory vs violation per your rule
    };
    const res = await fetch(`${BASE_URL}/api/verify-planner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => null);
      throw new Error(`Server returned ${res.status}${text ? `: ${text}` : ""}`);
    }

    const json: VerifyPlannerResponse = await res.json();
    setVerifyResult(json);

  } catch (err: any) {
    console.error("Verify Planner failed", err);
    setVerifyError(err?.message ?? String(err));
  } finally {
    setVerifyLoading(false);
  }
}

  // --- Generate quarters dynamically ---
  useEffect(() => {
  if (!selectedQuarter || !plannerYear) return;

  const totalCourses = remainingStandaloneAvailabilities.length + remainingGroupAvailabilities.length;
  const numQuarters = Math.ceil(totalCourses / 3);

  const quarters: Quarter[] = [];
  let currentYear = Number(plannerYear);
  let qIndex = quarterOrder.indexOf(selectedQuarter as any);
  let quartersAdded = 0;

  while (quartersAdded < numQuarters) {
    let qName = quarterOrder[qIndex % 4];

    if (qName === "Summer" && summerSkip) {
      // add a clickable Summer placeholder, but do NOT count it toward the necessary quarters
      quarters.push({
        name: "Summer",
        year: currentYear.toString(),
        slots: [],
        isPlaceholder: true,
      });
      qIndex++;
      // don't increment quartersAdded here
      continue;
    }

    quarters.push({
      name: qName,
      year: currentYear.toString(),
      slots: [{}, {}, {}], // 3 slots per quarter
    });

    if (qName === "Winter") currentYear++; // increment year after Winter
    qIndex++;
    quartersAdded++;
  }

  setPlannerQuarters(quarters);
}, [selectedQuarter, plannerYear, summerSkip, remainingStandaloneAvailabilities, remainingGroupAvailabilities]);


  useEffect(() => {
    const wakeBackend = async () => {
      try {
        await fetch(`${BASE_URL}/api/hello`, { method: "GET" });
      } catch (err) {
        console.warn("Backend wake-up ping failed:", err);
      } finally {
        setWarmingUp(false);
      }
    };

    wakeBackend();
  }, []);

  // Fetch colleges
  useEffect(() => {
    fetch(`${BASE_URL}/api/colleges`)
      .then((res) => res.json())
      .then(setColleges)
      .catch((err) => console.error(err));
  }, []);

  // Fetch distinct pathways for selected college
  useEffect(() => {
    if (!selectedCollege) {
      setPathways([]);
      setSelectedPathway(null);
      setDegrees([]);
      setGroupRequirements([]);
      setStandaloneRequirements([]);
      return;
    }

    fetch(`${BASE_URL}/api/pathways/distinct?collegeId=${selectedCollege}`)
      .then((res) => res.json())
      .then(setPathways)
      .catch((err) => console.error(err));

    setSelectedPathway(null);
    setDegrees([]);
    setGroupRequirements([]);
    setStandaloneRequirements([]);
  }, [selectedCollege]);

  // Fetch degrees for selected pathway name
  useEffect(() => {
    if (!selectedPathway) {
      setDegrees([]);
      setSelectedDegree(null);
      setGroupRequirements([]);
      setStandaloneRequirements([]);
      return;
    }

    fetch(
      `${BASE_URL}/api/degrees/by-pathway?pathwayName=${encodeURIComponent(
        selectedPathway
      )}`
    )
      .then((res) => res.json())
      .then(setDegrees)
      .catch((err) => console.error(err));

    setSelectedDegree(null);
    setGroupRequirements([]);
    setStandaloneRequirements([]);
  }, [selectedPathway]);

  // CONFIRM button handler
  const handleConfirm = async () => {
  if (!selectedCollege || !selectedPathway || !selectedDegree) {
    alert("Please select College, Pathway, and Degree!");
    return;
  }

  try {
    // 1. Get pathway_id
    const res = await fetch(
      `${BASE_URL}/api/pathway-id?collegeId=${selectedCollege}&pathwayName=${encodeURIComponent(
        selectedPathway
      )}&degreeId=${selectedDegree}`
    );
    const data: { pathway_id: number } = await res.json();
    const pathwayId = data.pathway_id;

    // 2. Get requirements
    const reqRes = await fetch(
      `${BASE_URL}/api/pathway-requirements?pathwayId=${pathwayId}`
    );
    const reqData: {
      standaloneRequirements: StandaloneRequirement[];
      groupRequirements: GroupRequirement[];
    } = await reqRes.json();

    setStandaloneRequirements(reqData.standaloneRequirements);
    setGroupRequirements(reqData.groupRequirements);
  } catch (err) {
    console.error("Failed to fetch requirements:", err);
  }
};

  const handleCollegeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setGroupErrors(new Map());
    setTakenGroupRequirements(new Map());
    setTakenStandaloneRequirements([]);
    setAllTakenCourses([]);
    setSelectedCollege(e.target.value ? Number(e.target.value) : null);
  };

  const handlePathwayChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setGroupErrors(new Map());
    setTakenGroupRequirements(new Map());
    setTakenStandaloneRequirements([]);
    setAllTakenCourses([]);
    const name = e.target.value || null;
    setSelectedPathway(name);
  };

  const handleDegreeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setGroupErrors(new Map());
    setTakenGroupRequirements(new Map());
    setTakenStandaloneRequirements([]);
    setAllTakenCourses([]);
    setSelectedDegree(e.target.value ? Number(e.target.value) : null);
  };

  const handleStandaloneCheck = (req: any, checked: boolean) => {
    if (checked) {
      setTakenStandaloneRequirements((prev) => [...prev, req]);
      setAllTakenCourses((prev) => [...prev, req]);
    } else {
      setTakenStandaloneRequirements((prev) =>
        prev.filter((s) => s.course_id !== req.course_id)
      );
      setAllTakenCourses((prev) =>
        prev.filter((s) => s.course_id !== req.course_id)
      );
    }
  };

  const handleGroupInputChange = (key: string, value: string) => {
    const v = value.trim();
    setTakenGroupRequirements((prev) => {
      const next = new Map(prev);
      if (!v) {
        next.delete(key);
        setAllTakenCourses((prevCourses) =>
          prevCourses.filter((c) => c.associatedKey !== key)
        );
      } else {
        next.set(key, v);
      }
      return next;
    });
  };

  const handleGroupInputBlur = async (key: string, group: any, courseCode: string) => {
    const code = courseCode.trim();
    if (!code) {
      setGroupErrors((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      setAllTakenCourses((prevCourses) =>
        prevCourses.filter((c) => c.associatedKey !== key)
      );
      return;
    }

    try {
      const res = await fetch(
        `${BASE_URL}/api/groups/${group.group_id}/validate-v2?courseCode=${encodeURIComponent(code)}`
      );
      const { valid, course } = await res.json();

      setGroupErrors((prev) => {
        const next = new Map(prev);

        const isInStandalone = standaloneRequirements.some(
          (s) => s.code.toUpperCase() === code.toUpperCase()
        );

        setAllTakenCourses((prevCourses) =>
          prevCourses.filter((c) => c.associatedKey !== key)
        );

        if (!valid || !course) {
          next.set(key, `${code} is not valid for this group.`);
        } else if (isInStandalone) {
          next.set(key, `${code} is already a standalone requirement.`);
        } else if (
          Array.from(takenGroupRequirements.entries()).some(
            ([k, v]) => v === code && k !== key
          )
        ) {
          next.set(key, `${code} has already been entered in another group.`);
        } else {
          next.delete(key);
          setAllTakenCourses((prevCourses) => [
            ...prevCourses,
            { ...course, associatedKey: key },
          ]);
        }

        return next;
      });
    } catch {
      setGroupErrors((prev) => {
        const next = new Map(prev);
        next.set(key, "Validation failed (network error).");
        return next;
      });
    }
  };

  const handleLockToggle = async () => {
    if (!locked) {
      const takenGroupKeys = new Set(takenGroupRequirements.keys());
      const remainingGroups = groupRequirements.filter(
        (gr) => !takenGroupKeys.has(gr.group_instance)
      );
      const remainingStandalones = standaloneRequirements.filter(
        (sr) =>
          !takenStandaloneRequirements.some((t) => t.course_id === sr.course_id)
      );

      try {
        const payload = {
          collegeId: selectedCollege,
          standaloneCourseIds: remainingStandalones.map((sr) => sr.course_id),
          groupIds: remainingGroups.map((gr) => gr.group_id),
        };

        const response = await fetch(`${BASE_URL}/api/requirements-availability`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) throw new Error("Failed to fetch availability");

        const data = (await response.json()) as {
          standalone: { course_id: string; availability: string }[];
          groups: { group_id: number; availability: string }[];
        };

        const updatedStandalone: RemainingStandaloneRequirement[] =
          remainingStandalones.map((sr) => {
            const match = data.standalone.find(
              (s) => s.course_id === sr.course_id
            );
            return { ...sr, availability: match?.availability ?? "" };
          });

        const updatedGroup: RemainingGroupRequirement[] =
          remainingGroups.map((gr) => {
            const match = data.groups.find(
              (g) => g.group_id === gr.group_id
            );
            return { ...gr, availability: match?.availability ?? "" };
          });

        setRemainingStandaloneAvailabilities(updatedStandalone);
        setRemainingGrouAvailabilities(updatedGroup);
      } catch (err) {
        console.error(err);
      }
    } else {
      setRemainingStandaloneAvailabilities([]);
      setRemainingGrouAvailabilities([]);
      setClickedGroupCourses([]);
    }

    setLocked((prev) => !prev);
  };

  const handleGroupAvailabilityClick = async (gr: any, term: string) => {
    try {
      const res = await fetch(`${BASE_URL}/api/group-term-courses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: gr.group_id,
          collegeId: selectedCollege,
          term,
        }),
      });
      const data = await res.json();
      setClickedGroupCourses(data);
      setClickedGroupLabel(`${gr.description} — ${term}`);
    } catch (err) {
      console.error(err);
    }
  };

  // --- Add Summer manually ---
  const addSummerQuarter = (year: string) => {
    if (plannerQuarters.some(q => q.name === "Summer" && q.year === year && !q.isPlaceholder)) return;

    const springIndex = plannerQuarters.findIndex(q => q.name === "Spring" && q.year === year);
    const insertIndex = springIndex >= 0 ? springIndex + 1 : plannerQuarters.length;

    const newQuarter: Quarter = { name: "Summer", year, slots: [{}, {}, {}] };

    // remove placeholder if exists
    const newPlanner = plannerQuarters.filter(
      q => !(q.isPlaceholder && q.name === "Summer" && q.year === year)
    );

    newPlanner.splice(insertIndex, 0, newQuarter);
    setPlannerQuarters(newPlanner);
  };

  const addNextQuarter = () => {
  if (plannerQuarters.length === 0 || !plannerYear) return;

  const lastQuarter = plannerQuarters[plannerQuarters.length - 1];
  let lastIndex = quarterOrder.indexOf(lastQuarter.name as any);
  let nextIndex = (lastIndex + 1) % 4; // next quarter in order
  let nextYear = Number(lastQuarter.year);

  const nextQuarterName = quarterOrder[nextIndex];
  const newQuarters: Quarter[] = [];

  // Increment year after Winter
  if (lastQuarter.name === "Winter") {
    nextYear++;
  }

  if (nextQuarterName === "Summer" && summerSkip) {
    // 1️⃣ Add Summer placeholder
    newQuarters.push({
      name: "Summer",
      year: nextYear.toString(),
      slots: [],
      isPlaceholder: true,
    });

    // 2️⃣ Immediately add Fall after Summer placeholder
    const fallYear = nextYear; // Fall is same year after Summer
    newQuarters.push({
      name: "Fall",
      year: fallYear.toString(),
      slots: [{}, {}, {}],
    });
  } else {
    // Normal quarter
    newQuarters.push({
      name: nextQuarterName as any,
      year: nextYear.toString(),
      slots: [{}, {}, {}],
    });
  }

  setPlannerQuarters(prev => [...prev, ...newQuarters]);
};

// --- Helper functions ---
const getGroupKey = (group: RemainingGroupRequirement) =>
  `${group.group_id}-${group.group_instance}`;

/*
const isCourseUsed = (course: RemainingStandaloneRequirement | RemainingGroupRequirement) => {
  if ("course_id" in course) {
    return usedStandalone.has(course.course_id);
  } else {
    return usedGroup.has(getGroupKey(course));
  }
};
*/

// --- Drag handlers ---
const handleDragStart = (
  e: React.DragEvent<HTMLDivElement | HTMLLIElement>,
  course: RemainingStandaloneRequirement | RemainingGroupRequirement,
  qIdx?: number,
  sIdx?: number
) => {
  e.dataTransfer.setData(
    "dragData",
    JSON.stringify({ course, qIdx, sIdx })
  );
};

const handleDropCourse = (targetQ: number, targetS: number, e: React.DragEvent<HTMLDivElement>) => {
  const data = e.dataTransfer.getData("dragData");
  if (!data) return;
  const { course, qIdx, sIdx } = JSON.parse(data);

  setPlannerQuarters(prev => {
    const newPlanner = [...prev];

    // Case 1: Moving from planner
    if (qIdx !== undefined && sIdx !== undefined) {
      newPlanner[qIdx].slots[sIdx] = {}; // clear old slot
    }

    // Case 2: Dropping into target
    newPlanner[targetQ].slots[targetS] = {
      course,
      groupKey: "group_id" in course ? getGroupKey(course) : undefined,
    };

    return newPlanner;
  });

  // If dragged from availabilities, still need to update "used" sets
  if (qIdx === undefined) {
    if ("course_id" in course) {
      setUsedStandalone(prev => new Set(prev).add(course.course_id));
    } else {
      setUsedGroup(prev => new Set(prev).add(getGroupKey(course)));
    }
  }
};

const handleRemoveCourse = (qIdx: number, sIdx: number) => {
  const slot = plannerQuarters[qIdx].slots[sIdx];
  if (!slot.course) return;

  const course = slot.course;
  // Remove from used sets
  if ("course_id" in course) {
    setUsedStandalone(prev => {
      const newSet = new Set(prev);
      newSet.delete(course.course_id);
      return newSet;
    });
  } else {
    setUsedGroup(prev => {
      const newSet = new Set(prev);
      newSet.delete(getGroupKey(course));
      return newSet;
    });
  }

  // Remove from planner slot
  setPlannerQuarters(prev => {
    const newPlanner = [...prev];
    newPlanner[qIdx].slots[sIdx] = {};
    return newPlanner;
  });
};

const handlePlannerGroupInputBlur = async (
  qIdx: number,
  sIdx: number,
  group: RemainingGroupRequirement,
  courseCode: string
) => {
  const key = getGroupKey(group);
  const code = courseCode.trim();

  if (!code) {
    // Clear error + chosenCourse if input empty
    setPlannerGroupErrors((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });

    setPlannerQuarters((prev) => {
      const newPlanner = [...prev];
      newPlanner[qIdx].slots[sIdx].chosenCourse = undefined;
      return newPlanner;
    });

    return;
  }

  try {
    // --- First: validate the course for this group ---
    const res = await fetch(
      `${BASE_URL}/api/groups/${group.group_id}/validate-v2?courseCode=${encodeURIComponent(code)}`
    );
    const { valid, course } = await res.json();

    setPlannerGroupErrors((prev) => {
      const next = new Map(prev);

      // --- Check standalone conflicts ---
      const isInStandalone = remainingStandaloneAvailabilities.some(
        (s) => s.code.toUpperCase() === code.toUpperCase()
      );

      // --- Check other group slots ---
      const isInOtherGroup = plannerQuarters.some((quarter, q) =>
        quarter.slots.some(
          (slot, s) =>
            slot.groupKey &&
            slot.chosenCourse?.code.toUpperCase() === code.toUpperCase() &&
            !(q === qIdx && s === sIdx)
        )
      );

      if (!valid || !course) {
        next.set(key, `${code} is not valid for this group.`);
        return next;
      }

      if (isInStandalone) {
        next.set(key, `${code} is already a standalone requirement.`);
        return next;
      }

      if (isInOtherGroup) {
        next.set(key, `${code} has already been entered in another group.`);
        return next;
      }

      // --- Validation passed ---
      next.delete(key);

      // --- Fetch availability info ---
      (async () => {
        try {
          const availRes = await fetch(`${BASE_URL}/api/requirements-availability`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              collegeId: selectedCollege,
              standaloneCourseIds: [course.course_id],
              groupIds: [],
            }),
          });

          const data = await availRes.json();
          const availability =
            data?.standalone?.[0]?.availability ?? "";

          // --- Merge course info with availability ---
          const enrichedCourse: RemainingStandaloneRequirement = {
            ...course,
            availability,
          };

          // --- Update planner with enriched course ---
          setPlannerQuarters((prev) => {
            const newPlanner = [...prev];
            const slot = newPlanner[qIdx].slots[sIdx];
            // Type guard for sanity
            if (slot && "group_id" in group) {
              slot.chosenCourse = enrichedCourse;
            }
            console.log(enrichedCourse.availability);
            return newPlanner;
          });
        } catch (err) {
          console.error("Error fetching availability:", err);
          setPlannerGroupErrors((prev) => {
            const next = new Map(prev);
            next.set(key, "Could not fetch course availability.");
            return next;
          });
        }
      })();

      return next;
    });
  } catch (err) {
    console.error("Error validating course:", err);
    setPlannerGroupErrors((prev) => {
      const next = new Map(prev);
      next.set(key, "Validation failed (network error).");
      return next;
    });
  }
};

  // === JSX ===
  return (
    <div className="page-container">
      <div className="page">
        <div className="column">
          <div className="box">
            <div>{warmingUp && <p>⏳ Waking up backend… this may take a few seconds</p>}</div>
            <h2>PATHWAY SELECTOR</h2>

            {/* College Dropdown */}
            <div className="dropdown">
              <label>
                College:
                <select
                  value={selectedCollege ?? ""}
                  onChange={handleCollegeChange}
                  disabled={locked}
                >
                  <option value="">-- Select a College --</option>
                  {colleges.map((c) => (
                    <option key={c.college_id} value={c.college_id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Pathway Dropdown */}
            <div className="dropdown">
              <label>
                Pathway:
                <select
                  value={selectedPathway ?? ""}
                  onChange={handlePathwayChange}
                  disabled={!selectedCollege || locked}
                >
                  <option value="">-- Select a Pathway --</option>
                  {pathways.map((p, idx) => (
                    <option key={idx} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Degree Dropdown */}
            <div className="dropdown">
              <label>
                Degree:
                <select
                  value={selectedDegree ?? ""}
                  onChange={handleDegreeChange}
                  disabled={!selectedPathway || locked}
                >
                  <option value="">-- Select a Degree --</option>
                  {degrees.map((d) => (
                    <option key={d.degree_id} value={d.degree_id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* CONFIRM Button */}
            <button onClick={handleConfirm} disabled={!selectedDegree || locked}>
              CONFIRM
            </button>
          </div>

          {/* Requirements Display */}
          {(groupRequirements.length > 0 || standaloneRequirements.length > 0) && (
            <div className="box">
              <h2>REQUIRED COURSES</h2>

              {/* Standalone Requirements */}
              <h3>Check the box of classes you have taken</h3>
              {standaloneRequirements.length > 0 && (
                <ul className="requirements-list">
                  {standaloneRequirements.map((req) => (
                    <li key={req.course_id}>
                      <label>
                        <input
                          type="checkbox"
                          className="checkbox"
                          checked={takenStandaloneRequirements.some(
                            (s) => s.course_id === req.course_id
                          )}
                          onChange={(e) =>
                            handleStandaloneCheck(req, e.target.checked)
                          }
                          disabled={locked}
                        />
                        {req.code}
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              {/* Group Requirements */}
              <h3>Fill in the box the class you have taken in each groups</h3>
              {groupRequirements.length > 0 && (
                <ul className="requirements-list">
                  {groupRequirements.map((group) => {
                    const key = group.group_instance;
                    return (
                      <li key={key} className="group-item">
                        <div className="group-description">
                          {group.description}
                        </div>
                        <input
                          type="text"
                          className="textbox"
                          placeholder="Enter course code"
                          value={takenGroupRequirements.get(key) ?? ""}
                          onChange={(e) =>
                            handleGroupInputChange(key, e.target.value)
                          }
                          onBlur={(e) =>
                            handleGroupInputBlur(key, group, e.target.value)
                          }
                          disabled={locked}
                        />
                        {groupErrors.has(key) && (
                          <div className="error-text">{groupErrors.get(key)}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <button
                className={`button ${locked ? "button-unlock" : "button-lock"}`}
                onClick={handleLockToggle}
                disabled={groupErrors.size !== 0}
              >
                {locked ? "UNLOCK" : "LOCK-IN"}
              </button>
            </div>
          )}
        </div>
      </div>

  {locked && (
    <>
      <div className="page">
        <div className="column">
          <div className="box">
            <h2>Remaining Requirements with Availability</h2>

            {remainingStandaloneAvailabilities.length > 0 && (
              <ul className="requirements-list">
                {remainingStandaloneAvailabilities.map(sr => {
                  const used = usedStandalone.has(sr.course_id);
                  return (
                    <li
                      key={sr.course_id}
                      className="requirement-item"
                      draggable={!used}
                      onDragStart={e => handleDragStart(e, sr)}
                      style={{ opacity: used ? 0.5 : 1, cursor: used ? "not-allowed" : "grab" }}
                    >
                      <span className="requirement-text">{sr.code}</span>
                      <span className="term-container">
                        {sr.availability?.split(", ").map(term => (
                          <span key={term} className={`term-badge ${term.toLowerCase()}`}>{term}</span>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {remainingGroupAvailabilities.length > 0 && (
              <>
                <h3>Group Requirements</h3>
                <ul className="requirements-list">
                  {remainingGroupAvailabilities.map(gr => {
                    const key = getGroupKey(gr);
                    const used = usedGroup.has(key);
                    return (
                      <li
                        key={key}
                        className="requirement-item"
                        draggable={!used}
                        onDragStart={e => handleDragStart(e, gr)}
                        style={{ opacity: used ? 0.5 : 1, cursor: used ? "not-allowed" : "grab" }}
                      >
                        <span className="requirement-text">{gr.description}</span>
                        <span className="term-container">
                          {gr.availability?.split(", ").map(term => (
                            <span
                              key={term}
                              className={`term-badge ${term.toLowerCase()}`}
                              style={{ cursor: "pointer" }}
                              onClick={() => handleGroupAvailabilityClick(gr, term)}
                            >
                              {term}
                            </span>
                          ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {clickedGroupCourses.length > 0 && (
                  <div className="box">
                    <h3>{`${clickedGroupLabel
                      .split("—")
                      .pop()
                      ?.trim()} Courses`}</h3>
                    <ul className="requirements-list">
                      {clickedGroupCourses
                        .slice()
                        .sort((a, b) => a.code.localeCompare(b.code))
                        .map((c) => (
                          <li key={c.course_id}>{c.code}</li>
                        ))}
                    </ul>
                  </div>
                )}
          </div>
        </div>
      </div>

      {/* --- Planner Section --- */}
  <div className="planner-layout">
    {/* Left panel: Planner controls */}
    <div className="planner-panel">
      <div className="planner-controls">
        <h2>Planner</h2>
        <div className="planner-row">
          {/* Quarter Dropdown */}
          <div className="dropdown-vertical">
            <label>
              Next academic quarter:&nbsp;
              <select
                value={selectedQuarter ?? ""}
                onChange={e => setSelectedQuarter(e.target.value || null)}
              >
                <option value="">-- Select Quarter --</option>
                <option value="Fall">Fall</option>
                <option value="Winter">Winter</option>
                <option value="Spring">Spring</option>
                <option value="Summer">Summer</option>
              </select>
            </label>
          </div>

          {/* Year input */}
          <div className="dropdown">
            <label>
              Year:&nbsp;
              <input
                type="text"
                className="small-textbox"
                value={plannerYear ?? ""}
                onChange={e => setPlannerYear(e.target.value || null)}
                placeholder={`e.g. ${new Date().getFullYear()}`}
              />
            </label>
          </div>

          {/* Skip Summer */}
          <div className="dropdown">
            <label>
              <input
                type="checkbox"
                checked={summerSkip}
                onChange={e => setSummerSkip(e.target.checked)}
              />
              &nbsp;Skip Summer
            </label>
          </div>
        </div>
      </div>
    </div>

    {/* Right panel: Quarter cards */}
    <div className="quarters-panel">
      {selectedQuarter && plannerYear && (
        <div className="planner-quarters">
          {plannerQuarters.map((q, qIdx) => (
            <div key={`${q.name}-${q.year}`} className="quarter-card box">
              <h3>{q.name} {q.year}</h3>

              {!q.isPlaceholder && (
                <div className="quarter-slots">
                  {q.slots.map((slot, sIdx) => (
                    <div
  key={sIdx}
  className="quarter-slot"
  onDragOver={(e) => e.preventDefault()}
  onDrop={(e) => handleDropCourse(qIdx, sIdx, e)}
>
  {slot.course ? (
    <div
      className="slot-course-wrapper"
      draggable
      onDragStart={(e) => handleDragStart(e, slot.course!, qIdx, sIdx)}
    >
      <span className="slot-course">
        {"course_id" in slot.course
          ? slot.course.code
          : slot.course.description}
      </span>

      <div className="slot-controls">
        {"availability" in slot.course && slot.course.availability && (
          <span className="term-container">
            {slot.course.availability.split(", ").map((term) => (
              <span key={term} className={`term-badge ${term.toLowerCase()}`}>
                {term}
              </span>
            ))}
          </span>
        )}
        <button
          className="remove-btn"
          onClick={() => handleRemoveCourse(qIdx, sIdx)}
        >
          –
        </button>

        {"group_id" in slot.course && (
  <div className="group-input">
    <input
      type="text"
      placeholder="Enter course code"
      defaultValue={slot.chosenCourse?.code ?? ""}
      onBlur={(e) =>
        handlePlannerGroupInputBlur(qIdx, sIdx, slot.course as RemainingGroupRequirement, e.target.value)
      }
      className="group-course-textbox"
    />
    {plannerGroupErrors.has(getGroupKey(slot.course)) && (
      <div className="error-text">
        {plannerGroupErrors.get(getGroupKey(slot.course))}
      </div>
    )}
  </div>
)}

      </div>
    </div>
  ) : (
    <span className="slot-placeholder">Drag a course here</span>
  )}
</div>


                    
                  ))}
                </div>
              )}

              {q.isPlaceholder && (
                <button onClick={() => addSummerQuarter(q.year)}>Add Summer</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="quarter-add-button">
        <button onClick={addNextQuarter}>Add Next Quarter</button>
      </div>
    </div>

    <div className="planner-display mt-4">
  <h2 className="text-xl font-semibold mb-2">Planner Quarters</h2>
  {plannerQuarters.length === 0 ? (
    <p className="text-gray-600">No quarters scheduled yet.</p>
  ) : (
    <div className="space-y-4">
      {plannerQuarters.map((quarter, _qIdx) => (
        <div key={`${quarter.name}-${quarter.year}`} className="p-2 border rounded-md">
          <h3 className="font-medium">{quarter.name} {quarter.year}</h3>
          {quarter.slots.length === 0 ? (
            <p className="ml-4 text-gray-600">No slots in this quarter.</p>
          ) : (
            <ul className="ml-4 list-disc">
              {quarter.slots.map((slot, sIdx) => (
                <li key={sIdx}>
  {slot.groupKey ? (
    <>
      Group: {slot.groupKey} &mdash; Chosen: {slot.chosenCourse ? slot.chosenCourse.code : "None"}
    </>
  ) : slot.course && "course_id" in slot.course ? (
    `${slot.course.code} (${slot.course.course_id})`
  ) : (
    "Empty slot"
  )}
</li>

              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )}

  <h2 className="text-xl font-semibold mt-6 mb-2">Derived Schedule</h2>
  {plannerQuarters.length === 0 ? (
    <p className="text-gray-600">Schedule will appear here after adding quarters.</p>
  ) : (() => {
    const schedule = buildScheduleFromPlannerQuarters();
    if (schedule.length === 0) {
      return <p className="text-gray-600">No courses selected yet.</p>;
    }
    return (
      <ol className="ml-4 list-decimal">
        {schedule.map((item, idx) => (
          <li key={idx}>
            {item.course.code} ({item.course.course_id}) &mdash; Term: {item.termName} (Index: {item.termIndex})
          </li>
        ))}
      </ol>
    );
  })()}
</div>


    <div className="planner-verifier mt-4">
  {/* Verify Planner Button */}
  <button
    onClick={handleVerifier}
    disabled={!canVerify || verifyLoading}
    className={`px-4 py-2 rounded-md font-semibold text-white ${
      !canVerify || verifyLoading ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
    }`}
  >
    {verifyLoading ? "Verifying..." : "Verify Planner"}
  </button>

  {/* Verifier Result Display */}
  <div className="verifier-section mt-4">
    {verifyLoading && <p className="text-blue-700">Verifying planner...</p>}

    {verifyError && <p className="text-red-700">Error: {verifyError}</p>}

    {verifyResult && (
      <div className="verifier-result p-4 bg-gray-50 rounded-md shadow-sm">
        <h2 className="text-xl font-semibold mb-2">Verifier Results</h2>

        {/* Violations */}
        <section className="mb-4">
          <h3 className="text-lg font-medium text-red-700">Violations</h3>
          {verifyResult.violations.length === 0 ? (
            <p className="text-green-700">No violations detected!</p>
          ) : (
            <ul className="ml-4 list-disc">
              {verifyResult.violations.map((v, idx) => (
                <li key={idx} className="mb-2">
                  <strong>{v.course.code}</strong>: {v.message}
                  {v.missingPrereqs && (
                    <div className="ml-4">
                      Missing prerequisites:
                      <ul className="ml-2 list-disc">
                        {v.missingPrereqs.map((c) => (
                          <li key={c.course_id}>
                            {c.code} ({c.course_id})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Advisories */}
        <section className="mb-4">
          <h3 className="text-lg font-medium text-yellow-700">Advisories</h3>
          {verifyResult.advisory.length === 0 ? (
            <p className="text-green-700">No advisories!</p>
          ) : (
            <ul className="ml-4 list-disc">
              {verifyResult.advisory.map((a, idx) => (
                <li key={idx} className="mb-2">
                  {a.course ? (
                    <>
                      <strong>{a.course.code}</strong>: {a.message}
                      {a.missingPrereqs && (
                        <div className="ml-4">
                          Related courses:
                          <ul className="ml-2 list-disc">
                            {a.missingPrereqs.map((c) => (
                              <li key={c.course_id}>
                                {c.code} ({c.course_id})
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <span>{a.message}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Suggested Order */}
        <section>
          <h3 className="text-lg font-medium text-blue-700">Suggested Order</h3>
          {verifyResult.suggestedOrder.length === 0 ? (
            <p>No suggested order available.</p>
          ) : (
            <ol className="ml-4 list-decimal">
              {verifyResult.suggestedOrder.map((c) => (
                <li key={c.course_id}>
                  {c.code} ({c.course_id})
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Details */}
        <section className="mt-4 text-sm text-gray-600">
          <p>Nodes: {verifyResult.details.nodesCount}</p>
          <p>Edges: {verifyResult.details.edgesCount}</p>
          <p>Cycle detected: {verifyResult.details.topoHasCycle ? "Yes" : "No"}</p>
        </section>
      </div>
    )}
  </div>
</div>

    

    
  </div>
    </>
  )}
      </div>
    );
  }
