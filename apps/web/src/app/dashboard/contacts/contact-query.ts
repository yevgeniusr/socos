export type ContactSortBy =
  | "createdAt"
  | "firstName"
  | "lastContactedAt"
  | "relationshipScore"
  | "nextReminderAt";

export type SortOrder = "asc" | "desc";

export interface ContactQueryOptions {
  search?: string;
  label?: string;
  tag?: string;
  group?: string;
  offset: number;
  limit: number;
  sortBy: ContactSortBy;
  sortOrder: SortOrder;
}

export interface PageWindow {
  start: number;
  end: number;
  page: number;
  pageCount: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function buildContactQuery(options: ContactQueryOptions): string {
  const params = new URLSearchParams();
  params.set(
    "limit",
    String(Math.min(100, Math.max(1, Math.trunc(options.limit))))
  );
  params.set("offset", String(Math.max(0, Math.trunc(options.offset))));

  const filters: Array<[string, string | undefined]> = [
    ["search", options.search],
    ["label", options.label],
    ["tag", options.tag],
    ["group", options.group],
  ];
  for (const [key, value] of filters) {
    const normalized = value?.trim();
    if (normalized) params.set(key, normalized);
  }

  params.set("sortBy", options.sortBy);
  params.set("sortOrder", options.sortOrder);
  return params.toString();
}

export function getPageWindow(input: {
  total: number;
  offset: number;
  limit: number;
}): PageWindow {
  const total = Math.max(0, Math.trunc(input.total));
  const limit = Math.max(1, Math.trunc(input.limit));
  if (total === 0) {
    return {
      start: 0,
      end: 0,
      page: 0,
      pageCount: 0,
      hasPrevious: false,
      hasNext: false,
    };
  }

  const pageCount = Math.ceil(total / limit);
  const lastPageOffset = (pageCount - 1) * limit;
  const requestedOffset = Math.max(0, Math.trunc(input.offset));
  const offset = Math.min(requestedOffset, lastPageOffset);
  const page = Math.floor(offset / limit) + 1;

  return {
    start: offset + 1,
    end: Math.min(offset + limit, total),
    page,
    pageCount,
    hasPrevious: offset > 0,
    hasNext: offset + limit < total,
  };
}
