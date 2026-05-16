"use client";

import { TopologyNode } from "../lib/mockData";

interface DecommissionPanelProps {
  nodes: TopologyNode[];
}

export default function DecommissionPanel({ nodes }: DecommissionPanelProps) {
  const decommissioned = nodes.filter((n) => n.isDecommissioned);

  if (decommissioned.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-8 text-[var(--muted)]">
        <div className="text-center">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-30" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          <p>No decommissioned devices.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--accent-rose)_28%,var(--line))] bg-[var(--card-bg)]">
      <div className="border-b border-[color-mix(in_oklab,var(--accent-rose)_28%,var(--line))] bg-[color-mix(in_oklab,var(--accent-rose)_8%,white)] p-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[color-mix(in_oklab,var(--accent-rose)_85%,black)]" style={{ fontFamily: "var(--font-playfair-display)" }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="9" x2="15" y1="9" y2="15"/><line x1="15" x2="9" y1="9" y2="15"/></svg>
          Decommissioned Inventory
        </h2>
        <p className="mt-1 text-sm text-[color-mix(in_oklab,var(--accent-rose)_62%,black)]">
          Historical record of hardware removed from active service.
        </p>
      </div>

      <div className="overflow-x-auto p-4">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
            <tr>
              <th className="pb-3 font-medium">Device ID</th>
              <th className="pb-3 font-medium">Name</th>
              <th className="pb-3 font-medium">Type</th>
              <th className="pb-3 font-medium">Model</th>
              <th className="pb-3 font-medium">Serial Number</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {decommissioned.map((node) => (
              <tr key={node.id} className="transition-colors hover:bg-[var(--surface-1)]">
                <td className="py-4 font-semibold text-[var(--muted)]">{node.id}</td>
                <td className="py-4 font-medium text-[var(--foreground)]">{node.name}</td>
                <td className="py-4"><span className="badge-decommissioned">{node.type}</span></td>
                <td className="py-4 text-[var(--foreground)]">{node.model || "Unknown"}</td>
                <td className="py-4 font-semibold text-[var(--muted)]">{node.serialNumber || "Unknown"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
