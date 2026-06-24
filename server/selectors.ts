export const SELECTORS = {
  // Login gov.br
  loginGovBr: {
    btnCertificadoDigital: 'button:has-text("Certificado digital"), button[aria-label="Login com certificado digital"]',
  },
  // e-CAC
  ecac: {
    btnAlterarPerfil: '#btnPerfil',
    inputCnpj: '#txtCnpj',
    btnConfirmarCnpj: '#btnConfirmar',
    menuDeclaracoes: 'text="Declarações e Demonstrativos"',
    linkDctfWeb: 'text="Acessar DCTFWeb"',
  },
  // DCTFWeb
  dctfweb: {
    filtroMesAno: 'input[aria-label="Mês/Ano"]',
    btnPesquisar: 'button:has-text("Pesquisar")',
    btnEmitirDarf: 'button[aria-label="Emitir DARF"], button:has-text("Emitir DARF"), a[title="Emitir DARF"]',
  }
};
