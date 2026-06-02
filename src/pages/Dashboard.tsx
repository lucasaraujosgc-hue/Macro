import { useEffect, useState } from "react";
import { Certificate, Company } from "@/types";
import { Building2, KeyRound, AlertTriangle } from "lucide-react";
import { differenceInDays, parseISO } from "date-fns";

export default function Dashboard() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);

  useEffect(() => {
    fetch("/api/companies").then(r => r.json()).then(setCompanies).catch(console.error);
    fetch("/api/certificates").then(r => r.json()).then(setCertificates).catch(console.error);
  }, []);

  const getExpiringCerts = () => {
    const today = new Date();
    return certificates.filter(c => {
      const days = differenceInDays(parseISO(c.validTo), today);
      return days <= 90;
    }).sort((a,b) => parseISO(a.validTo).getTime() - parseISO(b.validTo).getTime());
  };

  const expiringCerts = getExpiringCerts();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-white mb-8">Dashboard</h1>
      
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div className="backdrop-blur-md bg-white/5 rounded-xl border border-white/10 overflow-hidden shadow-xl shadow-black/10">
          <div className="p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-indigo-500/20 border border-indigo-500/30 rounded-lg flex items-center justify-center">
                  <Building2 className="h-6 w-6 text-indigo-400" />
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400 truncate">Total de Empresas</dt>
                  <dd className="text-3xl font-bold text-white mt-1">{companies.length}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="backdrop-blur-md bg-white/5 rounded-xl border border-white/10 overflow-hidden shadow-xl shadow-black/10">
          <div className="p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-green-500/20 border border-green-500/30 rounded-lg flex items-center justify-center">
                  <KeyRound className="h-6 w-6 text-green-400" />
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400 truncate">Certificados Ativos</dt>
                  <dd className="text-3xl font-bold text-white mt-1">{certificates.length}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mt-10 mb-4">Alertas de Vencimento</h2>
      <div className="backdrop-blur-md bg-white/5 rounded-xl border border-white/10 overflow-hidden shadow-xl shadow-black/10">
        {expiringCerts.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-sm">Nenhum certificado com vencimento próximo (90 dias).</div>
        ) : (
          <ul className="divide-y divide-white/10">
            {expiringCerts.map((cert) => {
              const daysLeft = differenceInDays(parseISO(cert.validTo), new Date());
              let badgeColor = "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30";
              if (daysLeft <= 0) badgeColor = "bg-red-500/20 text-red-400 border border-red-500/30";
              else if (daysLeft <= 30) badgeColor = "bg-amber-500/20 text-amber-400 border border-amber-500/30";
              else if (daysLeft <= 60) badgeColor = "bg-amber-500/10 text-amber-500 border border-amber-500/20";

              return (
                <li key={cert.id} className="p-5 flex items-center justify-between hover:bg-white/5 transition-colors">
                  <div className="flex items-center">
                    <AlertTriangle className={`h-5 w-5 mr-4 ${daysLeft <= 0 ? 'text-red-500' : 'text-amber-500'}`} />
                    <div>
                      <p className="text-sm font-bold text-white">{cert.titular} <span className="text-xs font-normal text-slate-400 ml-2">({cert.cpfCnpj})</span></p>
                      <p className="text-xs text-slate-500 mt-1">Vence em: {parseISO(cert.validTo).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide ${badgeColor}`}>
                    {daysLeft < 0 ? "Vencido" : `${daysLeft} dias`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
