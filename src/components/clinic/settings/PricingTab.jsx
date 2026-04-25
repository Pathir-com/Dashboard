/**
 * Purpose:
 *   Settings tab for the practice's service catalog. Each row holds the
 *   category, service name, price, optional "from" pricing flag, a
 *   patient-facing description, and internal staff notes.
 *
 *   Category options are sourced from industry_templates.service_categories
 *   for the practice's industry, so a hair-transplant clinic sees
 *   FUE / DHI / PRP categories while a dental practice sees Preventive /
 *   Cosmetic etc — without any code change.
 *
 * Dependencies:
 *   - @/components/ui (Input, Button)
 *   - @/lib/supabase (industry_templates lookup)
 *   - lucide-react icons
 *
 * Used by:
 *   - src/components/clinic/ClinicSettings.jsx (tab id 'pricing')
 *
 * Changes:
 *   2026-04-25: Added Description column (patient-facing). Category
 *               options now load from industry_templates for the
 *               practice's vertical instead of a hardcoded dental list.
 */

import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

const FALLBACK_CATEGORIES = ['Preventive', 'Restorative', 'Cosmetic', 'Orthodontics', 'Oral Surgery', 'Periodontics', 'Endodontics', 'Implants', 'Whitening', 'Other'];

function humanise(slug) {
  return String(slug || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export default function PricingTab({ priceList, setPriceList, practice }) {
  const [newRow, setNewRow] = useState({ category: '', service_name: '', price: '', description: '', notes: '', is_from_price: false });
  const [filter, setFilter] = useState('');
  const [vocab, setVocab] = useState({
    categories: FALLBACK_CATEGORIES,
    treatment_label_plural: 'Services',
  });

  /* ── Pull vertical-specific category list + copy from industry_templates ── */
  useEffect(() => {
    let cancelled = false;
    const industry = practice?.industry || 'dental';
    supabase
      .from('industry_templates')
      .select('service_categories, copy')
      .eq('id', industry)
      .single()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const cats = Array.isArray(data.service_categories) && data.service_categories.length
          ? data.service_categories.map(humanise)
          : FALLBACK_CATEGORIES;
        setVocab({
          categories: cats,
          treatment_label_plural: data.copy?.treatment_label_plural || 'Services',
        });
      });
    return () => { cancelled = true; };
  }, [practice?.industry]);

  const addRow = () => {
    if (!newRow.service_name) return;
    setPriceList(prev => [...prev, { ...newRow, id: generateId(), price: parseFloat(newRow.price) || 0 }]);
    setNewRow({ category: '', service_name: '', price: '', description: '', notes: '', is_from_price: false });
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
        <p className="text-xs text-slate-400">Manage your {vocab.treatment_label_plural.toLowerCase()} and prices. The AI quotes these to the people contacting your clinic. Description is patient-facing; Notes are internal staff hints.</p>
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
          <div className="col-span-2">Category</div>
          <div className="col-span-2">Service</div>
          <div className="col-span-2">Price (£)</div>
          <div className="col-span-1 text-center">From</div>
          <div className="col-span-2">Description</div>
          <div className="col-span-2">Notes</div>
          <div className="col-span-1"></div>
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No {vocab.treatment_label_plural.toLowerCase()} yet — add one below</div>
        ) : (
          filtered.map(row => (
            <div key={row.id} className="grid grid-cols-12 gap-2 px-4 py-2 items-start border-b border-slate-50 last:border-b-0 hover:bg-slate-50/50">
              <div className="col-span-2">
                <Input
                  value={row.category}
                  onChange={e => updateRow(row.id, 'category', e.target.value)}
                  placeholder="Category"
                  className="h-8 text-xs"
                  list="category-options"
                />
              </div>
              <div className="col-span-2">
                <Input value={row.service_name} onChange={e => updateRow(row.id, 'service_name', e.target.value)} placeholder="Service name" className="h-8 text-xs" />
              </div>
              <div className="col-span-2">
                <div className="relative">
                  {row.is_from_price && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">from</span>}
                  <Input
                    value={row.price}
                    onChange={e => updateRow(row.id, 'price', e.target.value)}
                    placeholder="0.00"
                    type="number"
                    className={`h-8 text-xs ${row.is_from_price ? 'pl-10' : ''}`}
                  />
                </div>
              </div>
              <div className="col-span-1 flex justify-center pt-1.5">
                <input
                  type="checkbox"
                  checked={!!row.is_from_price}
                  onChange={e => updateRow(row.id, 'is_from_price', e.target.checked)}
                  className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  title="Pricing starts from this amount"
                />
              </div>
              <div className="col-span-2">
                <textarea
                  value={row.description || ''}
                  onChange={e => updateRow(row.id, 'description', e.target.value)}
                  placeholder="Patient-facing description — what is this and what's involved?"
                  rows={2}
                  className="flex w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                />
              </div>
              <div className="col-span-2">
                <textarea
                  value={row.notes || ''}
                  onChange={e => updateRow(row.id, 'notes', e.target.value)}
                  placeholder="Internal staff notes"
                  rows={2}
                  className="flex w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                />
              </div>
              <div className="col-span-1 flex justify-end pt-1.5">
                <button onClick={() => deleteRow(row.id)} className="p-1 text-slate-300 hover:text-red-500 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}

        {/* Add row */}
        <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-50/50 border-t border-slate-100 items-start">
          <div className="col-span-2">
            <Input
              value={newRow.category}
              onChange={e => setNewRow({ ...newRow, category: e.target.value })}
              placeholder="Category"
              className="h-8 text-xs"
              list="category-options"
            />
          </div>
          <div className="col-span-2">
            <Input value={newRow.service_name} onChange={e => setNewRow({ ...newRow, service_name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') addRow(); }} placeholder="Service name" className="h-8 text-xs" />
          </div>
          <div className="col-span-2">
            <Input value={newRow.price} onChange={e => setNewRow({ ...newRow, price: e.target.value })} placeholder="0.00" type="number" className="h-8 text-xs" />
          </div>
          <div className="col-span-1 flex justify-center pt-1.5">
            <input
              type="checkbox"
              checked={!!newRow.is_from_price}
              onChange={e => setNewRow({ ...newRow, is_from_price: e.target.checked })}
              className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              title="Pricing starts from this amount"
            />
          </div>
          <div className="col-span-2">
            <textarea
              value={newRow.description}
              onChange={e => setNewRow({ ...newRow, description: e.target.value })}
              placeholder="Patient-facing description"
              rows={2}
              className="flex w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
            />
          </div>
          <div className="col-span-2">
            <textarea
              value={newRow.notes}
              onChange={e => setNewRow({ ...newRow, notes: e.target.value })}
              placeholder="Internal notes"
              rows={2}
              className="flex w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
            />
          </div>
          <div className="col-span-1 flex justify-end pt-1.5">
            <Button type="button" size="sm" onClick={addRow} className="h-8 w-8 p-0">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <datalist id="category-options">
        {vocab.categories.map(c => <option key={c} value={c} />)}
      </datalist>

      <p className="text-xs text-slate-400">{priceList.length} {priceList.length === 1 ? vocab.treatment_label_plural.toLowerCase().replace(/s$/, '') : vocab.treatment_label_plural.toLowerCase()} · {categories.length} categories</p>
    </div>
  );
}
