import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Users, Plus, Search, X, Menu,
  Pencil, Trash2, AlertCircle, Loader2, CheckCircle2, TrendingUp,
  ChevronRight, Calendar, Activity, ArrowLeft, Heart, Thermometer,
  Wind, Droplets, Ruler, Weight, BarChart2, TableProperties, Phone, Mail,
  Syringe, CalendarClock, AlertTriangle, BellRing
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts';

// ── API ───────────────────────────────────────────────────────────────────────
// In production, set REACT_APP_API_BASE to your deployed backend URL,
// e.g. https://your-backend.onrender.com/fhir
const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:3001/fhir';

async function fhirRequest(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/fhir+json', ...options.headers },
  });
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const msg = body?.issue?.[0]?.diagnostics || body?.issue?.[0]?.details?.text || `Server returned ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

const bundleEntries = (b) => b?.entry?.map(e => e.resource) ?? [];

const api = {
  listPatients:    (name = '') => fhirRequest(name ? `/Patient?name=${encodeURIComponent(name)}&_count=100&_sort=-_lastUpdated` : '/Patient?_count=100&_sort=-_lastUpdated'),
  getPatient:      (id)        => fhirRequest(`/Patient/${id}`),
  createPatient:   (r)         => fhirRequest('/Patient', { method: 'POST', body: JSON.stringify(r) }),
  updatePatient:   (id, r)     => fhirRequest(`/Patient/${id}`, { method: 'PUT', body: JSON.stringify(r) }),
  deletePatient:   (id)        => fetch(`${API_BASE}/Patient/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/fhir+json' } })
                                    .then(r => { if (!r.ok && r.status !== 204) throw new Error(`Delete failed: ${r.status}`); }),
  getObservations: (id)        => fhirRequest(`/Observation?subject=Patient/${id}&code=8867-4,8310-5,9279-1,59408-5,8302-2,29463-7,39156-5,55284-4&_count=200`),
  getConditions:   (id)        => fhirRequest(`/Condition?patient=${id}&_count=100`),
  getMedications:  (id)        => fhirRequest(`/MedicationRequest?patient=${id}&_count=100`),
  getImmunizations:(id)        => fhirRequest(`/Immunization?patient=${id}&_count=100`),
  createImmunization: (r)      => fhirRequest('/Immunization', { method: 'POST', body: JSON.stringify(r) }),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const EMPTY_FORM = { given: '', family: '', gender: '', birthDate: '', phone: '', email: '' };

const fullName = (p) => [p.name?.[0]?.given?.join(' '), p.name?.[0]?.family].filter(Boolean).join(' ') || 'Unnamed Patient';
const initials  = (p) => ((p.name?.[0]?.given?.[0]?.[0] ?? '') + (p.name?.[0]?.family?.[0] ?? '')).toUpperCase() || 'P';

const patientToForm = (p) => ({
  given:     p.name?.[0]?.given?.join(' ') ?? '',
  family:    p.name?.[0]?.family ?? '',
  gender:    p.gender ?? '',
  birthDate: p.birthDate ?? '',
  phone:     p.telecom?.find(t => t.system === 'phone')?.value ?? '',
  email:     p.telecom?.find(t => t.system === 'email')?.value ?? '',
});

const formToResource = (data, existing = null) => {
  const r = { resourceType: 'Patient', name: [{ family: data.family.trim(), given: data.given.trim().split(/\s+/) }], gender: data.gender, birthDate: data.birthDate };
  const telecom = [];
  if (data.phone.trim()) telecom.push({ system: 'phone', value: data.phone.trim() });
  if (data.email.trim()) telecom.push({ system: 'email', value: data.email.trim() });
  if (telecom.length) r.telecom = telecom;
  if (existing?.id)   r.id   = existing.id;
  if (existing?.meta) r.meta = existing.meta;
  return r;
};

const PHONE_REGEX = /^\d{10}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validate = (data) => {
  const e = {};
  if (!data.given.trim())  e.given     = 'Given name is required';
  if (!data.family.trim()) e.family    = 'Family name is required';
  if (!data.gender)        e.gender    = 'Please select a gender';
  if (!data.birthDate)     e.birthDate = 'Date of birth is required';
  else if (new Date(data.birthDate) > new Date()) e.birthDate = 'Cannot be in the future';
  if (data.phone.trim() && !PHONE_REGEX.test(data.phone.trim())) e.phone = 'Phone number must be exactly 10 digits';
  if (data.email.trim() && !EMAIL_REGEX.test(data.email.trim())) e.email = 'Enter a valid email address';
  return e;
};

const AVATAR_COLORS = ['bg-blue-100 text-blue-700','bg-teal-100 text-teal-700','bg-violet-100 text-violet-700','bg-amber-100 text-amber-700','bg-rose-100 text-rose-700','bg-cyan-100 text-cyan-700'];
const avatarColor = (id = '') => AVATAR_COLORS[id.charCodeAt(0) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
const GENDER_BADGE = { male: 'bg-blue-100 text-blue-700', female: 'bg-pink-100 text-pink-700', other: 'bg-purple-100 text-purple-700', unknown: 'bg-slate-100 text-slate-500' };

// ── FHIR Observation helpers ──────────────────────────────────────────────────
// Extract value + unit from an Observation resource
function obsValue(obs) {
  if (obs.valueQuantity) return { value: obs.valueQuantity.value, unit: obs.valueQuantity.unit ?? '' };
  // Blood pressure: component
  if (obs.component) {
    const sys = obs.component.find(c => c.code?.coding?.some(x => x.code === '8480-6'));
    const dia = obs.component.find(c => c.code?.coding?.some(x => x.code === '8462-4'));
    if (sys || dia) return {
      systolic:  sys?.valueQuantity?.value,
      diastolic: dia?.valueQuantity?.value,
      unit: sys?.valueQuantity?.unit ?? 'mmHg',
      isBP: true,
    };
  }
  return null;
}

function obsDate(obs) {
  const d = obs.effectiveDateTime ?? obs.issued ?? '';
  return d ? d.slice(0, 10) : '';
}

function obsCode(obs) {
  return obs.code?.coding?.[0]?.code ?? '';
}

// Group observations by LOINC code
function groupObs(observations) {
  const groups = {};
  for (const obs of observations) {
    const code = obsCode(obs);
    if (!groups[code]) groups[code] = [];
    const val = obsValue(obs);
    if (val) groups[code].push({ date: obsDate(obs), ...val, _obs: obs });
  }
  // Sort each group by date asc
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => a.date.localeCompare(b.date));
  }
  return groups;
}

