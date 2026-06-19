import React from "react";
import { useEffect, useState } from "react";
import { Company, Certificate } from "@/types";
import { Plus, Trash2, Edit2, Building } from "lucide-react";

export default function Companies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<Company>>({
    razaoSocial: "", nomeFantasia: "", cnpj: "", inscricaoEstadual: "",
    inscricaoMunicipal: "", email: "", telefone: "", observacoes: "",
    certificadoPrincipalId: "", certificadosAlternativosIds: []
  });

  const loadData = () => {
    fetch("/api/companies").then(r => r.json()).then(setCompanies);
    fetch("/api/certificates").then(r => r.json()).then(setCertificates);
  };

  useEffect(() => { loadData(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingId ? `/api/companies/${editingId}` : "/api/companies";
    const method = editingId ? "PUT" : "POST";

    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData)
    });

    setShowForm(false);
    setEditingId(null);
    setFormData({razaoSocial: "", nomeFantasia: "", cnpj: "", inscricaoEstadual: "", inscricaoMunicipal: "", email: "", telefone: "", observacoes: "", certificadoPrincipalId: "", certificadosAlternativosIds: []});
    loadData();
  };

  const handleEdit = (c: Company) => {
    setFormData(c);
    setEditingId(c.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if(!confirm("Remover empresa?")) return;
    await fetch(`/api/companies/${id}`, { method: "DELETE" });
    loadData();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight text-white">Empresas</h1>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="flex items-center px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 transition-all border border-transparent">
            <Plus className="h-4 w-4 mr-2" /> Nova Empresa
          </button>
        )}
      </div>

      {showForm ? (
        <div className="backdrop-blur-md bg-white/5 p-6 rounded-xl border border-white/10 shadow-xl shadow-black/10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-6">{editingId ? "Editar Empresa" : "Cadastrar Empresa"}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-y-5 gap-x-6 sm:grid-cols-2">
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Razão Social</label><input required className="block w-full rounded-md bg-black/20 border border-white/10 text-white placeholder-slate-500 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" value={formData.razaoSocial} onChange={e=>setFormData({...formData, razaoSocial: e.target.value})} /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Nome Fantasia</label><input className="block w-full rounded-md bg-black/20 border border-white/10 text-white placeholder-slate-500 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" value={formData.nomeFantasia} onChange={e=>setFormData({...formData, nomeFantasia: e.target.value})} /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">CNPJ</label><input required className="block w-full rounded-md bg-black/20 border border-white/10 text-white placeholder-slate-500 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" value={formData.cnpj} onChange={e=>setFormData({...formData, cnpj: e.target.value})} /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">E-mail</label><input type="email" className="block w-full rounded-md bg-black/20 border border-white/10 text-white placeholder-slate-500 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" value={formData.email} onChange={e=>setFormData({...formData, email: e.target.value})} /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Telefone</label><input className="block w-full rounded-md bg-black/20 border border-white/10 text-white placeholder-slate-500 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" value={formData.telefone} onChange={e=>setFormData({...formData, telefone: e.target.value})} /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Inscrição Estadual</label><input className="block w-full rounded-md bg-black/20 border border-white/10 text-white placeholder-slate-500 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" value={formData.inscricaoEstadual} onChange={e=>setFormData({...formData, inscricaoEstadual: e.target.value})} /></div>
            
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">Certificado Principal</label>
              <select className="block w-full rounded-md bg-black/20 border border-white/10 text-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none [&>option]:bg-slate-900" value={formData.certificadoPrincipalId} onChange={e=>setFormData({...formData, certificadoPrincipalId: e.target.value})}>
                <option value="" className="text-slate-500">Selecione um certificado</option>
                {certificates.map(c => <option key={c.id} value={c.id}>{c.titular} - {c.cpfCnpj}</option>)}
              </select>
            </div>
            
            <div className="sm:col-span-2 flex justify-end space-x-3 mt-4">
              <button type="button" onClick={() => {setShowForm(false); setEditingId(null);}} className="py-2 px-4 border border-white/10 rounded-lg text-sm font-medium text-slate-300 bg-white/5 hover:bg-white/10 transition-colors">Cancelar</button>
              <button type="submit" className="py-2 px-4 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 transition-all border border-transparent">Salvar Empresa</button>
            </div>
          </form>
        </div>
      ) : (
        <div className="backdrop-blur-md bg-white/5 rounded-xl border border-white/10 overflow-hidden shadow-xl shadow-black/10">
          <ul className="divide-y divide-white/10">
            {companies.map(c => (
              <li key={c.id} className="p-5 flex items-center justify-between hover:bg-white/5 transition-colors">
                <div className="flex items-center">
                  <div className="h-10 w-10 rounded bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mr-4">
                    <Building className="h-5 w-5 text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{c.razaoSocial}</p>
                    <p className="text-xs text-slate-400 mt-0.5"><span className="font-mono text-slate-500">{c.cnpj}</span> • {c.email}</p>
                  </div>
                </div>
                <div className="flex space-x-1">
                  <button onClick={() => handleEdit(c)} className="text-slate-400 hover:text-indigo-400 hover:bg-white/5 p-2 rounded-md transition-colors"><Edit2 className="h-4 w-4" /></button>
                  <button onClick={() => handleDelete(c.id)} className="text-slate-400 hover:text-red-400 hover:bg-white/5 p-2 rounded-md transition-colors"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
            {companies.length === 0 && <li className="p-8 text-center text-slate-500 text-sm">Nenhuma empresa cadastrada.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
