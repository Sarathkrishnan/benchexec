// This file is part of BenchExec, a framework for reliable benchmarking:
// https://github.com/sosy-lab/benchexec
//
// SPDX-FileCopyrightText: 2019-2020 Dirk Beyer <https://www.sosy-lab.org>
//
// SPDX-License-Identifier: Apache-2.0

import React from "react";

const getFilterableData = ({ tools, rows }) => {
  const start = Date.now();
  const mapped = tools.map((tool, idx) => {
    let statusIdx;
    const { tool: toolName, date, niceName } = tool;
    let name = `${toolName} ${date} ${niceName}`;
    const columns = tool.columns.map((col, idx) => {
      if (!col) {
        return undefined;
      }
      if (col.type === "status") {
        statusIdx = idx;
        return { ...col, categories: {}, statuses: {}, idx };
      }
      if (col.type === "text") {
        return { ...col, distincts: {}, idx };
      }
      return { ...col, min: Infinity, max: -Infinity, idx };
    });

    if (isNil(statusIdx)) {
      console.log(`Couldn't find any status columns in tool ${idx}`);
      return undefined;
    }

    columns[statusIdx] = {
      ...columns[statusIdx],
      categories: {},
      statuses: {},
    };

    for (const row of rows) {
      for (const result of row.results) {
        // convention as of writing this commit is to postfix categories with a space character
        columns[statusIdx].categories[`${result.category} `] = true;

        for (const colIdx in result.values) {
          const col = result.values[colIdx];
          const { raw } = col;
          const filterCol = columns[colIdx];
          if (!filterCol) {
            continue;
          }

          if (filterCol.type === "status") {
            filterCol.statuses[raw] = true;
          } else if (filterCol.type === "text") {
            filterCol.distincts[raw] = true;
          } else {
            filterCol.min = Math.min(filterCol.min, Number(raw));
            filterCol.max = Math.max(filterCol.max, Number(raw));
          }
        }
      }
    }

    return {
      name,
      columns: columns.map(({ distincts, categories, statuses, ...col }) => {
        if (distincts) {
          return { ...col, distincts: Object.keys(distincts) };
        }
        if (categories) {
          return {
            ...col,
            categories: Object.keys(categories),
            statuses: Object.keys(statuses),
          };
        }
        return col;
      }),
    };
  });
  console.log({ mapped, creationTime: `${Date.now() - start} ms` });
  return mapped;
};

const prepareTableData = ({ head, tools, rows, stats, props }) => {
  return {
    tableHeader: head,
    tools: tools.map((tool) => ({
      ...tool,
      isVisible: true,
      columns: tool.columns.map((column) => ({ ...column, isVisible: true })),
    })),
    columns: tools.map((tool) => tool.columns.map((column) => column.title)),
    table: rows,
    stats: stats,
    properties: props,
  };
};

const isNumericColumn = (column) =>
  column.type === "count" || column.type === "measure";

const applyNumericFilter = (filter, row, cell) => {
  const raw = getRawOrDefault(row[filter.id]);
  if (raw === undefined) {
    // empty cells never match
    return;
  }
  const filterParams = filter.value.split(":");

  if (filterParams.length === 2) {
    const [start, end] = filterParams;

    const numRaw = Number(raw);
    const numStart = start ? Number(start) : -Infinity;
    const numEnd = end ? Number(end) : Infinity;

    return numRaw >= numStart && numRaw <= numEnd;
  }

  if (filterParams.length === 1) {
    return raw.startsWith(filterParams[0]);
  }
  return false;
};

const applyTextFilter = (filter, row, cell) => {
  const raw = getRawOrDefault(row[filter.id]);
  if (raw === undefined) {
    // empty cells never match
    return;
  }
  return raw.includes(filter.value);
};

const isNil = (data) => data === undefined || data === null;

const getRawOrDefault = (value, def) =>
  isNil(value) || isNil(value.raw) ? def : value.raw;

const numericSortMethod = (a, b) => {
  const aValue = getRawOrDefault(a, +Infinity);
  const bValue = getRawOrDefault(b, +Infinity);
  return aValue - bValue;
};

