import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, ChevronDown } from 'lucide-react';

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

const COMMON_CATEGORIES = ['Preventive', 'Restorative', 'Cosmetic', 'Orthodontics', 'Oral Surgery', 'Periodontics', 'Endodontics', 'Implants', 'Whitening', 'Other'];

export default function PricingTab({ priceList, setPriceList }) {
  const [newRow, setNewRow] = useState({ category: '', service_name: '', price: '', notes: '' });
  const [filter, setFilter] = useState('');

  const addRow = () => {
    if (!newRow.service_name) return;
    setPriceList(prev => [...prev, { ...newRow, id: generateId(), price: parseFloat(newRow.price) || 0 }]);
    setNewRow({ category: '', service_name: '', price: '', notes: '' });
  };

  const updateRow = (id, field, value) => {
    setPriceList(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const deleteRow = (id) => {
    setPriceList(prev => prev.filter(r => r.id !== id));
  };

  const categories = [...new Set(priceList.map(r => r.category).filter(Boolean))];
  const filtered = filter ? priceList.filter(r => r.category === filter) : priceList;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Price List</h2>
        <p className="text-xs text-slate-400">Manage your services and prices. This helps the AI quote patients accurately.</p>
      </div>

      {/* Filter by category */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('')}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${!filter ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
          >
            All
          </button>
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setFilter(c === filter ? '' : c)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${filter === c ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500">
          <div className="col-span-3">Category</div>
          <div className="col-span-3">Service</div>
          <div className="col-span-2">Price (£)</div>
          <div className="col-span-3">Notes</div>
          <div className="col-span-1"></div>
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No services yet — add one below</div>
        ) : (
          filtered.map(row => (
            <div key={row.id} className="grid grid-cols-12 gap-2 px-4 py-2 items-center border-b border-slate-50 last:border-b-0 hover:bg-slate-50/50">
              <div className="col-span-3">
                <Input
                  value={row.category}
                  onChange={e => updateRow(row.id, 'category', e.target.value)}
                  placeholder="Category"
                  className="h-8 text-xs"
                  list="category-options"
                />
              </div>
              <div className="col-span-3">
                <Input value={row.service_name} onChange={e => updateRow(row.id, 'service_name', e.target.value)} placeholder="Service name" className="h-8 text-xs" />
              </div>
              <div className="col-span-2">
                <Input value={row.price} onChange={e => updateRow(row.id, 'price', e.target.value)} placeholder="0.00" type="number" className="h-8 text-xs" />
              </div>
              <div className="col-span-3">
                <Input value={row.notes} onChange={e => updateRow(row.id, 'notes', e.target.value)} placeholder="When to offer..." className="h-8 text-xs" />
              </div>
              <div className="col-span-1 flex justify-end">
                <button onClick={() => deleteRow(row.id)} className="p-1 text-slate-300 hover:text-red-500 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}

        {/* Add row */}
        <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-50/50 border-t border-slate-100 items-center">
          <div className="col-span-3">
            <Input
              value={newRow.category}
              onChange={e => setNewRow({ ...newRow, category: e.target.value })}
              placeholder="Category"
              className="h-8 text-xs"
              list="category-options"
            />
          </div>
          <div className="col-span-3">
            <Input value={newRow.service_name} onChange={e => setNewRow({ ...newRow, service_name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') addRow(); }} placeholder="Service name" className="h-8 text-xs" />
          </div>
          <div className="col-span-2">
            <Input value={newRow.price} onChange={e => setNewRow({ ...newRow, price: e.target.value })} placeholder="0.00" type="number" className="h-8 text-xs" />
          </div>
          <div className="col-span-3">
            <Input value={newRow.notes} onChange={e => setNewRow({ ...newRow, notes: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') addRow(); }} placeholder="When to offer..." className="h-8 text-xs" />
          </div>
          <div className="col-span-1">
            <Button type="button" size="sm" onClick={addRow} className="h-8 w-8 p-0">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <datalist id="category-options">
        {COMMON_CATEGORIES.map(c => <option key={c} value={c} />)}
      </datalist>

      <p className="text-xs text-slate-400">{priceList.length} service{priceList.length !== 1 ? 's' : ''} · {[...new Set(priceList.map(r => r.category).filter(Boolean))].length} categories</p>
    </div>
  );
}