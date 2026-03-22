import dateFormat from "dateformat";
import { stringify } from 'csv-stringify';
import { parse } from 'csv-parse';

import { startDialog } from "~src/canvas/dialog";
import { Assignment, AssignmentDate, AssignmentDateWithName, Course, Submission } from "~src/canvas/interfaces";
import { getAll, getAllWithoutCourse, getBaseApiUrl, getBaseCourseUrl, getCourseId } from "~src/canvas/settings";
import { event } from "jquery";

const BULK_ASSIGNMENTS_MENU_ITEM_HTML = `
<li role="presentation" class="ui-menu-item">
    <a role="menuitem" tabindex="-1" class="ui-corner-all" id="bulk-assignment-dates"
        aria-label="Import/Export Dates">
        <i class="icon-calendar"></i> Import/Export Dates
    </a>
</li>
`;

interface ImportExportAssignmentDateSettings {
    delimiter: string;
    quote: string;
}

function loadSettings(): ImportExportAssignmentDateSettings {
    if (localStorage.getItem("bulk-assignment-dates-settings")) {
        return JSON.parse(localStorage.getItem("bulk-assignment-dates-settings") as string);
    } else {
        return {
            delimiter: ",",
            quote: "\""
        };
    }
}

function saveSettings(settings: ImportExportAssignmentDateSettings) {
    localStorage.setItem("bulk-assignment-dates-settings", JSON.stringify(settings));
}

function saveDraft(courseId: number, assignments: AssignmentDateWithName[]) {
    localStorage.setItem(`bulk-assignment-dates-draft-${courseId}`, JSON.stringify(assignments));
}

function loadDraft(courseId: number): AssignmentDateWithName[] | null {
    const draft = localStorage.getItem(`bulk-assignment-dates-draft-${courseId}`);
    if (draft) {
        return JSON.parse(draft);
    } else {
        return null;
    }
}

// Added by NW
export async function addMarkAssignmentsAsCompleteBtn() {
    const button = document.createElement("button");
    button.className = "mark-assignments-complete-button";
    button.innerHTML = `
        <span>Mark Assignments as Complete</span>
        <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="rgb(68, 68, 68)">
            <path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/>
        </svg>
    `;

    //Undo All button
    const undoButton = document.createElement("button");
    undoButton.className = "mark-assignments-complete-button undo-all-button";
    undoButton.innerHTML = `
        <span>Undo Marked</span>
        <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="rgb(68, 68, 68)"><path d="M280-200v-80h284q63 0 109.5-40T720-420q0-60-46.5-100T564-560H312l104 104-56 56-200-200 200-200 56 56-104 104h252q97 0 166.5 63T800-420q0 94-69.5 157T564-200H280Z"/></svg>
    `;

    // Canvas renders the calendar header async, so wait for it to appear
    const poll = setInterval(() => {
        const headerBar = document.querySelector(".calendar_header .header-bar");
        if (headerBar && !document.querySelector(".mark-assignments-complete-button")) {
            clearInterval(poll);
            // Wrap both buttons in a container for spacing
            const btnContainer = document.createElement('span');
            btnContainer.style.display = 'inline-flex';
            btnContainer.style.gap = '0.5em';
            btnContainer.appendChild(button);
            btnContainer.appendChild(undoButton);
            headerBar.insertBefore(btnContainer, headerBar.children[1] || null);
        }
    }, 200);

    // Toggle active class on click, but do not remove active when clicking elsewhere
    button.addEventListener("click", (e) => {
        e.preventDefault();
        if (!button.classList.contains("active")) {
            button.classList.add("active");
        } else {
            button.classList.remove("active");
        }
    });

    // Undo All button clears all user-marked assignments
    undoButton.addEventListener("click", (e) => {
        e.preventDefault();
        localStorage.removeItem("marked-complete-assignments");
        // Remove user-marked styling from all calendar events immediately
        const eventContainers = Array.from(document.querySelectorAll<HTMLElement>("#calendar-app .fc-event"));
        for (const eventContainer of eventContainers) {
            // Only remove border, not default-complete styling
            eventContainer.style.border = '';
            // If not default-complete, also remove completed styles
            if (eventContainer.style.backgroundColor === "#4141413a" && eventContainer.style.textDecoration === "line-through" && eventContainer.style.opacity === "0.7") {
            } else {
                eventContainer.style.backgroundColor = '';
                eventContainer.style.textDecoration = '';
                eventContainer.style.opacity = '';
            }
        }
        // Re-run markGradedAsComplete to reapply correct styles for default-complete assignments
        void markGradedAsComplete();
    });
}

