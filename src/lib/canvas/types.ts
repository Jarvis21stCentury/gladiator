// Subsets of the Canvas REST API payloads we actually read. Canvas returns far
// more per object; only the fields the sync depends on are modelled here.

export interface CanvasEnrollment {
  type: string;
  role: string;
  enrollment_state: string;
  /** Percent, 0–100. Null before anything is graded. */
  computed_current_score: number | null;
  computed_current_grade: string | null;
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  /** Present only with `include[]=term`. */
  term?: { id: number; name: string | null } | null;
  /** Present only with `include[]=total_scores`. */
  enrollments?: CanvasEnrollment[];
  access_restricted_by_date?: boolean;
}

export interface CanvasSubmission {
  submitted_at: string | null;
  score: number | null;
  workflow_state: string;
  missing?: boolean;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  html_url?: string;
  /** Present only with `include[]=submission`. */
  submission?: CanvasSubmission | null;
}

export interface CanvasModuleItem {
  id: number;
  title: string;
  /** "Page" | "Assignment" | "File" | "ExternalUrl" | "SubHeader" | ... */
  type: string;
  html_url?: string;
  /** Slug for Page items — needed to fetch the body. */
  page_url?: string;
  content_id?: number;
  published?: boolean;
}

export interface CanvasModule {
  id: number;
  name: string;
  published?: boolean;
  /** Present only with `include[]=items`. */
  items?: CanvasModuleItem[];
}

export interface CanvasPage {
  url: string;
  title: string;
  /** HTML. Present on the single-page endpoint, not in list responses. */
  body: string | null;
}

export interface CanvasAnnouncement {
  id: number;
  title: string;
  message: string | null;
  posted_at: string | null;
  html_url: string | null;
  /** e.g. "course_12345" */
  context_code?: string;
}
