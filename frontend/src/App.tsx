import { useEffect, useState } from "react";
import type { College, PathwayName, Degree, GroupRequirement, StandaloneRequirement, TakenCourse, RemainingGroupRequirement, RemainingStandaloneRequirement} from "@shared/types";
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

  const BASE_URL = import.meta.env.VITE_BACKEND_URL;

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

  return (
    <div className="page-container">
    <div className="page">
    <div className="column">
      <div className="box">
      <h2>PATHWAY SELECTOR</h2>
      {/* College Dropdown */}
      <div className="dropdown">
        <label>
          College: 
          <select
            value={selectedCollege ?? ""}
            onChange={(e) =>{
              setGroupErrors(new Map());
              setTakenGroupRequirements(new Map());
              setTakenStandaloneRequirements([]);
              setAllTakenCourses([]);
              setSelectedCollege(e.target.value ? Number(e.target.value) : null)
            }}
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
            onChange={(e) => {
              setGroupErrors(new Map());
              setTakenGroupRequirements(new Map());
              setTakenStandaloneRequirements([]);
              setAllTakenCourses([]);
              const name = e.target.value || null;
              setSelectedPathway(name);              
            }}
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
            onChange={(e) =>{
              setGroupErrors(new Map());
              setTakenGroupRequirements(new Map());
              setTakenStandaloneRequirements([]);
              setAllTakenCourses([]);
              setSelectedDegree(
                e.target.value ? Number(e.target.value) : null
              )
            }}
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
                      onChange={(e) => {
                        if (e.target.checked) {
                          setTakenStandaloneRequirements((prev) => [...prev, req]);
                          setAllTakenCourses((prev) => [...prev, req]); // add to master array
                        } else {
                          setTakenStandaloneRequirements((prev) =>
                            prev.filter((s) => s.course_id !== req.course_id)
                          );
                          setAllTakenCourses((prev) =>
                            prev.filter((s) => s.course_id !== req.course_id)
                          );
                        }
                      }}
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
                {/* Group description */}
                <div className="group-description">{group.description}</div>

                {/* Textbox for user input */}
                <input
                  type="text"
                  className="textbox"
                  placeholder="Enter course code"
                  value={takenGroupRequirements.get(key) ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();

                    setTakenGroupRequirements((prev) => {
                      const next = new Map(prev);

                      if (!v) {
                        // remove key if input is empty
                        next.delete(key);

                        // remove the corresponding course from allTakenCourses
                        setAllTakenCourses((prevCourses) =>
                          prevCourses.filter((c) => c.associatedKey !== key)
                        );
                      } else {
                        next.set(key, v);
                      }

                      return next;
                    });
                  }}

                  onBlur={async (e) => {
                    const courseCode = e.target.value.trim();

                    // If input is empty, clear error and return
                    if (!courseCode) {
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
                        `${BASE_URL}/api/groups/${group.group_id}/validate-v2?courseCode=${encodeURIComponent(courseCode)}`
                      );

                      const { valid, course } = (await res.json()) as {
                        valid: boolean;
                        course?: { course_id: string; code: string };
                      };

                      setGroupErrors((prev) => {
                        const next = new Map(prev);

                        const isInStandalone = standaloneRequirements.some(
                          (s) => s.code.toUpperCase() === courseCode.toUpperCase()
                        );

                        // Remove previous entry from allTakenCourses if any
                        setAllTakenCourses((prevCourses) =>
                          prevCourses.filter((c) => c.associatedKey !== key)
                        );

                        if (!valid || !course) {
                          next.set(key, `${courseCode} is not valid for this group.`);
                        } else if (isInStandalone) {
                          next.set(key, `${courseCode} is already listed as a standalone requirement.`);
                        } else if (
                          Array.from(takenGroupRequirements.entries()).some(
                            ([k, v]) => v === courseCode && k !== key
                          )
                        ) {
                          next.set(key, `${courseCode} has already been entered in another group.`);
                        } else {
                          // valid input → add to allTakenCourses with associatedKey
                          next.delete(key);
                          setAllTakenCourses((prevCourses) => [
                            ...prevCourses,
                            { ...course, associatedKey: key },
                          ]);
                        }

                        return next;
                      });
                    } catch (err) {
                      setGroupErrors((prev) => {
                        const next = new Map(prev);
                        next.set(key, "Validation failed (network error).");
                        return next;
                      });
                    }
                  }}
                  disabled={locked}
                />

                {/* Validation error */}
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
  onClick={async () => {
    if (!locked) {
      // Compute remaining
      const takenGroupKeys = new Set(takenGroupRequirements.keys());
      const remainingGroups = groupRequirements.filter(
        (gr) => !takenGroupKeys.has(gr.group_instance)
      );
      const remainingStandalones = standaloneRequirements.filter(
        (sr) =>
          !takenStandaloneRequirements.some((t) => t.course_id === sr.course_id)
      );

      // Call backend for availability
      try {
        const payload = {
          collegeId: selectedCollege,
          standaloneCourseIds: remainingStandalones.map((sr) => sr.course_id),
          groupIds: remainingGroups.map((gr) => gr.group_id),
        };

        const response = await fetch("${BASE_URL}/api/requirements-availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) throw new Error("Failed to fetch availability");

        // Typecast backend response inline
        const data = await response.json() as {
          standalone: { course_id: string; availability: string }[];
          groups: { group_id: number; availability: string }[];
        };

        //console.log("Backend response:", data);

        // Merge availability into state
        const updatedStandalone: RemainingStandaloneRequirement[] =
          remainingStandalones.map((sr) => {
            const match = data.standalone.find(
              (s: { course_id: string; availability: string }) =>
                s.course_id === sr.course_id
            );
            return { ...sr, availability: match?.availability ?? "" };
          });

        const updatedGroup: RemainingGroupRequirement[] =
          remainingGroups.map((gr) => {
            const match = data.groups.find(
              (g: { group_id: number; availability: string }) =>
                g.group_id === gr.group_id
            );
            return { ...gr, availability: match?.availability ?? "" };
          });

        setRemainingStandaloneAvailabilities(updatedStandalone);
        setRemainingGrouAvailabilities(updatedGroup);

        //console.log("Standalone availabilities:", updatedStandalone);
        //console.log("Group availabilities:", updatedGroup);
      } catch (err) {
        console.error(err);
      }
    } else {
      // Unlock: clear all
      setRemainingStandaloneAvailabilities([]);
      setRemainingGrouAvailabilities([]);
      setClickedGroupCourses([]);
    }

    setLocked((prev) => !prev);
  }}
  disabled={groupErrors.size !== 0}
>
  {locked ? "UNLOCK" : "LOCK-IN"}
</button>


{/*Debugging*/}
{/*
{allTakenCourses.length > 0 && (
  <div className="box">
    <h2>All Taken Courses (Debug)</h2>
    <ul className="requirements-list">
      {allTakenCourses.map((course) => (
        <li key={course.course_id}>
          {course.code} (ID: {course.course_id})
        </li>
      ))}
      </ul>
  </div>
)}

{takenStandaloneRequirements.length > 0 && (
  <div className="box">
    <h2>Taken Standalone Requirements (Debug)</h2>
    <ul className="requirements-list">
      {takenStandaloneRequirements.map((course) => (
        <li key={course.course_id} className="course-item">
          {course.code} ({course.course_id})
        </li>
      ))}
    </ul>
  </div>
)}


{takenGroupRequirements.size > 0 && (
  <div className="box">
    <h2>Taken Group Requirements (Debug)</h2>
    <ul className="requirements-list">
      {Array.from(takenGroupRequirements.entries()).map(([key, value]) => (
        <li key={key}>
          <strong>{key}</strong>: {value}
        </li>
      ))}
    </ul>
  </div>
)}

{groupErrors.size > 0 && (
  <div className="box">
    <h3>Group Errors (Debug)</h3>
    <ul className="requirements-list">
      {[...groupErrors.entries()].map(([key, error]) => (
        <li key={key}>
          <strong>{key}:</strong> {error}
        </li>
      ))}
    </ul>
  </div>
)}
*/}


  </div>
)}

    </div>
    </div>

  {locked && (
  <>
    {/* Availabilities */}
    <div className="page">
      <div className="column">
        <div className="box">
          <h2>Remaining Requirements with Availability</h2>

          {/* Standalone requirements */}
          {remainingStandaloneAvailabilities.length > 0 && (
            <ul className="requirements-list">
              {remainingStandaloneAvailabilities.map((sr) => (
                <li key={sr.course_id} className="requirement-item">
                  <span className="requirement-text">{sr.code}</span>
                  <span className="term-container">
                    {sr.availability &&
                      sr.availability.split(", ").map((term) => (
                        <span
                          key={term}
                          className={`term-badge ${term.toLowerCase()}`}
                        >
                          {term}
                        </span>
                      ))}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Group requirements */}
          <h3>
            This shows the combined availability of the group. Click on a
            specific quarter for more details
          </h3>
          {remainingGroupAvailabilities.length > 0 && (
            <ul className="requirements-list">
              {remainingGroupAvailabilities.map((gr) => (
                <li key={gr.group_instance} className="requirement-item">
                  <span className="requirement-text">{gr.description}</span>
                  <span className="term-container">
                    {gr.availability &&
                      gr.availability.split(", ").map((term) => (
                        <span
                          key={term}
                          className={`term-badge ${term.toLowerCase()}`}
                          style={{ cursor: "pointer" }}
                          onClick={async () => {
                            try {
                              const res = await fetch(
                                "${BASE_URL}/api/group-term-courses",
                                {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    groupId: gr.group_id,
                                    collegeId: selectedCollege,
                                    term,
                                  }),
                                }
                              );
                              const data = await res.json();
                              setClickedGroupCourses(data);
                              console.log(clickedGroupCourses);
                              setClickedGroupLabel(
                                `${gr.description} — ${term}`
                              );
                            } catch (err) {
                              console.error(err);
                            }
                          }}
                        >
                          {term}
                        </span>
                      ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Clicked group-term courses */}
        {clickedGroupCourses.length > 0 && (
          <div className="box">
            <h3>{`${clickedGroupLabel.split("—").pop()?.trim()} Courses`}</h3>
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
  </>
)}





    </div>
  );
}
