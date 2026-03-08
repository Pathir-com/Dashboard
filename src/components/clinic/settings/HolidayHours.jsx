import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, CalendarOff } from 'lucide-react';

export default function HolidayHours({ holidayHours, setHolidayHours }) {
  const [newLabel, setNewLabel] = useState('');
  const [newDate, setNewDate] = useState('');

  const addEntry = () => {
    if (!newDate) return;
    const entry = {
      id: Date.now().toString(),
      label: newLabel || 'Holiday',
      date: newDate,
      is_open: false,
      open_time: '09:00',
      close_time: '13:00',
    };
    setHolidayHours(prev => [...prev, entry]);
    setNewLabel('');
    setNewDate('');
  };

  const updateEntry = (id, field, value) => {
    setHolidayHours(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const removeEntry = (id) => {
    setHolidayHours(prev => prev.filter(e => e.id !== id));
  };

  return (
    <section>
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Holiday Hours</h2>
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        {holidayHours.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-slate-400 gap-2">
            <CalendarOff className="w-5 h-5" />
            <p className="text-sm">No holiday hours added yet</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {holidayHours.map(entry => (
              <div key={entry.id} className="flex items-center gap-3 px-5 py-3 flex-wrap">
                <Input
                  value={entry.label}
                  onChange={e => updateEntry(entry.id, 'label', e.target.value)}
                  placeholder="e.g. Christmas Day"
                  className="w-36 text-sm"
                />
                <Input
                  type="date"
                  value={entry.date}
                  onChange={e => updateEntry(entry.id, 'date', e.target.value)}
                  className="w-36 text-sm"
                />
                <Switch
                  checked={entry.is_open}
                  onCheckedChange={val => updateEntry(entry.id, 'is_open', val)}
                />
                {entry.is_open ? (
                  <div className="flex items-center gap-2">
                    <Input type="time" value={entry.open_time} onChange={e => updateEntry(entry.id, 'open_time', e.target.value)} className="w-28 text-sm" />
                    <span className="text-slate-400 text-sm">to</span>
                    <Input type="time" value={entry.close_time} onChange={e => updateEntry(entry.id, 'close_time', e.target.value)} className="w-28 text-sm" />
                  </div>
                ) : (
                  <span className="text-sm text-slate-400">Closed</span>
                )}
                <button onClick={() => removeEntry(entry.id)} className="ml-auto text-slate-300 hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add new row */}
        <div className="flex items-center gap-3 px-5 py-3 border-t border-dashed border-slate-100 bg-slate-50/50 flex-wrap">
          <Input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder="Label (e.g. Bank Holiday)"
            className="w-44 text-sm"
          />
          <Input
            type="date"
            value={newDate}
            onChange={e => setNewDate(e.target.value)}
            className="w-36 text-sm"
          />
          <button
            onClick={addEntry}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-700 border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>
    </section>
  );
}