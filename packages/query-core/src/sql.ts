// The SQL files query-core binds: views.sql (T060) and the profile-generated status map (T022).
// Read once at module load (Node). A browser bundle (A-13) imports the same files as text.
import { readFileSync } from "node:fs";

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");

export const VIEWS_SQL: string = read("../views.sql");
export const STATUS_MAP_SQL: string = read("../generated/travis-austin@1.0.0.status-map.sql");
