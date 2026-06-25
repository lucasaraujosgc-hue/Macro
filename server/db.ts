import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const DB_FILE = path.join(process.cwd(), 'db.json');
const DB_URL = process.env.DATABASE_URL;

export interface Company {
  id: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  inscricaoEstadual: string;
  inscricaoMunicipal: string;
  email: string;
  telefone: string;
  observacoes: string;
  certificadoPrincipalId?: string;
  certificadosAlternativosIds: string[];
}

export interface Certificate {
  id: string;
  filename: string;
  passwordEncrypted: string; 
  pfxBase64?: string;
  titular: string;
  cpfCnpj: string;
  serial: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  type: 'PF' | 'PJ';
}

export interface Macro {
  id: string;
  name: string;
  steps: MacroStep[];
}

export type MacroStepType = 'navigate' | 'click' | 'type' | 'wait' | 'captcha_wait' | 'install_cert';

export interface MacroStep {
  id: string;
  type: MacroStepType;
  selector?: string;
  value?: string; 
  waitTime?: number;
}

export interface DBSchema {
  companies: Company[];
  certificates: Certificate[];
  macros: Macro[];
  files: any[]; // DownloadedFile
}

let pool: Pool | null = null;
let usePostgres = false;

if (DB_URL) {
  pool = new Pool({ connectionString: DB_URL });
  usePostgres = true;
  console.log("Using PostgreSQL Database");
} else {
  console.log("Using JSON Database fallback");
}

const defaultDB: DBSchema = { companies: [], certificates: [], macros: [], files: [] };

export async function initDB() {
  if (usePostgres && pool) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS companies (
          id VARCHAR(255) PRIMARY KEY,
          data JSONB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS certificates (
          id VARCHAR(255) PRIMARY KEY,
          data JSONB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS macros (
          id VARCHAR(255) PRIMARY KEY,
          data JSONB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS files (
          id VARCHAR(255) PRIMARY KEY,
          data JSONB NOT NULL
        );
      `);
      console.log("PostgreSQL tables created or verified.");
    } catch (e: any) {
      console.error("Failed to connect to PostgreSQL:", e.message);
      console.log("Fallback to JSON DB.");
      usePostgres = false;
    }
  }

  if (!usePostgres) {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultDB, null, 2), 'utf-8');
    }
  }
}

function readJsonDB(): DBSchema {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return defaultDB;
  }
}

function writeJsonDB(data: DBSchema) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export const db = {
  getCompanies: async (): Promise<Company[]> => {
    if (usePostgres && pool) {
      const res = await pool.query('SELECT data FROM companies');
      return res.rows.map(row => row.data);
    }
    return readJsonDB().companies;
  },
  addCompany: async (c: Company) => {
    if (usePostgres && pool) {
      await pool.query('INSERT INTO companies (id, data) VALUES ($1, $2)', [c.id, c]);
    } else {
      const data = readJsonDB();
      data.companies.push(c);
      writeJsonDB(data);
    }
  },
  updateCompany: async (id: string, c: Partial<Company>) => {
    if (usePostgres && pool) {
      const current = await pool.query('SELECT data FROM companies WHERE id = $1', [id]);
      if (current.rows.length > 0) {
        const merged = { ...current.rows[0].data, ...c };
        await pool.query('UPDATE companies SET data = $1 WHERE id = $2', [merged, id]);
      }
    } else {
      const data = readJsonDB();
      const index = data.companies.findIndex(xc => xc.id === id);
      if (index > -1) {
        data.companies[index] = { ...data.companies[index], ...c };
        writeJsonDB(data);
      }
    }
  },
  deleteCompany: async (id: string) => {
    if (usePostgres && pool) {
      await pool.query('DELETE FROM companies WHERE id = $1', [id]);
    } else {
      const data = readJsonDB();
      data.companies = data.companies.filter(c => c.id !== id);
      writeJsonDB(data);
    }
  },

  getCertificates: async (): Promise<Certificate[]> => {
    if (usePostgres && pool) {
      const res = await pool.query('SELECT data FROM certificates');
      return res.rows.map(row => row.data);
    }
    return readJsonDB().certificates;
  },
  addCertificate: async (cert: Certificate) => {
    if (usePostgres && pool) {
      await pool.query('INSERT INTO certificates (id, data) VALUES ($1, $2)', [cert.id, cert]);
    } else {
      const data = readJsonDB();
      data.certificates.push(cert);
      writeJsonDB(data);
    }
  },
  deleteCertificate: async (id: string) => {
    if (usePostgres && pool) {
      await pool.query('DELETE FROM certificates WHERE id = $1', [id]);
    } else {
      const data = readJsonDB();
      data.certificates = data.certificates.filter(c => c.id !== id);
      writeJsonDB(data);
    }
  },

  getMacros: async (): Promise<Macro[]> => {
    if (usePostgres && pool) {
      const res = await pool.query('SELECT data FROM macros');
      return res.rows.map(row => row.data);
    }
    return readJsonDB().macros;
  },
  getMacro: async (id: string): Promise<Macro | undefined> => {
    if (usePostgres && pool) {
      const res = await pool.query('SELECT data FROM macros WHERE id = $1', [id]);
      return res.rows.length ? res.rows[0].data : undefined;
    }
    return readJsonDB().macros.find(m => m.id === id);
  },
  addMacro: async (m: Macro) => {
    if (usePostgres && pool) {
      await pool.query('INSERT INTO macros (id, data) VALUES ($1, $2)', [m.id, m]);
    } else {
      const data = readJsonDB();
      data.macros.push(m);
      writeJsonDB(data);
    }
  },
  updateMacro: async (id: string, m: Partial<Macro>) => {
    if (usePostgres && pool) {
      const current = await pool.query('SELECT data FROM macros WHERE id = $1', [id]);
      if (current.rows.length > 0) {
        const merged = { ...current.rows[0].data, ...m };
        await pool.query('UPDATE macros SET data = $1 WHERE id = $2', [merged, id]);
      }
    } else {
      const data = readJsonDB();
      const index = data.macros.findIndex(xm => xm.id === id);
      if (index > -1) {
        data.macros[index] = { ...data.macros[index], ...m };
        writeJsonDB(data);
      }
    }
  },
  deleteMacro: async (id: string) => {
    if (usePostgres && pool) {
      await pool.query('DELETE FROM macros WHERE id = $1', [id]);
    } else {
      const data = readJsonDB();
      data.macros = data.macros.filter(c => c.id !== id);
      writeJsonDB(data);
    }
  },
  
  getFiles: async (): Promise<any[]> => {
    if (usePostgres && pool) {
      const res = await pool.query('SELECT data FROM files');
      return res.rows.map(row => row.data);
    }
    return readJsonDB().files || [];
  },
  addFile: async (f: any) => {
    if (usePostgres && pool) {
      await pool.query('INSERT INTO files (id, data) VALUES ($1, $2)', [f.id, f]);
    } else {
      const data = readJsonDB();
      data.files = data.files || [];
      data.files.push(f);
      writeJsonDB(data);
    }
  }
};