const textSortMethod = (a, b) => {
  const aValue = getRawOrDefault(a, "").toLowerCase();
  const bValue = getRawOrDefault(b, "").toLowerCase();
  if (aValue === "") {
    return 1;
  }
  if (bValue === "") {
    return -1;
  }
  return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
};

const isOkStatus = (status) => {
  return status === 0 || status === 200;
};

const omit = (keys, data) => {
  const newKeys = Object.keys(data).filter((key) => !keys.includes(key));
  return newKeys.reduce((acc, key) => {
    acc[key] = data[key];
    return acc;
  }, {});
};

const without = (value, array) => {
  const out = [];
  for (const item of array) {
    if (item !== value) {
      out.push(item);
    }
  }
  return out;
};

const buildMatcher = (filters) => {
  const start = Date.now();
  const out = filters.reduce((acc, { id, value }) => {
    if (isNil(value) || (typeof value === "string" && value.trim() === "all")) {
      return acc;
    }
    if (id === "id") {
      acc.id = { value };
      return acc;
    }
    const [tool, , columnIdx] = id.split("_");
    if (value === "diff") {
      if (!acc.diff) {
        acc.diff = [];
      }
      acc.diff.push({ col: columnIdx });
      return acc;
    }
    if (!acc[tool]) {
      acc[tool] = {};
    }
    let filter;
    if (value.includes(":")) {
      let [minV, maxV] = value.split(":");
      minV = minV === "" ? -Infinity : Number(minV);
      maxV = maxV === "" ? Infinity : Number(maxV);
      filter = { min: minV, max: maxV };
    } else {
      if (value[value.length - 1] === " ") {
        filter = { category: value.substr(0, value.length - 1) };
      } else {
        filter = { value };
      }
    }
    if (!acc[tool][columnIdx]) {
      acc[tool][columnIdx] = [];
    }
    acc[tool][columnIdx].push(filter);
    return acc;
  }, {});
  console.log(`Creating matcher took ${Date.now() - start} ms`);
  return out;
};

const applyMatcher = (matcher) => (data) => {
  const start = Date.now();
  let diffd = [...data];
  if (matcher.diff) {
    diffd = diffd.filter((row) => {
      for (const { col } of matcher.diff) {
        const vals = {};
        for (const tool of row.results) {
          const val = tool.values[col].raw;
          if (!vals[val]) {
            vals[val] = true;
          }
        }
        if (Object.keys(vals).length === 1) {
          return false;
        }
      }
      return true;
    });
  }
  if (!isNil(matcher.id)) {
    const { value: idValue } = matcher.id;
    diffd = diffd.filter(
      ({ href }) => href === idValue || href.includes(idValue),
    );
  }
  console.log({ diffd, matcher });
  const out = diffd.filter((row) => {
    for (const tool in omit(["diff", "id"], matcher)) {
      console.log(`matching toool ${tool}`);
      for (const column in matcher[tool]) {
        let columnPass = false;
        for (const filter of matcher[tool][column]) {
          const { value, min, max, category } = filter;

          if (!isNil(min) && !isNil(max)) {
            const rawValue = row.results[tool].values[column].raw;
            const num = Number(rawValue);
            columnPass = columnPass || (num >= min && num <= max);
          } else if (!isNil(category)) {
            columnPass = columnPass || row.results[tool].category === category;
          } else {
            const rawValue = row.results[tool].values[column].raw;
            columnPass =
              columnPass || value === rawValue || value.includes(rawValue);
          }

          if (columnPass) {
            // as multiple values of the same column are OR connected,
            // we can abort if we pass since the result will always be true.
            break;
          }
        }
        if (!columnPass) {
          // values of the same column are OR connected
          // multiple columns in the same row are AND connected
          // if the matcher fails for one column, the whole row fails
          return false;
        }
      }
    }
    // all filter requirements were satisfied
    return true;
  });
  console.log(`matching took ${Date.now() - start} ms`);
  return out;
};
// Best-effort attempt for calculating a meaningful column width
const determineColumnWidth = (column, min_width, max_width) => {
  let width = column.max_width; // number of chars in column
  if (min_width) {
    width = Math.max(width, min_width);
  }
  if (max_width) {
    width = Math.min(width, max_width);
  }
  if (!width) {
    width = 10;
  }

  return width * 8 + 20;
};