// Stores assignment completion state in localStorage as an array of "courseId:assignmentId" strings
const CALENDAR_COMPLETION_STORAGE_KEY = "marked-complete-assignments";

// Creates a stable identifier so completion state stays unique per course and assignment
function getCompletionKey(courseId: number, assignmentId: number): string {
    return `${courseId}:${assignmentId}`;
}

// Loads previously marked assignments and falls back to an empty set if stored data is missing or invalid
function loadMarkedCompleteAssignments(): Set<string> {
    const raw = localStorage.getItem(CALENDAR_COMPLETION_STORAGE_KEY);
    if (!raw) {
        return new Set<string>();
    }

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return new Set<string>();
        }
        return new Set<string>(parsed.filter((value): value is string => typeof value === "string"));
    } catch {
        return new Set<string>();
    }
}

// persists the current completion set back to localStorage
function saveMarkedCompleteAssignments(markedAssignments: Set<string>) {
    localStorage.setItem(CALENDAR_COMPLETION_STORAGE_KEY, JSON.stringify(Array.from(markedAssignments)));
}

// applies the visual treatment used for assignments treated as completed on the calendar
function applyCompletedEventStyles(eventContainer: HTMLElement, isUserMarked: boolean = false) {
    eventContainer.style.backgroundColor = "#4141413a";
    eventContainer.style.textDecoration = "line-through";
    eventContainer.style.opacity = "0.7";
    // // Add a border for user-marked complete assignments
    // if (isUserMarked) {
    //     eventContainer.style.border = '2px solid #5d2ecc';
    // } else {
    //     eventContainer.style.border = '';
    // }
    // Set only the text opacity for the event title span
    const titleSpan = eventContainer.querySelector('.fc-title');
    if (titleSpan) {
        (titleSpan as HTMLElement).style.opacity = '0.7';
    }
}

// reads the rendered event title from whichever Calendar DOM field is currently available
function getCalendarEventTitle(eventContainer: HTMLElement): string {
    return (
        eventContainer.getAttribute("title") ||
        eventContainer.querySelector(".fc-title")?.textContent ||
        eventContainer.textContent ||
        ""
    ).trim();
}

// Two column layout
// Left: Actual view of the data, with a button to export to CSV/TSV to right view
//     Also a button to reset the view to the actual live data
// Right: Textarea to paste CSV/TSV data, with a button to import to left view
//     Also a button to download/upload the data as a file
// Top: Settings to control delimiter and quote character
//     Also a button to save the current data to local storage
//     Also a button to permanently PUBLISH the data to the course (overwritting existing data)
// Bottom: Settings to decide whether course, sections, or groups are imported/exported
const BULK_ASSIGNMENTS_DIALOG_HTML = `
<div id="bulk-assignment-dates-status" class="alert alert-info" role="alert">Loading...</div>
<div id="bulk-assignment-dates-dialog" title="Assignment Dates Import/Export">
    <div class="row">
        <div class="col-md-6">
            <h3>Preview Dates</h3>
            <button id="bulk-assignment-dates-export-button" class="btn btn-secondary">Export to CSV/TSV Side &rarr;</button>
        </div>
        <div class="col-md-6">
            <h3>Import Assignment Dates</h3>
            <button id="bulk-assignment-dates-import-button" class="btn btn-secondary">&larr; Import to Preview Side</button>
        </div>
    </div>
    <div class="row" style="margin-top: .5em; margin-bottom: .5em">
        <div class="col-md-6">
            <div id="bulk-assignment-dates-live-view"
                style="width: 100%; padding: 0px; height: 16em; border: 1px solid #ccc; margin-bottom: 1em; overflow: auto; resize: vertical"
            >
                Loading...
            </div>
        </div>
        <div class="col-md-6">
            <textarea id="bulk-assignment-dates-editor-view" 
                style="width: 100%; padding: 0px; resize: vertical; height: 16em; border: 1px solid #ccc; margin-bottom: 1em"
                class="form-control" rows="10"></textarea>
        </div>
    </div>
    <div class="row">
        <div class="col-md-6">
            <div class="form-group">
                <button id="bulk-assignment-dates-reset" class="btn btn-warning">Reset to Current Actual Data</button>
            </div>
        </div>
        <div class="col-md-6">
            <div class="form-group">
                <button id="bulk-assignment-dates-download" class="btn btn-secondary">Download as file</button>
                <button id="bulk-assignment-dates-upload" class="btn btn-secondary">Upload from file</button>
            </div>
            <div id="bulk-assignment-dates-errors" class="alert alert-danger" role="alert" style="display: none"></div>
        </div>
    </div>
    <div class="row">
        <div class="col-md-12">
            <h3>Settings</h3>
            <div class="form-group">
                <label for="bulk-assignment-dates-delimiter">Delimiter</label>
                <input type="text" id="bulk-assignment-dates-delimiter" class="form-control" value=",">
            </div>
            <div class="form-group">
                <label for="bulk-assignment-dates-quote">Quote</label>
                <input type="text" id="bulk-assignment-dates-quote" class="form-control" value="&quot;">
            </div>
            <div class="form-group">
                <button id="bulk-assignment-dates-save" class="btn btn-primary">Save Draft</button>
                <button id="bulk-assignment-dates-load" class="btn btn-primary">Load Draft</button>
            </div>
            <button id="bulk-assignment-dates-publish" class="btn btn-success">Preview and Publish Dates to Course</button>
        </div>
    </div>
    <div class="row" id="bulk-assignment-dates-changes-row" style="display: none">
        <div class="col-md-12">
            <h3>Preview Published Changes</h3>
            <div id="bulk-assignment-dates-changes-status" class="alert alert-info" role="alert" style="display: none">Loading...</div>
            <div id="bulk-assignment-dates-changes"></div>
            <div class="form-group">
                <button id="bulk-assignment-dates-apply" class="btn btn-success">Apply Changes</button>
                <button id="bulk-assignment-dates-cancel" class="btn btn-danger">Cancel Changes</button>
            </div>
        </div>
    </div>

</div>
`;