// Vital config
const VITALS = [
  { code: '8867-4',  label: 'Heart Rate',        unit: 'bpm',  color: '#ef4444', icon: Heart      },
  { code: '8310-5',  label: 'Temperature',        unit: '°C',   color: '#f97316', icon: Thermometer },
  { code: '9279-1',  label: 'Respiratory Rate',   unit: '/min', color: '#8b5cf6', icon: Wind        },
  { code: '59408-5', label: 'Oxygen Saturation',  unit: '%',    color: '#06b6d4', icon: Droplets    },
  { code: '8302-2',  label: 'Height',             unit: 'cm',   color: '#10b981', icon: Ruler       },
  { code: '29463-7', label: 'Weight',             unit: 'kg',   color: '#3b82f6', icon: Weight      },
  { code: '39156-5', label: 'BMI',                unit: 'kg/m²',color: '#6366f1', icon: BarChart2   },
  { code: '55284-4', label: 'Blood Pressure',     unit: 'mmHg', color: '#ec4899', icon: Activity, isBP: true },
];

// ── Immunization Schedule (WHO/CDC pediatric schedule) ────────────────────────
// recommendedAgeMonths: age (in months) at which the dose is recommended.
const VACCINE_SCHEDULE = [
  { id: 'bcg',        name: 'BCG',                recommendedAgeMonths: 0,    description: 'At birth' },
  { id: 'hepb1',      name: 'Hepatitis B (Birth)',recommendedAgeMonths: 0,    description: 'At birth' },
  { id: 'opv0',       name: 'Polio (OPV-0)',      recommendedAgeMonths: 0,    description: 'At birth' },
  { id: 'dpt1',       name: 'DPT-1',              recommendedAgeMonths: 1.5,  description: '6 weeks' },
  { id: 'opv1',       name: 'Polio (OPV-1)',      recommendedAgeMonths: 1.5,  description: '6 weeks' },
  { id: 'rota1',      name: 'Rotavirus (Dose 1)', recommendedAgeMonths: 1.5,  description: '6 weeks' },
  { id: 'pcv1',       name: 'Pneumococcal (Dose 1)', recommendedAgeMonths: 1.5, description: '6 weeks' },
  { id: 'dpt2',       name: 'DPT-2',              recommendedAgeMonths: 2.5,  description: '10 weeks' },
  { id: 'opv2',       name: 'Polio (OPV-2)',      recommendedAgeMonths: 2.5,  description: '10 weeks' },
  { id: 'rota2',      name: 'Rotavirus (Dose 2)', recommendedAgeMonths: 2.5,  description: '10 weeks' },
  { id: 'pcv2',       name: 'Pneumococcal (Dose 2)', recommendedAgeMonths: 2.5, description: '10 weeks' },
  { id: 'dpt3',       name: 'DPT-3',              recommendedAgeMonths: 3.5,  description: '14 weeks' },
  { id: 'opv3',       name: 'Polio (OPV-3)',      recommendedAgeMonths: 3.5,  description: '14 weeks' },
  { id: 'rota3',      name: 'Rotavirus (Dose 3)', recommendedAgeMonths: 3.5,  description: '14 weeks' },
  { id: 'pcv3',       name: 'Pneumococcal (Dose 3)', recommendedAgeMonths: 3.5, description: '14 weeks' },
  { id: 'mmr1',       name: 'MMR (Dose 1)',       recommendedAgeMonths: 9,    description: '9 months' },
  { id: 'hepb-boost', name: 'Hepatitis B Booster',recommendedAgeMonths: 12,   description: '12 months' },
  { id: 'varicella1', name: 'Varicella (Dose 1)', recommendedAgeMonths: 12,   description: '12 months' },
  { id: 'mmr2',       name: 'MMR (Dose 2)',       recommendedAgeMonths: 15,   description: '15 months' },
  { id: 'pcv-boost',  name: 'Pneumococcal Booster', recommendedAgeMonths: 15, description: '15 months' },
  { id: 'dpt-boost1', name: 'DPT Booster 1',      recommendedAgeMonths: 18,   description: '18 months' },
  { id: 'varicella2', name: 'Varicella (Dose 2)', recommendedAgeMonths: 48,   description: '4 years' },
  { id: 'dpt-boost2', name: 'DPT Booster 2',      recommendedAgeMonths: 60,   description: '5 years' },
];

