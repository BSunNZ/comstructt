import {
  type CreateProjectInput,
  type ErrorResponse,
  type ProjectSummary,
  type ProjectsListResponse,
} from "@comstruct/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function readJson<T>(response: Response): Promise<T> {
  const bodyText = await response.text();

  if (!bodyText.trim()) {
    if (response.ok) {
      throw new Error(`Server returned an empty response (${response.status}).`);
    }
    throw new Error(`Server returned ${response.status} with an empty response body.`);
  }

  let payload: T | ErrorResponse;
  try {
    payload = JSON.parse(bodyText) as T | ErrorResponse;
  } catch {
    if (response.ok) {
      throw new Error(`Server returned invalid JSON (${response.status}).`);
    }
    throw new Error(`Server returned ${response.status}: ${bodyText.slice(0, 220)}`);
  }

  if (!response.ok) {
    const error = payload as Partial<ErrorResponse>;
    throw new Error(
      error.details && Array.isArray(error.details) && error.details.length > 0
        ? `${error.error ?? `Request failed (${response.status})`} ${error.details.join(", ")}`
        : (error.error ?? `Request failed (${response.status})`)
    );
  }

  return payload as T;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const response = await fetch(`${API_BASE}/projects`);
  const payload = await readJson<ProjectsListResponse>(response);
  return payload.projects;
}

export async function createProject(input: CreateProjectInput): Promise<ProjectSummary> {
  const response = await fetch(`${API_BASE}/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input satisfies CreateProjectInput),
  });

  return readJson<ProjectSummary>(response);
}