export function prettyDate(dateString: string | null) {
    if (!dateString) {
        return "";
    }
    let prettyFormat = "ddd, mmm dS, yyyy, h:MM TT";
    const date = new Date(dateString);
    // If year is the same as current year, don't show it
    if (new Date().getFullYear() === date.getFullYear()) {
        prettyFormat = "ddd, mmm dS, h:MM TT";
    }
    return dateFormat(date, prettyFormat);
}

// TODO: Make columns sortable
function populateLiveView(assignments: AssignmentDateWithName[], liveView: HTMLDivElement) {
    liveView.innerHTML = `<table class='table table-bordered table-striped table-hover table-condensed'>
        <thead>
            <tr><th>Name</th>
            <th>Available</th>
            <th>Due</th>
            <th>Until</th>
        </tr>
    </thead><tbody></tbody></table>`;
    // Sort the columns by name
    assignments.sort((a, b) => {
        if (a.name < b.name) {
            return -1;
        } else if (a.name > b.name) {
            return 1;
        } else {
            return 0;
        }
    });
    for (const assignment of assignments) {
        const row = document.createElement("tr");
        row.innerHTML = `<td>${assignment.name}</td>
            <td>${prettyDate(assignment.unlock_at)}</td>
            <td>${prettyDate(assignment.due_at)}</td>
            <td>${prettyDate(assignment.lock_at)}</td>`;
        liveView.querySelector("tbody")?.appendChild(row);
    }
}

async function exportToCSVView(courseId: number, assignments: AssignmentDateWithName[], editorView: HTMLTextAreaElement, settings: ImportExportAssignmentDateSettings): Promise<string> {
    return new Promise<string>((resolve) => {
        const data = assignments.map((assignment) => {
            return [assignment.name, assignment.id, assignment.unlock_at, assignment.due_at, assignment.lock_at];
        });
        data.unshift(["Assignment", "ID", "Available", "Due", "Until"]);
        data.unshift(["Course", courseId.toString(), "", "", ""]);
        const output = stringify(data, {
            delimiter: settings.delimiter,
            quote: settings.quote
        }, (err, output) => {
            if (err) {
                console.error(err);
                alert("Error exporting data to CSV/TSV" + err);
                resolve("");
            }
            editorView.value = output;
            resolve(output);
        });
    });
}

function extractDates(assignments: Assignment[]): AssignmentDateWithName[] {
    return assignments.map((assignment) => {
        return {
            name: assignment.name,
            title: "",
            id: assignment.id,
            unlock_at: assignment.unlock_at,
            due_at: assignment.due_at,
            lock_at: assignment.lock_at
        };
    });
}

