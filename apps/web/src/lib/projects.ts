import {
  type CreateProjectInput,
  type ErrorResponse,
  type ProjectSummary,
  type ProjectsListResponse,
} from "@comstruct/shared";

const API_BASE = "http://localhost:4000/api";

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T | ErrorResponse;

  if (!response.ok) {
    const error = payload as ErrorResponse;
    throw new Error(
      error.details && error.details.length > 0
        ? `${error.error} ${error.details.join(", ")}`
        : error.error
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
