import { SpeedGraderInfo, User } from "./interfaces";

declare global {
    interface Window {
        ENV: CanvasEnv;
    }
}

export interface CanvasEnv {
    context_asset_string: string;
    DEEP_LINKING_POST_MESSAGE_ORIGIN: string;
    assignment_id: string;
    assignment_title: string;
    speed_grader_url: string;
}
export function getSpeedGraderUrl(user: string = "", assignment: string = ""): string {
    const baseUrl = (window as any).ENV.current_context.url + "/gradebook/speed_grader";
    console.log(baseUrl);
    const parsed = new URL(baseUrl);
    if (user) {
        parsed.searchParams.set("student_id", user);
    }
    if (assignment) {
        parsed.searchParams.set("assignment_id", assignment);
    }
    return parsed.toString();
}

export function getCourse(): string {
    return (window as any).ENV?.context_asset_string ?? "";
}

export function getCourseId(): number {
    const envContextAssetString = getCourse();
    if (envContextAssetString) {
        const match = envContextAssetString.match(/_(\d+)$/);
        if (match) {
            return parseInt(match[1], 10);
        }
    }

    // Fallback: parse from URL like /courses/1905019/assignments/...
    const pathMatch = window.location.pathname.match(/\/courses\/(\d+)/);
    if (pathMatch) {
        return parseInt(pathMatch[1], 10);
    }

    throw new Error("Could not determine Canvas course id (missing ENV.context_asset_string and no /courses/<id> in URL)");
}

export function getBaseUrl(): string {
    return (window as any).ENV?.DEEP_LINKING_POST_MESSAGE_ORIGIN ?? window.location.origin;
}

export function getBaseApiUrl(): string {
    return getBaseUrl() + "/api/v1/";
}

function joinUrl(base: string, path: string): string {
    return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

export function getBaseCourseUrl(): string {
    return getBaseApiUrl() + "courses/" + getCourseId();
}

export function getBaseCourseUrlNoApi(): string {
    return getBaseUrl() + "/courses/" + getCourseId();
}

export function getSpeedGraderInfo(): SpeedGraderInfo {
    return {
        assignmentId: parseInt((window as any).ENV.assignment_id, 10),
        assignmentTitle: (window as any).ENV.assignment_title,
        currentUser: (window as any).ENV.current_user
    };
}

export function getAssignmentPageInfo(): SpeedGraderInfo {
    return {
        assignmentId: parseInt((window as any).ENV.ASSIGNMENT_ID, 10),
        assignmentTitle: (window as any).ENV.assignment_title,
        currentUser: (window as any).ENV.current_user
    };
}

export type ParseSizes = { [key: string]: number };

export function parseSizes(linkHeader: string) {
    let re = /page=(\d+?).*?rel="(.*?)"/gm;
    let matches: ParseSizes = {};
    let match;
    while ((match = re.exec(linkHeader)) !== null) {
        matches[match[2]] = Number.parseInt(match[1]);
    }
    return matches;
}

export function parseLinks(linkHeader: string) {
    let re = /,[\s]*<.*?[\?&]page=([^\&]+).*?>;[\s]*rel="next"/g;
    let result = re.exec(linkHeader);
    if (result == null) {
        return null;
    }
    return result[1];
}

type HandleResult = (...data: any) => any;

export function getAll(verb: HandleResult, url: string, options: object): JQueryPromise<any> {
    return getAllWithoutCourse(verb, joinUrl(getBaseCourseUrl(), url), options as CanvasRequestOptions);
}

// Like getAll(), but for non-course endpoints (ex: /api/v1/courses)
export function getAllApi(verb: HandleResult, url: string, options: CanvasRequestOptions = {}): JQueryPromise<any> {
    return getAllWithoutCourse(verb, joinUrl(getBaseApiUrl(), url), options);
}

export type CanvasRequestOptions = { [key: string]: any };

function chunk<T>(anArray: T[], chunkSize: number): T[][] {
    let result = [];
    for (let i = 0, j = anArray.length; i < j; i += chunkSize) {
        result.push(anArray.slice(i, i + chunkSize));
    }
    return result;
}

function delay(t: number, i: any) {
    return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, t);
    });
}

function jqPromiseToPromise<T>(p: JQueryPromise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        p.done((data: T) => resolve(data));
        p.fail((data: any, status: any, req: any) => reject({ data, status, req }));
    });
}

function serial(callbacks: any[], i: number = 0): Promise<void> {
    if (i < callbacks.length) {
        return callbacks[i]().then(() => serial(callbacks, i + 1));
    } else {
        return new Promise((resolve) => resolve());
    }
}

export async function getAllBatched(verb: HandleResult, url: string, optionsList: CanvasRequestOptions[], perCallback: any): Promise<any> {
    serial(optionsList.map((options: any) => (() => {
        delay(100, options['student_ids[]']);
        return getAll(verb, url, options.options).done((everything) => perCallback(options, everything));
    })));
}

export type CourseAssignment = {
    courseId: number;
    courseName?: string;
    assignment: any;
};

// Gets assignments across ALL your courses (does not require being on a course page)
export async function getAssignmentsAcrossCourses(
    verb: HandleResult,
    assignmentOptions: CanvasRequestOptions = {},
    courseOptions: CanvasRequestOptions = {}
): Promise<CourseAssignment[]> {
    const courses = await jqPromiseToPromise<any[]>(
        getAllApi(verb, "courses", {
            enrollment_state: "active",
            ...courseOptions
        })
    );

    const result: CourseAssignment[] = [];
    for (const course of courses) {
        await delay(150, course?.id);

        const assignments = await jqPromiseToPromise<any[]>(
            getAllWithoutCourse(
                verb,
                joinUrl(getBaseApiUrl(), `courses/${course.id}/assignments`),
                { ...assignmentOptions }
            )
        );

        for (const assignment of assignments) {
            result.push({ courseId: course.id, courseName: course?.name, assignment });
        }
    }

    return result;
}

export function getAllWithoutCourse(verb: HandleResult, url: string, options: CanvasRequestOptions): JQueryPromise<any> {

    options['per_page'] = 100;

    let everything: object[] = [];
    let deferred = $.Deferred();

    function handleOnePage(data: any, status: string, req: any) {
        // Did we fail?
        if (status !== 'success') {
            deferred.reject(data, status, req);
            return;
        }
        // Handle what we have gotten
        everything.push(...data);
        // And move on
        let links = req.getResponseHeader('link');
        let sizes = parseSizes(links);
        // In-progress notify
        deferred.notify(everything, sizes);
        // Start the next batch
        let next = parseLinks(links);
        if (next != null && everything.length < 500) {
            options['page'] = next;
            requestOnePage();
        } else {
            deferred.resolve(everything);
        }
    }

    function requestOnePage() {
        verb(url, options, handleOnePage);
    }

    requestOnePage();

    return deferred.promise();
}

export function makeLastWeek(): string {
    let oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return oneWeekAgo.toISOString();
    // YYYY-MM-DDTHH:MM:SSZ
}