export async function getAssignmentInfo(): Promise<Array<{
    isMarkedComplete: boolean;
    submission: Submission | null;
    courseId: number;
    courseName: string;
    assignmentId: number;
    name: string;
    unlock_at: string;
    due_at: string;
    lock_at: string;
}>> {
    // makes sure jquery exists before using it
    const jq = (window as any).$;
    if (!jq?.get) return [];
    const markedAssignments = loadMarkedCompleteAssignments();

    (window as any).getAssignmentInfo = getAssignmentInfo;


    // gets all courses that you are actively enrolled in
    const courses: Course[] = await getAllWithoutCourse(
        jq.get.bind(jq),
        `${getBaseApiUrl()}courses`,
        { enrollment_state: "active" }
    );


    // an array for every assignment in every course
    const allAssignments: Array<{
        isMarkedComplete: boolean;
        submission: Submission | null;
        courseId: number;
        courseName: string;
        assignmentId: number;
        name: string;
        unlock_at: string;
        due_at: string;
        lock_at: string;
    }> = [];


    for (const course of courses) {
        const assignments: Assignment[] = await getAllWithoutCourse(
            jq.get.bind(jq),
            `${getBaseApiUrl()}courses/${course.id}/assignments`,
            { "include[]": ["all_dates", "overrides", "submission"] } // make sure that we account for extensions/changed due dates for individual
        );


        for (const assignment of assignments) {
            allAssignments.push({
                isMarkedComplete: markedAssignments.has(getCompletionKey(course.id, assignment.id)),
                submission: assignment.submission ? assignment.submission as Submission : null,
                courseId: course.id,
                courseName: course.name,
                assignmentId: assignment.id,
                name: assignment.name,
                unlock_at: prettyDate(assignment.unlock_at),
                due_at: prettyDate(assignment.due_at),
                lock_at: prettyDate(assignment.lock_at),
            });
        }
    }
    // console.log("courses:", courses);
    // console.log("allAssignments:", allAssignments);
   
    return allAssignments;
}



export async function markGradedAsComplete() {
    const assignments = await getAssignmentInfo();
    const eventContainers = Array.from(document.querySelectorAll<HTMLElement>("#calendar-app .fc-event"));
    const markedAssignments = loadMarkedCompleteAssignments();

    // Only allow marking as complete if the button is active
    // const markBtn = document.querySelector('.mark-assignments-complete-button');
    // const isActive = markBtn && markBtn.classList.contains('active');

    for (const eventContainer of eventContainers) {
        const eventTitle = getCalendarEventTitle(eventContainer);
        const matchingAssignments = assignments.filter((assignment) => assignment.name === eventTitle);

        if (!matchingAssignments.length) {
            continue;
        }

        // If any assignment is already complete by default, always apply completed style, but do not allow toggling for these
        const isDefaultComplete = matchingAssignments.some((assignment) => assignment.submission?.workflow_state !== "unsubmitted");
        const isUserMarked = !isDefaultComplete && matchingAssignments.some((assignment) => assignment.isMarkedComplete);
        if (isDefaultComplete) {
            applyCompletedEventStyles(eventContainer, false);
        } else if (isUserMarked) {
            applyCompletedEventStyles(eventContainer, true);
        }

        if (eventContainer.dataset.moreCanvasCompleteBound === "true") {
            continue;
        }

        eventContainer.dataset.moreCanvasCompleteBound = "true";
        eventContainer.addEventListener("click", () => {
            // Do not allow toggling for assignments already complete by default
            const isDefaultComplete = matchingAssignments.some((assignment) => assignment.submission?.workflow_state !== "unsubmitted");
            if (isDefaultComplete) return;
            // Toggle user-marked complete state only if the button is active
            const markBtn = document.querySelector('.mark-assignments-complete-button');
            if (!markBtn || !markBtn.classList.contains('active')) return;
            let changed = false;
            for (const assignment of matchingAssignments) {
                const key = getCompletionKey(assignment.courseId, assignment.assignmentId);
                // If already user-marked, unmark it
                if (markedAssignments.has(key)) {
                    markedAssignments.delete(key);
                    assignment.isMarkedComplete = false;
                    changed = true;
                    // Remove completed styles and border
                    eventContainer.style.backgroundColor = '';
                    eventContainer.style.textDecoration = '';
                    eventContainer.style.opacity = '';
                    eventContainer.style.border = '';
                    // Reset event title span opacity
                    const titleSpan = eventContainer.querySelector('.fc-title');
                    if (titleSpan) {
                        (titleSpan as HTMLElement).style.opacity = '';
                    }
                } else {
                    // Only mark as complete if not already visually complete by default (not by user)
                    if (!assignment.isMarkedComplete) {
                        markedAssignments.add(key);
                        assignment.isMarkedComplete = true;
                        applyCompletedEventStyles(eventContainer, true);
                        changed = true;
                    }
                }
            }
            if (changed) {
                saveMarkedCompleteAssignments(markedAssignments);
            }
        });
    }
}


