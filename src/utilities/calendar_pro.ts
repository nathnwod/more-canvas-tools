import { Assignment,Course, Submission } from "~src/canvas/interfaces";
import { getAllWithoutCourse, getBaseApiUrl } from "~src/canvas/settings";
import { isOnCalendar } from "~src/canvas/page_checks";

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

    //canvas renders the calendar header async so wait for it to appear
    const poll = setInterval(() => {
        const headerBar = document.querySelector(".calendar_header .header-bar");
        if (headerBar && !document.querySelector(".mark-assignments-complete-button")) {
            clearInterval(poll);
            // wrap both buttons in a container for spacing
            const btnContainer = document.createElement('span');
            btnContainer.style.display = 'inline-flex';
            btnContainer.style.gap = '0.5em';
            btnContainer.appendChild(button);
            btnContainer.appendChild(undoButton);
            headerBar.insertBefore(btnContainer, headerBar.children[1] || null);
        }
    }, 200);

    // toggle active class on click, but do not remove active when clicking elsewhere
    button.addEventListener("click", (e) => {
        e.preventDefault();
        if (!button.classList.contains("active")) {
            button.classList.add("active");
            document.body.style.cursor = "crosshair";
        } else {
            button.classList.remove("active");
            document.body.style.cursor = "";
        }
    });

    // undo all button clears all user-marked assignments
    undoButton.addEventListener("click", (e) => {
        e.preventDefault();
        localStorage.removeItem("marked-complete-assignments");
        // remove user-marked styling from all calendar events
        const eventContainers = Array.from(document.querySelectorAll<HTMLElement>("#calendar-app .fc-event"));
        for (const eventContainer of eventContainers) {
            // only remove border, not default-complete styling
            eventContainer.style.border = '';
            // if not compelte by default, also remove completed styles
            if (eventContainer.style.backgroundColor === "#4141413a" && eventContainer.style.textDecoration === "line-through" && eventContainer.style.opacity === "0.7") {
            } else {
                eventContainer.style.backgroundColor = '';
                eventContainer.style.textDecoration = '';
                eventContainer.style.opacity = '';
            }
        }
        // re-run markGradedAsComplete to reapply correct styles for default-complete assignments
        void updateCalendarAssignmentStates();
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
    // Remove locked icon and locked styles
    const lockedIcon = eventContainer.querySelector('.locked-icon');
    if (lockedIcon) lockedIcon.remove();
    eventContainer.style.borderColor = '';
    eventContainer.style.border = '';
    eventContainer.style.backgroundColor = '';

    // Apply completed styles
    eventContainer.style.backgroundColor = "#4141413a";
    eventContainer.style.textDecoration = "line-through";
    eventContainer.style.opacity = "0.7";
    eventContainer.style.borderColor = "";
    const titleSpan = eventContainer.querySelector('.fc-title');
    if (titleSpan) {
        (titleSpan as HTMLElement).style.opacity = '0.7';
    }
}

function applyLateEventStyles(eventContainer: HTMLElement) {
    eventContainer.style.backgroundColor = "#ff000052";
    eventContainer.style.borderColor = "#ff0000";
    eventContainer.style.textDecoration = "";
    eventContainer.style.opacity = "1";
   

    const titleSpan = eventContainer.querySelector('.fc-title');
    if (titleSpan) {
        (titleSpan as HTMLElement).style.opacity = '1';
    }
}

function applyLockedEventStyles(eventContainer: HTMLElement) {
    // Remove completed styles
    eventContainer.style.backgroundColor = '';
    eventContainer.style.textDecoration = '';
    eventContainer.style.opacity = '';
    const titleSpan = eventContainer.querySelector('.fc-title');
    if (titleSpan) {
        (titleSpan as HTMLElement).style.opacity = '';
    }
    // Apply locked styles
    eventContainer.style.backgroundColor = "#00000069";
    eventContainer.style.borderColor = "#000000";
    // Add lock icon if not present
    if (!eventContainer.querySelector(".locked-icon")) {
        const icon = document.createElement("span");
        icon.className = "locked-icon";
        icon.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#2c2c2c">
                <path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Z"/>
            </svg>
        `;
        icon.style.marginRight = "6px";
        eventContainer.appendChild(icon);
        // Only add style tag once
        if (!document.head.querySelector('style[data-locked-icon]')) {
            const style = document.createElement("style");
            style.setAttribute('data-locked-icon', 'true');
            style.textContent = `
            .locked-icon {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 10;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            `;
            document.head.appendChild(style);
        }
    }
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
    locked_for_user: boolean;
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
        locked_for_user: boolean;
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
                unlock_at: assignment.unlock_at,
                due_at: assignment.due_at,
                lock_at: assignment.lock_at,
                locked_for_user: assignment.locked_for_user,
            });
        }
    }
    // console.log("courses:", courses);
    // console.log("allAssignments:", allAssignments);
   
    return allAssignments;
}


export async function calendarStyles() {
    const style = document.createElement("style");

    if (isOnCalendar){
        style.innerHTML = `
                body {
                    background-color: #fafafa;
                }
                .header-bar {
                    background-color: #fafafa;
                }
        `;
    }
    document.head.appendChild(style);
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

export async function updateCalendarAssignmentStates() {
    const assignments = await getAssignmentInfo();
    const eventContainers = Array.from(document.querySelectorAll<HTMLElement>("#calendar-app .fc-event"));
    const markedAssignments = loadMarkedCompleteAssignments();

    for (const eventContainer of eventContainers) {
        const eventTitle = getCalendarEventTitle(eventContainer);
        const assignmentId = eventContainer.getAttribute('data-assignment-id');
        let matchingAssignments: typeof assignments;

        if (assignmentId) {
            matchingAssignments = assignments.filter((a) => String(a.assignmentId) === assignmentId);
        } else {
            matchingAssignments = assignments.filter((a) => a.name === eventTitle);
        }
        if (!matchingAssignments.length) {
            continue;
        }

        const isDefaultComplete = matchingAssignments.some(
            (assignment) => assignment.submission?.workflow_state !== "unsubmitted"
        );

        const isUserMarked = !isDefaultComplete && matchingAssignments.some(
            (assignment) => assignment.isMarkedComplete
        );

        const isLate = matchingAssignments.some(
            (assignment) => assignment.due_at && new Date(assignment.due_at) < new Date()
        );

        const isLocked = matchingAssignments.some(
            (assignment) => assignment.locked_for_user
        );

        // Priority: completed > locked > late > normal
        if (isDefaultComplete || isUserMarked) {
            applyCompletedEventStyles(eventContainer);
        } else if (isLocked && !isUserMarked) {
            applyLockedEventStyles(eventContainer);
        } else if (isLate) {
            applyLateEventStyles(eventContainer);
        }

        // if (eventContainer.dataset.moreCanvasCompleteBound === "true") {
        //     continue;
        // }

        // eventContainer.dataset.moreCanvasCompleteBound = "true";

        let lastClickTime = 0;
        eventContainer.addEventListener("click", () => {
            const now = Date.now();
            if (now - lastClickTime < 1000) return; // 1 second cooldown
            lastClickTime = now;

            // Do not allow toggling for assignments already complete by default
            const isDefaultComplete = matchingAssignments.some((assignment) => assignment.submission?.workflow_state !== "unsubmitted");
            if (isDefaultComplete) return;

            // toggle user-marked complete state only if the button is active
            const markBtn = document.querySelector('.mark-assignments-complete-button');
            if (!markBtn || !markBtn.classList.contains('active')) return;
            let changed = false;
            for (const assignment of matchingAssignments) {
                const key = getCompletionKey(assignment.courseId, assignment.assignmentId);
                // if already user-marked, unmark it
                if (markedAssignments.has(key)) {
                    markedAssignments.delete(key);
                    assignment.isMarkedComplete = false;
                    
                changed = true;
                if (isLate) {
                    applyLateEventStyles(eventContainer);
                } else if (isDefaultComplete) {
                    applyCompletedEventStyles(eventContainer);
                } else if (isLocked) {
                    applyLockedEventStyles(eventContainer);
                } else {
                    // Clear all styles
                    eventContainer.style.backgroundColor = '';
                    eventContainer.style.textDecoration = '';
                    eventContainer.style.opacity = '';
                    eventContainer.style.border = '';
                    eventContainer.style.borderColor = '';
                    const titleSpan = eventContainer.querySelector('.fc-title');
                    if (titleSpan) {
                        (titleSpan as HTMLElement).style.opacity = '';
                    }
                }
                    
                } else {
                    // if it's not complete yet, mark it complete and update the calendar event
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
            void updateCalendarAssignmentStates();
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