const path = (pathArr, data) => {
  let last = data;
  for (const p of pathArr) {
    last = last[p];
    if (isNil(last)) {
      return undefined;
    }
  }
  return last;
};

const pathOr = (pathArr, fallback, data) => {
  const pathRes = path(pathArr, data);

  return pathRes === undefined ? fallback : pathRes;
};

const formatColumnTitle = (column) =>
  column.unit ? (
    <>
      {column.display_title}
      <br />
      {`(${column.unit})`}
    </>
  ) : (
    column.display_title
  );

const getRunSetName = ({ tool, date, niceName }) => {
  return `${tool} ${date} ${niceName}`;
};

// Extended color list copied from
// https://github.com/uber/react-vis/blob/712ea622cf12f17bcc38bd6143fe6d22d530cbce/src/theme.js#L29-L51
// as advised in https://github.com/uber/react-vis/issues/872#issuecomment-404915958
const EXTENDED_DISCRETE_COLOR_RANGE = [
  "#19CDD7",
  "#DDB27C",
  "#88572C",
  "#FF991F",
  "#F15C17",
  "#223F9A",
  "#DA70BF",
  "#125C77",
  "#4DC19C",
  "#776E57",
  "#12939A",
  "#17B8BE",
  "#F6D18A",
  "#B7885E",
  "#FFCB99",
  "#F89570",
  "#829AE3",
  "#E79FD5",
  "#1E96BE",
  "#89DAC1",
  "#B3AD9E",
];

/**
 *
 * @param {String} [str]
 */
const getHashSearch = (str) => {
  const urlParts = (str || document.location.href).split("?");
  const search = urlParts.length > 1 ? urlParts[1] : undefined;
  if (search === undefined || search.length === 0) {
    return {};
  }
  const keyValuePairs = search.split("&").map((i) => i.split("="));

  const out = {};
  for (const [key, value] of keyValuePairs) {
    out[key] = value;
  }
  return out;
};

/**
 *
 * @param {Object} params Object containing the params to be encoded as query params
 * @param {Boolean} [returnString] if true, only returns the url without setting it
 */
const setHashSearch = (
  params = {},
  options = { returnString: false, baseUrl: null },
) => {
  const optionTemplate = { returnString: false, baseUrl: null };
  const { returnString, baseUrl } = { ...optionTemplate, ...options };
  const url = (baseUrl || document.location.href).split("?")[0];
  const pairs = Object.keys(params).map((key) => `${key}=${params[key]}`);
  const searchString = `?${pairs.join("&")}`;
  const hrefString = `${url}${searchString}`;
  if (returnString) {
    return hrefString;
  }
  document.location.href = hrefString;
};

/**
 * Adds or update given key-value pairs to the query params
 *
 * @param {Object} param The Key-Value pair to be added to the current query param list
 */
const setParam = (param) => {
  setHashSearch({ ...getHashSearch(), ...param });
};

const stringAsBoolean = (str) => str === "true";

const deepEquals = (a, b) => {
  for (const key in a) {
    if (typeof a[key] === "function" && typeof b[key] === "function") {
      continue;
    }
    if (typeof a[key] !== typeof b[key]) {
      return false;
    } else if (Array.isArray(a[key]) || typeof a[key] === "object") {
      if (!deepEquals(a[key], b[key])) {
        return false;
      }
    } else {
      if (a[key] !== b[key]) {
        console.log(`${a[key]} !== ${b[key]}`);
        return false;
      }
    }
  }
  return true;
};

export {
  prepareTableData,
  getRawOrDefault,
  isNumericColumn,
  applyNumericFilter,
  applyTextFilter,
  numericSortMethod,
  textSortMethod,
  determineColumnWidth,
  formatColumnTitle,
  getRunSetName,
  isOkStatus,
  isNil,
  EXTENDED_DISCRETE_COLOR_RANGE,
  getHashSearch,
  setHashSearch,
  setParam,
  stringAsBoolean,
  getFilterableData,
  buildMatcher,
  applyMatcher,
  without,
  pathOr,
  path,
  deepEquals,
};