let calendarObserverSetup = false;
let calendarObserverTimer: number | undefined;


export function watchCalendarForGradedAssignments() {
    if (calendarObserverSetup) {
        return;
    }


    const calendar = document.querySelector("#calendar-app");
    if (!calendar) {
        return;
    }


    const rerun = () => {
        window.clearTimeout(calendarObserverTimer);
        calendarObserverTimer = window.setTimeout(() => {
            void markGradedAsComplete();
        }, 150);
    };


    const observer = new MutationObserver(rerun);
    observer.observe(calendar, {
        childList: true,
        subtree: true,
    });


    calendarObserverSetup = true;
    rerun();
}


async function importFromCSVView(courseId: string, editorView: HTMLTextAreaElement, settings: ImportExportAssignmentDateSettings): Promise<AssignmentDateWithName[] | null> {
    return new Promise<AssignmentDateWithName[] | null>((resolve) => {
        const handleError = (message: string) => {
            $("#bulk-assignment-dates-errors").html(
                "Error exporting data to CSV/TSV<br>\n" + message
            ).show();
            console.error(message);
            resolve(null);
        };

        const data = editorView.value;
        parse(data, {
            trim: true,
            skip_empty_lines: true
        }, (err, parsedData) => {
            if (err) {
                handleError(err.message);
            }
            const allRecords: Record<string, AssignmentDateWithName[]> = {};
            let courseIds = [];
            // Stop if no data
            if (parsedData.length === 0) {
                return handleError("No data found in CSV/TSV area");
            }
            // Check if there's a first row with "Course" in the first column
            let useDefaultCourse = true;
            if (parsedData[0].length) {
                // Remove blank columns
                let firstRow = parsedData[0].filter((cell: string) => cell.trim() !== "");
                if (firstRow[0].trim().toLowerCase().startsWith("course")) {
                    useDefaultCourse = false;
                    courseIds = firstRow.slice(1);
                    // Chomp first row
                    parsedData = parsedData.slice(1);
                }
            }
            if (useDefaultCourse) {
                courseIds = [courseId];
            }
            // Chomp header row
            if (parsedData.length) {
                if (parsedData[0].length >= 2) {
                    if (parsedData[0][0].trim().toLowerCase() === "assignment" &&
                        parsedData[0][1].trim().toLowerCase() === "id") {
                        parsedData = parsedData.slice(1);
                    } else {
                        return handleError("First row (after courses) should start with Assignment,ID, but got:" +
                            parsedData[0].join(",")
                        );
                    }
                } else {
                    return handleError("First row (after courses) should have at least Assignment,ID header row, but only got:" +
                            parsedData[0].join(",")
                    );
                }
            } else {
                return handleError("Missing Assignment,ID,Available,Due,Until header row (after courses) - not enough rows found");
            }
            // Convert sets of columns into records
            for (let i = 0; i < parsedData.length; i++) {
                const row = parsedData[i];
                // First columns are assignment and ID
                // Then sets of three columns that correspond to the courseIds
                const assignmentName = row[0];
                const assignmentId = parseInt(row[1], 10);
                if (isNaN(assignmentId)) {
                    return handleError(`Invalid assignment ID on row ${i + 1}: "${row[1]}"`);
                }
                for (let j = 0; j < courseIds.length; j++) {
                    const courseId = courseIds[j].toString();
                    if (!allRecords[courseId]) {
                        allRecords[courseId] = [];
                    }
                    if (row.length < 2 + j * 3) {
                        return handleError(`Not enough columns on row ${i + 1} for course ${courseId}`);
                    }
                    allRecords[courseId].push({
                        name: assignmentName,
                        title: "",
                        id: assignmentId,
                        unlock_at: row[2 + j * 3] || "",
                        due_at: row[3 + j * 3] || "",
                        lock_at: row[4 + j * 3] || ""
                    });
                }
            }
            if (!Object.keys(allRecords).includes(courseId)) {
                return handleError(`No data found for course ${courseId}`);
            }
            // Retrieve only the relevant course
            resolve(allRecords[courseId]);
        });
    });
}

