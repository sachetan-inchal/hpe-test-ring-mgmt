"use client";

import { TopologyGraph } from "../lib/mockData";

interface ExportPanelProps {
  data: TopologyGraph;
  selectedIds?: Set<string>;
}

export default function ExportPanel({ data, selectedIds }: ExportPanelProps) {
  const handleExportCSV = () => {
    // Generate CSV from selected nodes, or all if none selected
    const nodesToExport = selectedIds && selectedIds.size > 0
      ? data.nodes.filter(n => selectedIds.has(n.id))
      : data.nodes;
    const headers = [
      "ID",
      "Name",
      "Type",
      "Category",
      "Status",
      "Parent",
      "Model",
      "Capacity",
      "Firmware",
      "IP/WWN",
      "Decommissioned"
    ];

    const rows = nodesToExport.map((node) => [
      node.id,
      node.name,
      node.type,
      node.category,
      node.status,
      node.parentId ?? "N/A",
      node.model ?? "N/A",
      node.capacity ?? node.totalCapacityTb?.toString() ?? "N/A",
      node.firmware ?? "N/A",
      node.ipAddress ?? node.wwn ?? "N/A",
      node.isDecommissioned ? "Yes" : "No"
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(e => e.map(field => `"${field}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `san_inventory_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end md:gap-3">
      <button
        onClick={handleExportCSV}
        className="toolbar-btn primary min-h-11 w-full justify-center px-4 md:w-auto"
        title="Export Inventory as CSV"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4Z"/><path d="M18 21h-8"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/></svg>
        {selectedIds && selectedIds.size > 0 ? `Export Selected (${selectedIds.size})` : "Export All"}
      </button>

      {/* <button
        onClick={handleExportDiag}
        className="toolbar-btn"
        title="Export Diagram as PNG"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
        Export Diagram
      </button> */}
    </div>
  );
}
