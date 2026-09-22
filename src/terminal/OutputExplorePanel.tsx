import { useMemo, useRef, useState } from "react";
import { numericColumns, outputOutline, parseOutputTable, type OutputSnapshot } from "./outputExplore";
import "./OutputExplorePanel.css";

export function OutputExplorePanel({ snapshot, onClose }: { snapshot: OutputSnapshot; onClose: () => void }) {
  const table = useMemo(() => parseOutputTable(snapshot), [snapshot]);
  const columns = useMemo(() => table ? numericColumns(table) : [], [table]);
  const outline = useMemo(() => outputOutline(snapshot), [snapshot]);
  const [mode, setMode] = useState<"text" | "table" | "chart">(table ? "table" : "text");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ index: number; descending: boolean } | null>(null);
  const [chartColumn, setChartColumn] = useState(columns[0]?.index ?? 0);
  const [focusedLines, setFocusedLines] = useState<number[]>([]);
  const sourceRef = useRef<HTMLDivElement>(null);
  const filtered = table?.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.cells.some((cell) => cell.toLocaleLowerCase().includes(query.toLocaleLowerCase()))) ?? [];
  if (sort) {
    const values = columns.find((column) => column.index === sort.index)?.values;
    filtered.sort((left, right) => {
      const order = values ? values[left.index] - values[right.index] : left.row.cells[sort.index].localeCompare(right.row.cells[sort.index]);
      return (sort.descending ? -order : order) || left.index - right.index;
    });
  }
  const numeric = columns.find((column) => column.index === chartColumn);
  const maximum = numeric ? Math.max(0, ...filtered.map(({ index }) => numeric.values[index])) : 0;
  const labelColumn = table?.headers.findIndex((_header, index) => index !== chartColumn && !columns.some((column) => column.index === index)) ?? -1;

  function showSource(ids: number[]) {
    setFocusedLines(ids);
    setMode("text");
    requestAnimationFrame(() => {
      const row = sourceRef.current?.querySelector<HTMLElement>(`[data-output-line="${ids[0]}"]`);
      row?.scrollIntoView?.({ block: "nearest" });
      row?.focus({ preventScroll: true });
    });
  }

  return <section className="output-explore" aria-label="Explore captured output" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header className="output-explore-heading">
      <strong>EXPLORE</strong><span>local · frozen snapshot</span>
      <button type="button" onClick={onClose} aria-label="Close output explorer">×</button>
    </header>
    <p>{snapshot.source} · {snapshot.lines.length} captured lines. This may not be the complete command output. Nothing is sent to AI.</p>
    {snapshot.omitted > 0 && <p role="status">{snapshot.omitted} earlier lines excluded by the 240-line / 48 KB limit. Select a smaller complete dataset to enable tables and charts.</p>}
    <div className="output-explore-modes" role="group" aria-label="Output view">
      <button type="button" aria-pressed={mode === "text"} onClick={() => setMode("text")}>Text</button>
      {table && <button type="button" aria-pressed={mode === "table"} onClick={() => setMode("table")}>Table</button>}
      {columns.length > 0 && <button type="button" aria-pressed={mode === "chart"} onClick={() => setMode("chart")}>Chart</button>}
      {table && <span>{table.format} · {filtered.length} of {table.rows.length} rows</span>}
    </div>
    {!table && <p>Text view only: select a complete CSV/TSV header with matching rows, or a JSON array of flat objects (up to 200 rows and 12 columns).</p>}
    {table && columns.length === 0 && <p>Chart unavailable: values must be nonnegative, finite numbers with the same unit in every row.</p>}
    {outline.items.length > 0 && <nav className="output-explore-outline" aria-label="Captured output outline">
      {outline.items.map((line) => <button type="button" key={line.id} onClick={() => showSource([line.id])} title={line.text}>L{line.id} · {line.text}</button>)}
      {outline.omitted > 0 && <span>{outline.omitted} more headings in source</span>}
    </nav>}
    {table && mode !== "text" && <div className="output-explore-controls">
      <input type="search" aria-label="Filter captured rows" placeholder="Filter captured rows…" value={query} onChange={(event) => setQuery(event.target.value)} />
      {mode === "chart" && <select aria-label="Chart value column" value={chartColumn} onChange={(event) => setChartColumn(Number(event.target.value))}>
        {columns.map((column) => <option key={column.index} value={column.index}>{table.headers[column.index]}{column.unit ? ` (${column.unit})` : ""}</option>)}
      </select>}
    </div>}
    {mode === "text" && <div className="output-explore-source" ref={sourceRef} aria-label="Frozen output source">
      {snapshot.lines.map((line) => <div key={line.id} data-output-line={line.id} tabIndex={-1} className={focusedLines.includes(line.id) ? "selected" : ""}><span>L{line.id}</span><code>{line.text}</code></div>)}
      {!snapshot.lines.length && <p>No complete lines fit in this snapshot.</p>}
    </div>}
    {mode === "table" && table && <div className="output-explore-table-wrap"><table>
      <caption>Exact captured values; duplicate rows are kept separately.</caption>
      <thead><tr>{table.headers.map((header, index) => <th scope="col" key={header} aria-sort={sort?.index === index ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" aria-label={`Sort by ${header}`} onClick={() => setSort((current) => ({ index, descending: current?.index === index ? !current.descending : false }))}>{header}{sort?.index === index ? sort.descending ? " ↓" : " ↑" : ""}</button></th>)}<th scope="col">Source</th></tr></thead>
      <tbody>{filtered.map(({ row, index }) => <tr key={index}>{row.cells.map((cell, column) => <td key={column}>{cell}</td>)}<td><button type="button" onClick={() => showSource(row.lineIds)} aria-label={`Show source for row ${index + 1}`}>L{row.lineIds[0]}{row.lineIds.length > 1 ? "…" : ""}</button></td></tr>)}</tbody>
    </table>{!filtered.length && <p>No captured rows match this filter.</p>}</div>}
    {mode === "chart" && table && numeric && <div className="output-explore-chart" role="figure" aria-label={`Bar chart of ${table.headers[chartColumn]}`}>
      <p>Zero-based scale · labels preserve original values · no unit conversion or aggregation.</p>
      {filtered.map(({ row, index }) => <button className="output-explore-bar-row" key={index} type="button" onClick={() => showSource(row.lineIds)} aria-label={`Row ${index + 1}: ${labelColumn >= 0 ? row.cells[labelColumn] : `L${row.lineIds[0]}`}, ${table.headers[chartColumn]} ${row.cells[chartColumn]}. Show source`}>
        <span className="output-explore-bar-label" title={labelColumn >= 0 ? row.cells[labelColumn] : undefined}>{labelColumn >= 0 ? row.cells[labelColumn] : `L${row.lineIds[0]}`}</span>
        <span className="output-explore-bar-track" aria-hidden="true"><span style={{ width: `${maximum ? numeric.values[index] / maximum * 100 : 0}%` }} /></span>
        <span>{row.cells[chartColumn]}</span>
      </button>)}
      {!filtered.length && <p>No captured rows match this filter.</p>}
    </div>}
  </section>;
}