// TODO: Support more than one course in the data file
// TODO: Save changed settings to localStorage and load them on dialog open

export async function loadAssignmentDateEditor() {
    $("#bulk-assignment-dates-status").text("Loading...").show();
    const settings = loadSettings();
    const liveView = document.getElementById("bulk-assignment-dates-live-view") as HTMLDivElement;
    const editorView = document.getElementById("bulk-assignment-dates-editor-view") as HTMLTextAreaElement;

    const courseId = getCourseId();

    // Load the actual data
    let assignments = await getAll($.get, "assignments", { "per_page": 100, "include[]:": ["overrides", "all_dates"] });
    let assignmentDates = extractDates(assignments);
    populateLiveView(assignmentDates, liveView);

    // Export to CSV/TSV button
    let exportedData = await exportToCSVView(courseId, assignmentDates, editorView, settings);
    $("#bulk-assignment-dates-export-button").on("click", async () => {
        exportedData = await exportToCSVView(courseId, assignmentDates, editorView, settings);
    });

    // Import to preview button
    $("#bulk-assignment-dates-import-button").on("click", async () => {
        const possibleNewDates = await importFromCSVView(courseId.toString(), editorView, settings);
        if (possibleNewDates) {
            assignmentDates = possibleNewDates;
            populateLiveView(assignmentDates, liveView);
            $("#bulk-assignment-dates-errors").hide();
        }
    });

    // Download button
    $("#bulk-assignment-dates-download").on("click", () => {
        const blob = new Blob([exportedData], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `assignment_dates_${courseId}.csv`;
        a.click();
    });

    // Upload button
    $("#bulk-assignment-dates-upload").on("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".csv,.tsv,.txt";
        input.onchange = async () => {
            if (input.files && input.files.length > 0) {
                const file = input.files[0];
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const text = e.target?.result as string;
                    editorView.value = text;
                };
                reader.readAsText(file);
            }
        };
        input.click();
    });

    // Change settings
    $("#bulk-assignment-dates-delimiter").val(settings.delimiter).on("change", () => {
        settings.delimiter = $("#bulk-assignment-dates-delimiter").val() as string;
        saveSettings(settings);
    });
    $("#bulk-assignment-dates-quote").val(settings.quote).on("change", () => {
        settings.quote = $("#bulk-assignment-dates-quote").val() as string;
        saveSettings(settings);
    });

    // Save draft button
    $("#bulk-assignment-dates-save").on("click", () => {
        saveDraft(courseId, assignmentDates);
        $("#bulk-assignment-dates-load").prop("disabled", false);
    });

    // Load draft button
    const preloadDraft = loadDraft(courseId);
    if (!preloadDraft) {
        $("#bulk-assignment-dates-load").prop("disabled", true);
    }
    $("#bulk-assignment-dates-load").on("click", async () => {
        const draft = loadDraft(courseId);
        if (draft) {
            assignmentDates = draft;
            populateLiveView(assignmentDates, liveView);
            exportedData = await exportToCSVView(courseId, assignmentDates, editorView, settings);
            $("#bulk-assignment-dates-errors").hide();
        } else {
            alert("No draft found for this course, or saved draft was invalid");
        }
    });

    // Reset button
    $("#bulk-assignment-dates-reset").on("click", async () => {
        assignments = await getAll($.get, "assignments", { "per_page": 100, "include[]:": ["overrides", "all_dates"] });
        populateLiveView(assignments, liveView);
    });

    // Publish button
    $("#bulk-assignment-dates-publish").on("click", async () => {
        startPublishDates(courseId, assignmentDates);
    });
    $("#bulk-assignment-dates-cancel").on("click", () => {
        $("#bulk-assignment-dates-changes").empty();
        $("#bulk-assignment-dates-changes-row").hide();
    });

    $("#bulk-assignment-dates-status").text("Loaded.").hide();
}

const DATE_TYPES: [string, keyof AssignmentDateWithName][] = [
    ["Unlock at", "unlock_at"],
    ["Due at", "due_at"],
    ["Lock at", "lock_at"]
];

