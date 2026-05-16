"use client";
import { useEffect, useState } from "react";
import { defaultFields, FieldDefinition, TopologyType } from "../lib/mockData";

interface FieldManagerProps {
  onClose: () => void;
  backendUrl: string;
  token: string;
}

const CATEGORY_META: Record<string, { label: string; color: string; icon: string }> = {
  Array:  { label: "ArraySystem",   color: "var(--accent-blue)",  icon: "🗄️" },
  Node:   { label: "Node (Ctrl)",   color: "#a78bfa",            icon: "🖥️" },
  Switch: { label: "Switch",        color: "#34d399",            icon: "🔀" },
  Host:   { label: "Host",          color: "#fb923c",            icon: "💻" },
  Port:   { label: "Port",          color: "#38bdf8",            icon: "🔌" },
  Cage:   { label: "Cage",          color: "#f472b6",            icon: "📦" },
  Disk:   { label: "PhysicalDisk",  color: "#facc15",            icon: "💾" },
};

const CATEGORIES: TopologyType[] = ["Array", "Node", "Switch", "Host", "Port", "Cage", "Disk"];

export default function FieldManager({ onClose, backendUrl, token }: FieldManagerProps) {
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [activeCategory, setActiveCategory] = useState<TopologyType>("Array");
  const [isEditing, setIsEditing] = useState(false);
  const [editingField, setEditingField] = useState<Partial<FieldDefinition> | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const loadFields = async () => {
      try {
        const res = await fetch(`${backendUrl}/schema/fields`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error("Failed to load fields");
        const payload = await res.json();
        if (Array.isArray(payload) && payload.length > 0) {
          setFields(payload);
        } else {
          setFields(defaultFields);
          await fetch(`${backendUrl}/schema/fields`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ fields: defaultFields }),
          });
        }
      } catch {
        setFields(defaultFields);
        setMessage("Using local default schema until backend sync succeeds.");
      } finally {
        setIsLoading(false);
      }
    };

    loadFields();
  }, [backendUrl, token]);

  const meta = CATEGORY_META[activeCategory] ?? { label: activeCategory, color: "var(--accent-blue)", icon: "⚙️" };

  const visibleFields = fields
    .filter((f) => f.deviceCategory === activeCategory)
    .filter((f) =>
      search
        ? f.name.toLowerCase().includes(search.toLowerCase()) ||
          f.key.toLowerCase().includes(search.toLowerCase())
        : true
    );

  const handleSaveField = async () => {
    if (!editingField || !editingField.name || !editingField.key) return;
    try {
      const payload = {
        ...editingField,
        deviceCategory: activeCategory,
      } as FieldDefinition;

      if (editingField.id) {
        const res = await fetch(`${backendUrl}/schema/fields/${editingField.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to update field");
        const updated = await res.json();
        setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      } else {
        const newField: FieldDefinition = { ...payload, id: `f${Date.now()}` };
        const res = await fetch(`${backendUrl}/schema/fields`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(newField),
        });
        if (!res.ok) throw new Error("Failed to create field");
        const created = await res.json();
        setFields((prev) => [...prev, created]);
      }
      setIsEditing(false);
      setEditingField(null);
      setMessage("Schema saved.");
    } catch {
      setMessage("Failed to save field.");
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`${backendUrl}/schema/fields/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setFields((prev) => prev.filter((f) => f.id !== id));
    } else {
      setMessage("Failed to delete field.");
    }
  };

  const countFor = (cat: TopologyType) => fields.filter((f) => f.deviceCategory === cat).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content relative flex flex-col"
        style={{ maxWidth: 860, width: "95vw", maxHeight: "92vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2
              className="text-xl font-semibold text-[var(--foreground)]"
              style={{ fontFamily: "var(--font-playfair-display)" }}
            >
              Manage Data Fields Schema
            </h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              FINAL SAN Schema — IP-Synchronized · {fields.length} total fields across {CATEGORIES.length} entity types
            </p>
          </div>
          <button
            className="text-[var(--muted)] hover:text-[var(--foreground)] p-1"
            onClick={onClose}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {CATEGORIES.map((cat) => {
            const m = CATEGORY_META[cat] ?? { label: cat, color: "var(--accent-blue)", icon: "⚙️" };
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => { setActiveCategory(cat); setSearch(""); setIsEditing(false); setEditingField(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: active ? `color-mix(in oklab, ${m.color} 18%, transparent)` : "var(--surface-1)",
                  border: `1px solid ${active ? `color-mix(in oklab, ${m.color} 45%, transparent)` : "var(--line)"}`,
                  color: active ? m.color : "var(--muted)",
                }}
              >
                <span>{m.icon}</span>
                {m.label}
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                  style={{
                    background: active ? `color-mix(in oklab, ${m.color} 25%, transparent)` : "var(--surface-2)",
                    color: active ? m.color : "var(--muted)",
                  }}
                >
                  {countFor(cat)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="mb-3 relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
            xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            className="input-dark w-full pl-8 text-xs"
            placeholder={`Search ${meta.label} fields…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-[var(--line-strong)] bg-[var(--surface-1)] mb-4">
          {isLoading ? (
            <div className="p-6 text-sm text-[var(--muted)]">Loading schema fields...</div>
          ) : (
          <table className="w-full text-sm text-left">
            <thead className="sticky top-0 border-b border-[var(--line)] bg-[var(--surface-2)] text-xs text-[var(--muted)] z-10">
              <tr>
                <th className="px-4 py-3">Display Name</th>
                <th className="px-4 py-3">Property Key</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Flags</th>
                <th className="px-4 py-3 hidden md:table-cell">Description</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleFields.map((field) => (
                <tr key={field.id} className="border-b border-[var(--line)] hover:bg-[var(--surface-2)] transition-colors">
                  <td className="px-4 py-2.5 font-medium text-[var(--foreground)]">{field.name}</td>
                  <td className="px-4 py-2.5">
                    <code className="text-xs font-semibold px-1.5 py-0.5 rounded bg-[color-mix(in_oklab,var(--accent-blue)_10%,transparent)] text-[var(--accent-blue)]">
                      {field.key}
                    </code>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--foreground)]">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      field.dataType === "boolean" ? "bg-purple-500/10 text-purple-400" :
                      field.dataType === "number"  ? "bg-amber-500/10 text-amber-400" :
                                                     "bg-sky-500/10 text-sky-400"
                    }`}>
                      {field.dataType}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {field.isRequired && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 uppercase tracking-wide">
                          req
                        </span>
                      )}
                      {field.isUnique && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 uppercase tracking-wide">
                          unique
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--muted)] hidden md:table-cell max-w-[200px] truncate" title={field.description}>
                    {field.description ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => { setEditingField(field); setIsEditing(true); }}
                      className="mr-3 text-xs font-semibold text-[var(--accent-blue)] hover:opacity-80 transition-opacity"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(field.id)}
                      className="text-xs font-semibold text-[var(--accent-rose)] hover:opacity-80 transition-opacity"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {visibleFields.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--muted)]">
                    {search ? `No fields matching "${search}".` : `No fields defined for ${meta.label}.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          )}
        </div>

        {message && <div className="mb-3 rounded border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-xs text-[var(--muted)]">{message}</div>}

        {/* Add / Edit Form */}
        {!isEditing || !editingField ? (
          <button
            onClick={() => { setEditingField({ dataType: "string", isRequired: false, isUnique: false }); setIsEditing(true); }}
            className="toolbar-btn primary w-full justify-center py-2"
          >
            + Add New Field for {meta.label}
          </button>
        ) : (
          <div className="rounded-lg border border-[var(--line-strong)] bg-[var(--surface-1)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">
              {editingField.id ? "Edit" : "Add"} Field — <span style={{ color: meta.color }}>{meta.label}</span>
            </h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted)]">Display Name</label>
                <input
                  className="input-dark w-full"
                  value={editingField.name || ""}
                  onChange={(e) => setEditingField({ ...editingField, name: e.target.value })}
                  placeholder="e.g. IP Address"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--muted)]">Property Key</label>
                <input
                  className="input-dark w-full"
                  value={editingField.key || ""}
                  onChange={(e) => setEditingField({ ...editingField, key: e.target.value })}
                  placeholder="e.g. ip_address"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--muted)]">Data Type</label>
                <select
                  className="input-dark w-full"
                  value={editingField.dataType}
                  onChange={(e) => setEditingField({ ...editingField, dataType: e.target.value as FieldDefinition["dataType"] })}
                >
                  <option value="string">Text (String)</option>
                  <option value="number">Number</option>
                  <option value="boolean">Boolean</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--muted)]">Description (optional)</label>
                <input
                  className="input-dark w-full"
                  value={editingField.description || ""}
                  onChange={(e) => setEditingField({ ...editingField, description: e.target.value })}
                  placeholder="e.g. Management IP — IP-synchronized"
                />
              </div>
            </div>
            <div className="flex items-center gap-6 mb-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-[var(--foreground)]">
                <input
                  type="checkbox"
                  checked={!!editingField.isRequired}
                  onChange={(e) => setEditingField({ ...editingField, isRequired: e.target.checked })}
                  className="rounded border-[var(--line-strong)] bg-[var(--surface-1)]"
                />
                Required
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-[var(--foreground)]">
                <input
                  type="checkbox"
                  checked={!!editingField.isUnique}
                  onChange={(e) => setEditingField({ ...editingField, isUnique: e.target.checked })}
                  className="rounded border-[var(--line-strong)] bg-[var(--surface-1)]"
                />
                Unique (UNIQUE constraint)
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button className="toolbar-btn" onClick={() => { setIsEditing(false); setEditingField(null); }}>Cancel</button>
              <button className="toolbar-btn primary" onClick={handleSaveField}>Save Field</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
