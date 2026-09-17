export type Category =
  | "campus"
  | "dorms"
  | "classrooms"
  | "library"
  | "city"
  | "sports"
  | "labs"
  | "student_life";

export const CATEGORY_LABELS: Record<Category, string> = {
  campus: "Кампус",
  dorms: "Общежития",
  classrooms: "Аудитории",
  library: "Библиотеки",
  city: "Город",
  sports: "Спорт",
  labs: "Лаборатории",
  student_life: "Студенческая жизнь",
};

// OR-groups (Commons/Openverse full-text search is effectively AND-of-terms,
// so these stay short — they're a weak recall hint, not a strict filter).
// Final categorization is decided by Gemini from the image content, not by
// which search bucket a candidate came from.
export const CATEGORY_QUERIES: Record<Category, string> = {
  campus: "campus",
  dorms: "dormitory OR residence OR hostel",
  classrooms: "classroom OR lecture OR auditorium",
  library: "library",
  city: "",
  sports: "stadium OR sports OR gym",
  labs: "laboratory OR lab",
  student_life: "students OR graduation OR ceremony",
};

export interface ImageCandidate {
  url: string;
  thumbnailUrl?: string;
  sourcePage: string;
  title: string;
  category: Category;
  width?: number;
  height?: number;
  contextDate?: string;
}

// Wikimedia throttles bulk fetches of full-resolution originals (429 "Too
// many requests") and explicitly asks bulk consumers to use thumbnails
// instead — this is what dedup/verification should actually download.
export function fetchableUrl(candidate: ImageCandidate): string {
  return candidate.thumbnailUrl || candidate.url;
}

export interface VerifiedImage extends ImageCandidate {
  confidence: number;
  verificationNote: string;
}

export interface UniversityProfile {
  query: string;
  resolvedName: string;
  city: string | null;
  country: string | null;
  description: string;
  categories: Partial<Record<Category, VerifiedImage[]>>;
  warnings: string[];
  searchTimeMs: number;
  cached: boolean;
}