interface DateChange {
    id: string;
    name: string;
    error: boolean;
    key?: keyof AssignmentDateWithName;
    old?: string;
    new?: string;
    changes: string;
}

export async function startPublishDates(courseId: number, assignments: AssignmentDateWithName[]) {
    $("#bulk-assignment-dates-changes-row").show();
    // Get the latest assignments
    const latestAssignments: Assignment[] = await getAll($.get, "assignments", { "per_page": 100, "include[]:": ["overrides", "all_dates"] });
    // Iterate through all the assignments and compare the dates
    const assignmentChanges: Record<string, DateChange[]> = {};
    for (const assignment of assignments) {
        if (!assignment || !assignment.id) {
            continue;
        }
        const assignmentId = assignment.id.toString();
        const latestAssignment = latestAssignments.find((a) => a.id === assignment.id);
        if (!latestAssignment) {
            assignmentChanges[assignmentId] = [{
                id: assignmentId,
                name: assignment.name,
                error: true,
                changes: "Assignment not found"
            }];
            continue;
        }
        const latestDates = extractDates([latestAssignment]);
        const latestDate = latestDates[0];
        assignmentChanges[assignmentId] = [];
        let changes = assignmentChanges[assignmentId];
        for (const [dateName, dateType] of DATE_TYPES) {
            if (!latestDate[dateType] && !assignment[dateType]) {
                continue;
            }
            if (latestDate[dateType] !== assignment[dateType]) {
                let oldString = prettyDate(latestDate[dateType] as string);
                let newString = prettyDate(assignment[dateType] as string);
                if (!oldString || oldString.trim() === "") {
                    oldString = "<em>None</em>";
                }
                if (!newString || newString.trim() === "") {
                    newString = "<em>None</em>";
                }
                changes.push({
                    id: assignmentId,
                    name: assignment.name,
                    error: false,
                    key: dateType,
                    old: latestDate[dateType] as string,
                    new: assignment[dateType] as string,
                    changes: `${dateName}: ${oldString} -> ${newString}`
                });
            }
        }
    }
    // Populate the changes
    const changesDiv = document.getElementById("bulk-assignment-dates-changes");
    if (!changesDiv) {
        alert("Error: Could not create changes div");
        return;
    }
    changesDiv.innerHTML = `<table class='table table-bordered table-striped table-hover table-condensed'>
        <thead>
            <tr><th>Assignment</th>
            <th>Changes</th>
        </tr>
    </thead><tbody></tbody></table>`;
    for (const assignmentId of Object.keys(assignmentChanges)) {
        const changes = assignmentChanges[assignmentId];
        if (changes.length === 0) {
            continue;
        }
        const row = document.createElement("tr");
        row.innerHTML = `<td>${changes[0].name}</td>
            <td>${changes.map((change) => change.changes).join("<br>")}</td>`;
        changesDiv.querySelector("tbody")?.appendChild(row);
    }
    // Apply changes button
    $("#bulk-assignment-dates-apply").off("click");
    // TODO: Progress Bar
    $("#bulk-assignment-dates-apply").on("click", async () => {
        $("#bulk-assignment-dates-changes-status").text("Applying changes...").show();
        for (const assignmentId of Object.keys(assignmentChanges)) {
            const changes = assignmentChanges[assignmentId];
            if (changes.length === 0) {
                continue;
            }
            const data: Record<string, any> = {};
            for (const change of changes) {
                if (!change.error && change.key) {
                    data[`assignment[${change.key}]`] = change.new || "";
                }
            }
            const results = await $.ajax({
                url: `${getBaseCourseUrl()}/assignments/${assignmentId}`,
                type: 'put',
                data
            });
            console.log("Results:", results);
        }
        $("#bulk-assignment-dates-changes-status").text("Changes applied!").hide();
        $("#bulk-assignment-dates-changes").empty();
        alert("Changes applied");
    });
}

export async function injectBulkAssignmentDatesButton(moreSettingsDropdown: HTMLElement) {
    if (!moreSettingsDropdown) {
        return;
    }
    $(moreSettingsDropdown).append(BULK_ASSIGNMENTS_MENU_ITEM_HTML);
    $("#bulk-assignment-dates").on("click", async () => {
        startDialog("Assignment Dates Import/Export", BULK_ASSIGNMENTS_DIALOG_HTML);
        await loadAssignmentDateEditor();
    });
}