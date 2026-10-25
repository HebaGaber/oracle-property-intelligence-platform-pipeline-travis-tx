// A-13 review round, fixer A: pure units (safe URLs, read-only SQL guard bypasses, run numbers,
// the no-roof header). Red before the fixes; each case names the finding it pins.
import { EXPLORE_TEXTS } from "@countylens/shared";
import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "../src/data/safe-url";
import { readOnlyRefusal } from "../src/routes/ExploreSql.engine";

const REFUSED = EXPLORE_TEXTS.sqlReadOnly;

describe("safeHttpUrl (finding 2)", () => {
  it("keeps http and https URLs and drops everything else", () => {
    expect(safeHttpUrl("https://data.austintexas.gov/x")).toBe("https://data.austintexas.gov/x");
    expect(safeHttpUrl("http://example.test/a?b=1")).toBe("http://example.test/a?b=1");
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("  JavaScript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("data:text/html,<script>1</script>")).toBeUndefined();
    expect(safeHttpUrl("vbscript:x")).toBeUndefined();
    expect(safeHttpUrl("//evil.test/x")).toBeUndefined();
    expect(safeHttpUrl("/relative")).toBeUndefined();
    expect(safeHttpUrl("not a url")).toBeUndefined();
    expect(safeHttpUrl("")).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
  });
});

describe("readOnlyRefusal bypasses (finding 3)", () => {
  const refused = [
    "SELECT '--'; DROP TABLE v_property",
    "SELECT '/*'; DROP TABLE v_property; SELECT '*/'",
    "SELECT 1 /* a /* b */ ; DROP TABLE t */",
    "SELECT 1\n;\nDELETE FROM v_property",
    "sElEcT 1; dRoP table x",
    "WITH a AS (SELECT 1) DELETE FROM t",
    "SELECT 1; DROP TABLE t",
    "SELECT 1; DROP TABLE t",
    "SELECT 1;　UPDATE t SET a = 1",
    "SELECT 'abc; DROP TABLE t",
    "SELECT 1 /* never closed; DROP TABLE t",
    "LOAD httpfs",
    "INSTALL httpfs",
    "COPY v_property TO 'x.csv'",
    "ATTACH 'x.db'",
    "SELECT * FROM read_csv('x.csv')",
    "SELECT * FROM READ_PARQUET('x.parquet')",
    "SELECT * FROM read_json_auto('x')",
    "SELECT * FROM parquet_scan('x')",
    "SELECT * FROM glob('*')",
    "SELECT * FROM query('DROP TABLE t')",
    "SELECT * FROM 'x.csv'",
    'SELECT * FROM "x.csv"',
    "SELECT * FROM v_property, 'x.csv'",
    "SELECT * FROM v_property JOIN 'x.parquet' ON true",
    "SELECT 1 $$ ; $$; DROP TABLE t",
    "SELECT E'\\'; DROP TABLE t; --'",
    "",
    "   ",
    "-- only a comment",
  ];
  for (const sql of refused) {
    it(`refuses ${JSON.stringify(sql)}`, () => {
      expect(readOnlyRefusal(sql)).toBe(REFUSED);
    });
  }

  const allowed = [
    "SELECT '--' AS dash",
    "SELECT '''; DROP TABLE t; --' AS q",
    "SELECT 1 /* ; DROP TABLE t */",
    "SELECT $$ ; DROP $$ AS s",
    "SELECT 1; -- trailing\n",
    "SELECT load, set FROM v_property",
    'SELECT "load", "set" FROM "v_property"',
    "SELECT * FROM v_property WHERE name = 'read_csv(' LIMIT 5",
    "select count(*) from v_property",
    "WITH a AS (SELECT 1) SELECT * FROM a",
    "DESCRIBE v_property",
    "SHOW TABLES",
    "SELECT 'delete me' AS x",
  ];
  for (const sql of allowed) {
    it(`allows ${JSON.stringify(sql)}`, () => {
      expect(readOnlyRefusal(sql)).toBeNull();
    });
  }
});

describe("EXPLORE_TEXTS additions (findings 7, 9, 10)", () => {
  it("headerNoRoof is the header without the roof clause", () => {
    expect(EXPLORE_TEXTS.headerNoRoof(12, 5, "Austin")).toBe("12 within 5 mi of Austin");
    expect(EXPLORE_TEXTS.header(12, 5, "Austin", 20)).toBe(
      `${EXPLORE_TEXTS.headerNoRoof(12, 5, "Austin")} · roof ≥ 20 yrs`,
    );
  });
  it("has the fixed out-of-range and not-in-results sentences", () => {
    expect(EXPLORE_TEXTS.filtersOutOfRange).toBe(
      "Those filters are out of range · check radius, roof age and open years",
    );
    expect(EXPLORE_TEXTS.propertyNotInResults).toMatch(/not in these results/);
    expect(EXPLORE_TEXTS.loadMore).toBe("Load more");
  });
});

describe("boundedSql keeps the SQL result small (finding 4)", () => {
  it("wraps SELECT, WITH and FROM in a LIMIT of cap + 1, dropping the trailing ; and comment", async () => {
    const { boundedSql, SQL_RESULT_ROWS } = await import("../src/routes/ExploreSql.engine");
    expect(SQL_RESULT_ROWS).toBe(500);
    expect(boundedSql("SELECT * FROM v_property; -- done\n")).toBe(
      "SELECT * FROM (\nSELECT * FROM v_property\n) AS result LIMIT 501",
    );
    expect(boundedSql("with a as (select 1) select * from a")).toContain("LIMIT 501");
    expect(boundedSql("FROM v_property")).toContain("LIMIT 501");
    // Statements that cannot sit in a subquery run as written (the grid still caps the rows).
    expect(boundedSql("SHOW TABLES")).toBe("SHOW TABLES");
    expect(boundedSql("DESCRIBE v_property")).toBe("DESCRIBE v_property");
  });
});