// Calculate age in months from birth date
function ageInMonths(birthDate) {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const now   = new Date();
  return (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
       + (now.getDate() < birth.getDate() ? -1 : 0);
}

// Human-readable age (e.g. "2 years, 3 months" or "5 months")
function formatAge(birthDate) {
  const months = ageInMonths(birthDate);
  if (months === null) return '—';
  const years = Math.floor(months / 12);
  const rem   = months % 12;
  if (years === 0) return `${months} month${months !== 1 ? 's' : ''}`;
  if (rem === 0)   return `${years} year${years !== 1 ? 's' : ''}`;
  return `${years} year${years !== 1 ? 's' : ''}, ${rem} month${rem !== 1 ? 's' : ''}`;
}

// Add months to a date, returns Date
function addMonths(date, months) {
  const d = new Date(date);
  const wholeMonths = Math.floor(months);
  const fracDays    = (months - wholeMonths) * 30; // approx for half-months (e.g. 6 weeks)
  d.setMonth(d.getMonth() + wholeMonths);
  d.setDate(d.getDate() + Math.round(fracDays));
  return d;
}

const fmtDate = (d) => d.toISOString().slice(0, 10);

// Determine status for a single vaccine given immunization records + birthdate
function vaccineStatus(vaccine, immunizations, birthDate) {
  const given = immunizations.find(im =>
    (im.vaccineCode?.text ?? im.vaccineCode?.coding?.[0]?.display ?? '').toLowerCase() === vaccine.name.toLowerCase()
    || im._vaccineId === vaccine.id
  );

  if (given) {
    const dateGiven = (given.occurrenceDateTime ?? given.recorded ?? '').slice(0, 10);
    return { status: 'completed', dateGiven, vaccine };
  }

  if (!birthDate) return { status: 'upcoming', vaccine, dueDate: null };

  const dueDate = addMonths(birthDate, vaccine.recommendedAgeMonths);
  const today = new Date();
  const diffDays = Math.round((dueDate - today) / (1000 * 60 * 60 * 24));

  if (diffDays < -30) return { status: 'overdue', vaccine, dueDate, daysOverdue: Math.abs(diffDays) };
  if (diffDays <= 30) return { status: 'due', vaccine, dueDate, daysUntil: diffDays };
  return { status: 'upcoming', vaccine, dueDate, daysUntil: diffDays };
}

const STATUS_CONFIG = {
  completed: { label: 'Completed', color: '#4CAF50', bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  badge: 'bg-green-100 text-green-700',  icon: CheckCircle2 },
  due:       { label: 'Due',       color: '#2196F3', bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   badge: 'bg-blue-100 text-blue-700',   icon: CalendarClock },
  overdue:   { label: 'Overdue',   color: '#FF9800', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-700', icon: AlertTriangle },
  upcoming:  { label: 'Upcoming',  color: '#9E9E9E', bg: 'bg-slate-50',  border: 'border-slate-200',  text: 'text-slate-500',  badge: 'bg-slate-100 text-slate-500', icon: BellRing },
};


function useRouter() {
  const [path, setPath] = useState(window.location.pathname);
  const navigate = useCallback((to) => { window.history.pushState({}, '', to); setPath(to); }, []);
  useEffect(() => {
    const handler = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);
  return { path, navigate };
}

// ── Donut Chart ───────────────────────────────────────────────────────────────
function DonutChart({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div className="flex items-center justify-center h-48 text-slate-400 text-sm">No data</div>;
  const radius = 70, cx = 90, cy = 90, stroke = 28, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = data.map(d => { const dash = (d.value/total)*circumference; const seg = { ...d, dash, gap: circumference-dash, offset }; offset += dash; return seg; });
  return (
    <div className="flex items-center gap-6">
      <svg width="180" height="180" className="shrink-0">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={stroke}/>
        {segments.map(s => <circle key={s.label} cx={cx} cy={cy} r={radius} fill="none" stroke={s.color} strokeWidth={stroke} strokeDasharray={`${s.dash} ${s.gap}`} strokeDashoffset={-s.offset + circumference*0.25}/>)}
        <text x={cx} y={cy-6} textAnchor="middle" fill="#0f172a" fontSize="22" fontWeight="700">{total}</text>
        <text x={cx} y={cy+14} textAnchor="middle" fill="#94a3b8" fontSize="11">patients</text>
      </svg>
      <div className="space-y-2">
        {data.map(d => <div key={d.label} className="flex items-center gap-2 text-sm"><span className="w-3 h-3 rounded-full shrink-0" style={{backgroundColor:d.color}}/><span className="text-slate-600 capitalize">{d.label}</span><span className="font-semibold text-slate-900 ml-auto pl-4">{d.value}</span></div>)}
      </div>
    </div>
  );
}

// ── Vital Chart ───────────────────────────────────────────────────────────────
function VitalChart({ vital, data }) {
  if (!data || data.length === 0) return <div className="text-slate-400 text-sm text-center py-6">No data available</div>;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#cbd5e1"/>
        <YAxis tick={{ fontSize: 11 }} stroke="#cbd5e1"/>
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}/>
        {vital.isBP ? (
          <>
            <Legend/>
            <Line type="monotone" dataKey="systolic"  name="Systolic"  stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} connectNulls/>
            <Line type="monotone" dataKey="diastolic" name="Diastolic" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} connectNulls/>
          </>
        ) : (
          <Line type="monotone" dataKey="value" name={vital.label} stroke={vital.color} strokeWidth={2} dot={{ r: 3 }} connectNulls/>
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Vital Table ───────────────────────────────────────────────────────────────
function VitalTable({ vital, data }) {
  if (!data || data.length === 0) return <div className="text-slate-400 text-sm text-center py-6">No data available</div>;
  return (
    <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead><tr className="border-b border-slate-200 bg-slate-50 text-slate-500 text-xs uppercase">
        <th className="text-left px-4 py-2">Date</th>
        {vital.isBP ? <><th className="text-left px-4 py-2">Systolic</th><th className="text-left px-4 py-2">Diastolic</th></> : <th className="text-left px-4 py-2">Value</th>}
        <th className="text-left px-4 py-2">Unit</th>
      </tr></thead>
      <tbody className="divide-y divide-slate-100">
        {[...data].reverse().map((row, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="px-4 py-2 text-slate-600">{row.date}</td>
            {vital.isBP ? <><td className="px-4 py-2 font-medium">{row.systolic ?? '—'}</td><td className="px-4 py-2 font-medium">{row.diastolic ?? '—'}</td></> : <td className="px-4 py-2 font-medium">{row.value}</td>}
            <td className="px-4 py-2 text-slate-400">{row.unit}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

// ── VitalCard ────────────────────────────────────────────────────────────────
function VitalCard({ vital, data, viewMode }) {
  const Icon = vital.icon;
  const latest = data?.[data.length - 1];
  const latestVal = latest
    ? vital.isBP
      ? `${latest.systolic ?? '?'}/${latest.diastolic ?? '?'}`
      : latest.value
    : null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={16} style={{ color: vital.color }}/>
          <span className="font-semibold text-slate-800 text-sm">{vital.label}</span>
        </div>
        {latestVal && (
          <div className="text-right">
            <span className="text-lg font-bold" style={{ color: vital.color }}>{latestVal}</span>
            <span className="text-xs text-slate-400 ml-1">{vital.unit}</span>
          </div>
        )}
      </div>
      <div className="p-4">
        {viewMode === 'chart'
          ? <VitalChart vital={vital} data={data ?? []}/>
          : <VitalTable vital={vital} data={data ?? []}/>}
      </div>
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────
function DeleteConfirm({ patient, onConfirm, onCancel, deleting }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 size={22} className="text-red-600"/></div>
        <h2 className="text-xl font-bold text-center mb-2">Delete Patient</h2>
        <p className="text-slate-500 text-center text-sm mb-6">Are you sure you want to delete <span className="font-semibold text-slate-800">{fullName(patient)}</span>? This cannot be undone.</p>
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={deleting} className="flex-1 py-2.5 border border-slate-200 rounded-lg font-medium text-slate-600 hover:bg-slate-50 transition text-sm">Cancel</button>
          <button onClick={onConfirm} disabled={deleting} className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg font-bold transition text-sm flex items-center justify-center gap-2">
            {deleting && <Loader2 size={14} className="animate-spin"/>}{deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PatientForm({ initial, onSave, onClose }) {
  const [form, setForm]     = useState(initial ? patientToForm(initial) : EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast]   = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({}); setSaving(true);
    try {
      const resource = formToResource(form, initial);
      initial?.id ? await api.updatePatient(initial.id, resource) : await api.createPatient(resource);
      setToast(initial?.id ? 'Patient updated!' : 'Patient created!');
      setTimeout(() => onSave(), 800);
    } catch (err) { setErrors({ submit: err.message }); setSaving(false); }
  };
  const cls = (f) => `w-full p-3 border rounded-lg text-sm focus:outline-none focus:ring-2 transition ${errors[f] ? 'border-red-400 focus:ring-red-300' : 'border-slate-200 focus:ring-blue-400/30'}`;
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 relative">
        {toast && <div className="absolute inset-x-8 top-4 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 flex items-center gap-2 text-sm font-medium z-10"><CheckCircle2 size={16}/>{toast}</div>}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">{initial ? 'Edit Patient' : 'New Patient'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={22}/></button>
        </div>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {[['given','Given Name','e.g. Jane'],['family','Family Name','e.g. Doe']].map(([k,label,ph]) => (
            <div key={k}>
              <label className="block text-sm font-medium text-slate-700 mb-1">{label} *</label>
              <input className={cls(k)} placeholder={ph} value={form[k]} onChange={set(k)}/>
              {errors[k] && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle size={11}/>{errors[k]}</p>}
            </div>
          ))}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Gender *</label>
            <select className={cls('gender')} value={form.gender} onChange={set('gender')}>
              <option value="">Select gender…</option>
              <option value="male">Male</option><option value="female">Female</option>
              <option value="other">Other</option><option value="unknown">Unknown</option>
            </select>
            {errors.gender && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle size={11}/>{errors.gender}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date of Birth *</label>
            <input type="date" className={cls('birthDate')} value={form.birthDate} max={new Date().toISOString().split('T')[0]} onChange={set('birthDate')}/>
            {errors.birthDate && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle size={11}/>{errors.birthDate}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
            <input
              type="tel"
              inputMode="numeric"
              className={cls('phone')}
              placeholder="e.g. 9876543210"
              value={form.phone}
              maxLength={10}
              onChange={(e) => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
            />
            {errors.phone && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle size={11}/>{errors.phone}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              className={cls('email')}
              placeholder="e.g. jane.doe@email.com"
              value={form.email}
              onChange={set('email')}
            />
            {errors.email && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle size={11}/>{errors.email}</p>}
          </div>
          {errors.submit && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex gap-2"><AlertCircle size={15} className="shrink-0 mt-0.5"/>{errors.submit}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 border border-slate-200 rounded-lg font-medium text-slate-600 hover:bg-slate-50 transition">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg font-bold transition flex items-center justify-center gap-2">
              {saving && <Loader2 size={15} className="animate-spin"/>}{saving ? 'Saving…' : (initial ? 'Update Patient' : 'Save Patient')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ activePage, navigate, open, onClose }) {
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { id: 'patients',  label: 'Patients',  icon: Users,           path: '/patients' },
  ];
  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div className="fixed inset-0 bg-slate-900/40 z-30 md:hidden" onClick={onClose}/>
      )}

      <aside className={`w-60 min-h-screen bg-white border-r border-slate-200 flex flex-col fixed left-0 top-0 bottom-0 z-40
        transform transition-transform duration-200 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <div className="p-5 flex items-center justify-between gap-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-1.5 rounded-lg text-white"><Activity size={18}/></div>
            <span className="font-bold text-slate-800 text-base">Pediatrics Practice</span>
          </div>
          {/* Close button — mobile only */}
          <button onClick={onClose} className="md:hidden text-slate-400 hover:text-slate-600 p-1">
            <X size={20}/>
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {items.map(({ id, label, icon: Icon, path }) => (
            <button key={id} onClick={() => { navigate(path); onClose(); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${activePage === id ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>
              <Icon size={18} className={activePage === id ? 'text-blue-600' : 'text-slate-400'}/>{label}
            </button>
          ))}
        </nav>
      </aside>
    </>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
const VACCINE_STATUS_COLORS = {
  Completed: '#4CAF50',
  Due:       '#2196F3',
  Overdue:   '#FF9800',
  Upcoming:  '#9E9E9E',
};

function DashboardPage({ patients, loading, onAddPatient, navigate }) {
  const [immLoading, setImmLoading] = useState(false);
  const [doseCounts, setDoseCounts] = useState(null);    // { Completed, Due, Overdue, Upcoming }
  const [childCounts, setChildCounts] = useState(null);  // { Completed, Due, Overdue, Upcoming }

  useEffect(() => {
    if (patients.length === 0) { setDoseCounts(null); setChildCounts(null); return; }
    let cancelled = false;
    async function loadImmunizationStats() {
      setImmLoading(true);
      const doses = { Completed: 0, Due: 0, Overdue: 0, Upcoming: 0 };
      const children = { Completed: 0, Due: 0, Overdue: 0, Upcoming: 0 };

      await Promise.all(patients.map(async (p) => {
        let immunizations = [];
        try {
          const bundle = await api.getImmunizations(p.id);
          immunizations = bundleEntries(bundle);
        } catch { /* ignore per-patient errors */ }

        const statuses = VACCINE_SCHEDULE.map(v => vaccineStatus(v, immunizations, p.birthDate).status);

        for (const s of statuses) {
          const key = s.charAt(0).toUpperCase() + s.slice(1);
          doses[key] = (doses[key] ?? 0) + 1;
        }

        // Categorize the child by their most urgent vaccine status
        let childStatus;
        if (statuses.includes('overdue'))      childStatus = 'Overdue';
        else if (statuses.includes('due'))      childStatus = 'Due';
        else if (statuses.every(s => s === 'completed')) childStatus = 'Completed';
        else                                     childStatus = 'Upcoming';
        children[childStatus] = (children[childStatus] ?? 0) + 1;
      }));

      if (!cancelled) { setDoseCounts(doses); setChildCounts(children); setImmLoading(false); }
    }
    loadImmunizationStats();
    return () => { cancelled = true; };
  }, [patients]);

  const genderCounts = patients.reduce((acc, p) => { const g = p.gender ?? 'unknown'; acc[g] = (acc[g]||0)+1; return acc; }, {});
  const donutData = [
    { label:'Male',    value: genderCounts.male    || 0, color:'#3b82f6' },
    { label:'Female',  value: genderCounts.female  || 0, color:'#f43f5e' },
    { label:'Other',   value: genderCounts.other   || 0, color:'#a855f7' },
    { label:'Unknown', value: genderCounts.unknown || 0, color:'#94a3b8' },
  ].filter(d => d.value > 0);

  const barData = doseCounts ? Object.entries(doseCounts).map(([status, count]) => ({ status, count })) : [];
  const pieData = childCounts ? Object.entries(childCounts).filter(([, v]) => v > 0).map(([status, value]) => ({ name: status, value })) : [];
  const totalChildren = pieData.reduce((s, d) => s + d.value, 0);

  const showLoading = loading || immLoading;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div><h1 className="text-2xl font-bold text-slate-900">Dashboard</h1><p className="text-slate-500 text-sm mt-0.5">Overview of patient records</p></div>
        <button onClick={onAddPatient} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 font-medium text-sm transition-colors shadow-sm"><Plus size={16}/> Add Patient</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {[['Total Patients', patients.length, Users],['Recent Records', Math.min(patients.length, 10), TrendingUp]].map(([label, val, Icon]) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 text-sm mb-3"><Icon size={15}/>{label}</div>
            <div className="text-4xl font-bold text-slate-900">{loading ? <Loader2 size={28} className="animate-spin text-slate-300"/> : val}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Vaccine doses bar chart */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="font-semibold text-slate-800 mb-1 flex items-center gap-2"><Syringe size={16} className="text-blue-600"/> Vaccine Doses by Status</h2>
          <p className="text-xs text-slate-400 mb-4">Across all patients and scheduled doses</p>
          {showLoading ? (
            <div className="flex items-center justify-center h-60"><Loader2 size={24} className="animate-spin text-slate-300"/></div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                <XAxis dataKey="status" tick={{ fontSize: 12 }} stroke="#cbd5e1"/>
                <YAxis tick={{ fontSize: 12 }} stroke="#cbd5e1" allowDecimals={false}/>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}/>
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {barData.map((d) => <Cell key={d.status} fill={VACCINE_STATUS_COLORS[d.status]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Children by vaccine status pie chart */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="font-semibold text-slate-800 mb-1 flex items-center gap-2"><Users size={16} className="text-blue-600"/> Children by Vaccine Status</h2>
          <p className="text-xs text-slate-400 mb-4">Each child grouped by most urgent status</p>
          {showLoading ? (
            <div className="flex items-center justify-center h-60"><Loader2 size={24} className="animate-spin text-slate-300"/></div>
          ) : pieData.length === 0 ? (
            <div className="flex items-center justify-center h-60 text-slate-400 text-sm">No data</div>
          ) : (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="60%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {pieData.map((d) => <Cell key={d.name} fill={VACCINE_STATUS_COLORS[d.name]}/>)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}/>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {pieData.map(d => (
                  <div key={d.name} className="flex items-center gap-2 text-sm">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: VACCINE_STATUS_COLORS[d.name] }}/>
                    <span className="text-slate-600">{d.name}</span>
                    <span className="font-semibold text-slate-900 ml-auto pl-4">{d.value}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 text-sm pt-2 border-t border-slate-100 mt-2">
                  <span className="w-3 h-3 shrink-0"/>
                  <span className="text-slate-400">Total</span>
                  <span className="font-semibold text-slate-900 ml-auto pl-4">{totalChildren}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Gender distribution */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="font-semibold text-slate-800 mb-5">Gender Distribution</h2>
        {loading ? <div className="flex items-center justify-center h-40"><Loader2 size={24} className="animate-spin text-slate-300"/></div> : <DonutChart data={donutData}/>}
      </div>
    </div>
  );
}

// ── Patients List Page ────────────────────────────────────────────────────────
function PatientsPage({ patients, loading, error, onAdd, onEdit, onDelete, onSearch, onClearSearch, searchInput, setSearchInput, searchTerm, onRetry, navigate }) {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Patients</h1>
          {!loading && !error && <p className="text-slate-500 text-sm mt-0.5">{patients.length === 0 ? (searchTerm ? `No results for "${searchTerm}"` : 'No patients yet') : `${patients.length} patient${patients.length!==1?'s':''} found${searchTerm?` for "${searchTerm}"`:''}`}</p>}
        </div>
        <button onClick={onAdd} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 font-medium text-sm transition-colors shadow-sm"><Plus size={16}/> Add Patient</button>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex gap-3 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
          <input className="w-full pl-9 pr-9 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30" placeholder="Search patients by name…" value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key==='Enter' && onSearch()}/>
          {searchInput && <button onClick={onClearSearch} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"><X size={15}/></button>}
        </div>
        <button onClick={onSearch} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors">Search</button>
      </div>
      {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-3"><AlertCircle size={17} className="shrink-0 mt-0.5"/><div className="flex-1"><p className="font-medium">Failed to load patients</p><p className="text-sm mt-0.5">{error}</p></div><button onClick={onRetry} className="text-sm underline font-medium">Retry</button></div>}
      {loading && <div className="text-center py-16 text-slate-400"><Loader2 size={30} className="animate-spin mx-auto mb-3"/><p className="text-sm">Fetching from FHIR server…</p></div>}
      {!loading && !error && patients.length===0 && (
        <div className="text-center py-16 text-slate-400 bg-white rounded-xl border border-slate-200">
          <Users size={36} className="mx-auto mb-3 opacity-20"/>
          <p className="font-medium text-slate-500 text-sm">{searchTerm ? `No patients match "${searchTerm}"` : 'No patients yet'}</p>
          {!searchTerm && <button onClick={onAdd} className="mt-3 text-blue-600 hover:underline text-sm font-medium">Add your first patient →</button>}
        </div>
      )}
      {!loading && patients.length>0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <th className="text-left px-6 py-3 font-semibold">Patient</th>
              <th className="text-left px-6 py-3 font-semibold">Gender</th>
              <th className="text-left px-6 py-3 font-semibold">Date of Birth</th>
              <th className="text-left px-6 py-3 font-semibold">FHIR ID</th>
              <th className="px-6 py-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {patients.map(p => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-3.5">
                    <button onClick={() => navigate(`/patient/${p.id}`)} className="flex items-center gap-3 hover:text-blue-600 transition-colors text-left">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${avatarColor(p.id)}`}>{initials(p)}</div>
                      <span className="font-semibold">{fullName(p)}</span>
                    </button>
                  </td>
                  <td className="px-6 py-3.5"><span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${GENDER_BADGE[p.gender]??GENDER_BADGE.unknown}`}>{p.gender??'unknown'}</span></td>
                  <td className="px-6 py-3.5 text-slate-500">{p.birthDate??'—'}</td>
                  <td className="px-6 py-3.5 text-slate-400 font-mono text-xs truncate max-w-[120px]">{p.id}</td>
                  <td className="px-6 py-3.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => navigate(`/patient/${p.id}`)} className="flex items-center gap-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg transition-colors font-medium text-xs"><ChevronRight size={12}/> View</button>
                      <button onClick={(e) => { e.stopPropagation(); onEdit(p); }} className="flex items-center gap-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg transition-colors font-medium text-xs"><Pencil size={12}/> Edit</button>
                      <button onClick={(e) => { e.stopPropagation(); onDelete(p); }} className="flex items-center gap-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors font-medium text-xs"><Trash2 size={12}/> Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add Vaccine Modal ──────────────────────────────────────────────────────────
function AddVaccineModal({ patientId, birthDate, onClose, onSaved }) {
  const [vaccineId, setVaccineId] = useState(VACCINE_SCHEDULE[0].id);
  const [dateGiven, setDateGiven] = useState('');
  const [provider,  setProvider]  = useState('');
  const [notes,     setNotes]     = useState('');
  const [errors,    setErrors]    = useState({});
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!dateGiven) errs.dateGiven = 'Date administered is required';
    else {
      const d = new Date(dateGiven);
      if (d > new Date()) errs.dateGiven = 'Date cannot be in the future';
      else if (birthDate && d < new Date(birthDate)) errs.dateGiven = "Date cannot be before patient's birth date";
    }
    if (!provider.trim()) errs.provider = 'Healthcare provider name is required';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({}); setSaving(true);

    const vaccine = VACCINE_SCHEDULE.find(v => v.id === vaccineId);
    const resource = {
      resourceType: 'Immunization',
      status: 'completed',
      vaccineCode: { text: vaccine.name },
      patient: { reference: `Patient/${patientId}` },
      occurrenceDateTime: dateGiven,
      performer: [{ actor: { display: provider.trim() } }],
      ...(notes.trim() ? { note: [{ text: notes.trim() }] } : {}),
    };

    try {
      await api.createImmunization(resource);
      setToast('Vaccine record saved!');
      setTimeout(() => onSaved(), 800);
    } catch (err) {
      setErrors({ submit: err.message });
      setSaving(false);
    }
  };

  const cls = (f) => `w-full p-3 border rounded-lg text-sm focus:outline-none focus:ring-2 transition ${errors[f] ? 'border-red-400 focus:ring-red-300' : 'border-slate-200 focus:ring-blue-400/30'}`;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 relative">
        {toast && <div className="absolute inset-x-8 top-4 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 flex items-center gap-2 text-sm font-medium z-10"><CheckCircle2 size={16}/>{toast}</div>}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold flex items-center gap-2"><Syringe size={20} className="text-blue-600"/> Add Vaccine Dose</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={22}/></button>
        </div>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Vaccine *</label>
            <select className={cls('vaccine')} value={vaccineId} onChange={e => setVaccineId(e.target.value)}>
              {VACCINE_SCHEDULE.map(v => <option key={v.id} value={v.id}>{v.name} ({v.description})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date Administered *</label>
            <input type="date" className={cls('dateGiven')} value={dateGiven} max={new Date().toISOString().split('T')[0]} onChange={e => setDateGiven(e.target.value)}/>
            {errors.dateGiven && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle size={11}/>{errors.dateGiven}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Healthcare Provider *</label>
            <input className={cls('provider')} placeholder="e.g. Dr. Smith" value={provider} onChange={e => setProvider(e.target.value)}/>
            {errors.provider && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle size={11}/>{errors.provider}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
            <textarea className={cls('notes')} rows={2} placeholder="Any observations…" value={notes} onChange={e => setNotes(e.target.value)}/>
          </div>
          {errors.submit && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex gap-2"><AlertCircle size={15} className="shrink-0 mt-0.5"/>{errors.submit}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 border border-slate-200 rounded-lg font-medium text-slate-600 hover:bg-slate-50 transition">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg font-bold transition flex items-center justify-center gap-2">
              {saving && <Loader2 size={15} className="animate-spin"/>}{saving ? 'Saving…' : 'Save Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Immunization Tracker ───────────────────────────────────────────────────────
function ImmunizationTracker({ patient, immunizations, onRefresh }) {
  const [showAdd, setShowAdd] = useState(false);

  const birthDate = patient.birthDate;
  const statuses  = VACCINE_SCHEDULE.map(v => vaccineStatus(v, immunizations, birthDate));

  const completedCount = statuses.filter(s => s.status === 'completed').length;
  const overdueCount   = statuses.filter(s => s.status === 'overdue').length;
  const pct = Math.round((completedCount / VACCINE_SCHEDULE.length) * 100);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-semibold text-slate-800 flex items-center gap-2"><Syringe size={16} className="text-blue-600"/> Vaccine Schedule</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Age: {formatAge(birthDate)} · {completedCount} of {VACCINE_SCHEDULE.length} completed ({pct}%)
          </p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus size={14}/> Add Vaccine Dose
        </button>
      </div>

      {/* Progress bar */}
      <div className="px-5 pt-4">
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }}/>
        </div>
      </div>

      {/* Overdue alert */}
      {overdueCount > 0 && (
        <div className="mx-5 mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg text-orange-700 text-sm flex items-center gap-2 font-medium">
          <AlertTriangle size={16}/> {overdueCount} vaccine{overdueCount !== 1 ? 's' : ''} overdue – schedule immediately!
        </div>
      )}

      {/* Vaccine list */}
      <div className="p-5 space-y-2">
        {statuses.map(s => {
          const cfg = STATUS_CONFIG[s.status];
          const Icon = cfg.icon;
          return (
            <div key={s.vaccine.id} className={`flex items-start justify-between gap-3 p-3 rounded-lg border ${cfg.bg} ${cfg.border}`}>
              <div className="flex items-start gap-3 min-w-0">
                <Icon size={18} className={`shrink-0 mt-0.5`} style={{ color: cfg.color }}/>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 text-sm">{s.vaccine.name} <span className="font-normal text-slate-400">({s.vaccine.description})</span></p>
                  {s.status === 'completed' && <p className="text-xs text-slate-500 mt-0.5">Given on: {s.dateGiven || '—'}</p>}
                  {s.status === 'overdue' && (
                    <p className="text-xs text-orange-600 mt-0.5">
                      Should have been given by: {fmtDate(s.dueDate)} · Overdue by {s.daysOverdue} day{s.daysOverdue !== 1 ? 's' : ''}
                    </p>
                  )}
                  {s.status === 'due' && (
                    <p className="text-xs text-blue-600 mt-0.5">
                      Due on: {fmtDate(s.dueDate)} · {s.daysUntil >= 0 ? `Due in ${s.daysUntil} day${s.daysUntil !== 1 ? 's' : ''}` : `Overdue by ${Math.abs(s.daysUntil)} day${Math.abs(s.daysUntil) !== 1 ? 's' : ''}`}
                    </p>
                  )}
                  {s.status === 'upcoming' && s.dueDate && (
                    <p className="text-xs text-slate-400 mt-0.5">Due on: {fmtDate(s.dueDate)}</p>
                  )}
                </div>
              </div>
              <span className={`text-xs font-bold uppercase px-2.5 py-1 rounded-full shrink-0 ${cfg.badge}`}>{cfg.label}</span>
            </div>
          );
        })}
      </div>

      {showAdd && (
        <AddVaccineModal
          patientId={patient.id}
          birthDate={birthDate}
          onClose={() => setShowAdd(false)}
          onSaved={async () => { setShowAdd(false); await onRefresh(); }}
        />
      )}
    </div>
  );
}

// ── Patient Detail Page ───────────────────────────────────────────────────────
function PatientDetailPage({ patientId, navigate }) {
  const [patient,      setPatient]      = useState(null);
  const [obsGroups,    setObsGroups]    = useState({});
  const [conditions,   setConditions]   = useState([]);
  const [medications,  setMedications]  = useState([]);
  const [immunizations,setImmunizations]= useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [viewMode,     setViewMode]     = useState('chart'); // 'chart' | 'table'
  const [editTarget,   setEditTarget]   = useState(null);

  const reloadImmunizations = useCallback(async () => {
    try {
      const bundle = await api.getImmunizations(patientId);
      setImmunizations(bundleEntries(bundle));
    } catch { /* non-fatal */ }
  }, [patientId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError('');
      try {
        const [pat, obsBundle, condBundle, medBundle, immBundle] = await Promise.all([
          api.getPatient(patientId),
          api.getObservations(patientId),
          api.getConditions(patientId),
          api.getMedications(patientId),
          api.getImmunizations(patientId).catch(() => ({ entry: [] })),
        ]);
        if (cancelled) return;
        setPatient(pat);
        setObsGroups(groupObs(bundleEntries(obsBundle)));
        setConditions(bundleEntries(condBundle));
        setMedications(bundleEntries(medBundle));
        setImmunizations(bundleEntries(immBundle));
      } catch (err) { if (!cancelled) setError(err.message); }
      finally       { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [patientId]);

  const conditionName = (c) =>
    c.code?.text || c.code?.coding?.[0]?.display || 'Unknown condition';
  const conditionOnset = (c) =>
    c.onsetDateTime?.slice(0,10) || c.onsetPeriod?.start?.slice(0,10) || '—';

  const medName = (m) => {
    if (m.medicationCodeableConcept?.text) return m.medicationCodeableConcept.text;
    if (m.medicationCodeableConcept?.coding?.[0]?.display) return m.medicationCodeableConcept.coding[0].display;
    if (m.medication?.concept?.text) return m.medication.concept.text;
    if (m.medication?.concept?.coding?.[0]?.display) return m.medication.concept.coding[0].display;
    return 'Unknown medication';
  };

  const STATUS_COLORS = { active:'bg-green-100 text-green-700', stopped:'bg-red-100 text-red-700', completed:'bg-slate-100 text-slate-600', 'on-hold':'bg-yellow-100 text-yellow-700' };

  if (loading) return (
    <div className="p-8 flex flex-col items-center justify-center min-h-96">
      <Loader2 size={32} className="animate-spin text-blue-500 mb-3"/>
      <p className="text-slate-400">Loading patient details…</p>
    </div>
  );

  if (error) return (
    <div className="p-8">
      <button onClick={() => navigate('/patients')} className="flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-6"><ArrowLeft size={16}/> Back to Patients</button>
      <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex gap-3"><AlertCircle size={18} className="shrink-0 mt-0.5"/>{error}</div>
    </div>
  );

  if (!patient) return null;

  return (
    <div className="p-8 max-w-6xl">
      {/* Back */}
      <button onClick={() => navigate('/patients')} className="flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-6 transition-colors">
        <ArrowLeft size={16}/> Back to Patients
      </button>

      {/* Demographics header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6 flex items-start gap-5">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold shrink-0 ${avatarColor(patient.id)}`}>{initials(patient)}</div>
        <div className="flex-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{fullName(patient)}</h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${GENDER_BADGE[patient.gender]??GENDER_BADGE.unknown}`}>{patient.gender??'unknown'}</span>
                {patient.birthDate && <span className="flex items-center gap-1"><Calendar size={13}/>{patient.birthDate}</span>}
                <span className="font-mono text-xs text-slate-400">ID: {patient.id}</span>
              </div>
              {(() => {
                const phone = patient.telecom?.find(t => t.system === 'phone')?.value;
                const email = patient.telecom?.find(t => t.system === 'email')?.value;
                if (!phone && !email) return null;
                return (
                  <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
                    {phone && <span className="flex items-center gap-1.5"><Phone size={13}/>{phone}</span>}
                    {email && <span className="flex items-center gap-1.5"><Mail size={13}/>{email}</span>}
                  </div>
                );
              })()}
            </div>
            <button onClick={() => setEditTarget(patient)} className="flex items-center gap-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg transition-colors font-medium text-sm"><Pencil size={14}/> Edit</button>
          </div>
        </div>
      </div>

      {/* Immunization Tracker */}
      <div className="mb-6">
        <ImmunizationTracker patient={patient} immunizations={immunizations} onRefresh={reloadImmunizations}/>
      </div>

      {/* Vitals section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900">Vital Signs</h2>
          {/* Chart / Table toggle */}
          <div className="flex items-center bg-slate-100 rounded-lg p-1 gap-1">
            <button onClick={() => setViewMode('chart')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode==='chart' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <BarChart2 size={14}/> Chart
            </button>
            <button onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode==='table' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <TableProperties size={14}/> Table
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {VITALS.map(vital => (
            <VitalCard key={vital.code} vital={vital} data={obsGroups[vital.code]} viewMode={viewMode}/>
          ))}
        </div>
      </div>

      {/* Conditions + Medications */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conditions */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Conditions</h2>
            <p className="text-xs text-slate-400 mt-0.5">{conditions.length} record{conditions.length!==1?'s':''}</p>
          </div>
          {conditions.length === 0
            ? <div className="text-center py-8 text-slate-400 text-sm">No conditions recorded</div>
            : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 bg-slate-50 text-slate-500 text-xs uppercase">
                  <th className="text-left px-5 py-2.5 font-semibold">Condition</th>
                  <th className="text-left px-5 py-2.5 font-semibold">Onset</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {conditions.map((c, i) => (
                    <tr key={c.id??i} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-800">{conditionName(c)}</td>
                      <td className="px-5 py-3 text-slate-500">{conditionOnset(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
        </div>

        {/* Medications */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Medications</h2>
            <p className="text-xs text-slate-400 mt-0.5">{medications.length} record{medications.length!==1?'s':''}</p>
          </div>
          {medications.length === 0
            ? <div className="text-center py-8 text-slate-400 text-sm">No medications recorded</div>
            : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 bg-slate-50 text-slate-500 text-xs uppercase">
                  <th className="text-left px-5 py-2.5 font-semibold">Medication</th>
                  <th className="text-left px-5 py-2.5 font-semibold">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {medications.map((m, i) => (
                    <tr key={m.id??i} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-800">{medName(m)}</td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[m.status]??'bg-slate-100 text-slate-600'}`}>{m.status??'—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
        </div>
      </div>

      {/* Edit modal */}
      {editTarget && (
        <PatientForm initial={editTarget} onSave={async () => { setEditTarget(null); const p = await api.getPatient(patientId); setPatient(p); }} onClose={() => setEditTarget(null)}/>
      )}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const { path, navigate } = useRouter();

  const [patients,     setPatients]     = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [searchInput,  setSearchInput]  = useState('');
  const [searchTerm,   setSearchTerm]   = useState('');
  const [formTarget,   setFormTarget]   = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting,     setDeleting]     = useState(false);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);

  const loadPatients = useCallback(async (name = '') => {
    setLoading(true); setError('');
    try { const b = await api.listPatients(name); setPatients(b.entry?.map(e=>e.resource)??[]); }
    catch (err) { setError(err.message || 'Failed to load patients'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  const handleSearch    = () => { setSearchTerm(searchInput); loadPatients(searchInput); };
  const handleClear     = () => { setSearchInput(''); setSearchTerm(''); loadPatients(''); };
  const handleSaved     = () => { setFormTarget(null); loadPatients(searchTerm); };
  const handleDeleteOk  = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await api.deletePatient(deleteTarget.id); setDeleteTarget(null); loadPatients(searchTerm); }
    catch (err) { alert(`Delete failed: ${err.message}`); }
    finally { setDeleting(false); }
  };

  // Determine active page for sidebar highlight
  const activePage = path.startsWith('/patient/') ? 'patients'
    : path === '/patients' ? 'patients'
    : 'dashboard';

  // Patient detail route
  const detailMatch = path.match(/^\/patient\/(.+)$/);

  const sharedListProps = {
    patients, loading, error,
    onAdd: () => setFormTarget(false),
    onEdit: (p) => setFormTarget(p),
    onDelete: (p) => setDeleteTarget(p),
    onSearch: handleSearch,
    onClearSearch: handleClear,
    searchInput, setSearchInput, searchTerm,
    onRetry: () => loadPatients(searchTerm),
    navigate,
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex">
      <Sidebar activePage={activePage} navigate={navigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)}/>

      <div className="flex-1 md:ml-60 min-w-0">
        {/* Topbar */}
        <header className="bg-white border-b border-slate-200 px-4 md:px-8 py-3.5 flex items-center justify-between sticky top-0 z-10">
          {/* Hamburger — mobile only */}
          <button onClick={() => setSidebarOpen(true)} className="md:hidden text-slate-500 hover:text-slate-700 p-1 -ml-1">
            <Menu size={22}/>
          </button>
          <div className="md:hidden font-bold text-slate-800 text-sm">Pediatrics Practice</div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">A</div>
            <div className="text-right hidden sm:block"><p className="text-sm font-semibold text-slate-800 leading-tight">Administrator</p><p className="text-xs text-slate-400">Admin</p></div>
          </div>
        </header>

        {/* Route rendering */}
        {detailMatch
          ? <PatientDetailPage patientId={detailMatch[1]} navigate={navigate}/>
          : path === '/patients'
            ? <PatientsPage {...sharedListProps}/>
            : <DashboardPage {...sharedListProps} onAddPatient={() => setFormTarget(false)}/>
        }
      </div>

      {formTarget !== null && <PatientForm initial={formTarget||null} onSave={handleSaved} onClose={() => setFormTarget(null)}/>}
      {deleteTarget && <DeleteConfirm patient={deleteTarget} onConfirm={handleDeleteOk} onCancel={() => setDeleteTarget(null)} deleting={deleting}/>}
    </div>
  );
}
