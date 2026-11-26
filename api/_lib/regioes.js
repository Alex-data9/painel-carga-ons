// Códigos de área de carga (cod_areacarga) segundo o dicionário de dados do ONS
// (Carga Verificada / Carga Programada): AM, AP e RR são "áreas geoelétricas".
const REGIOES = {
  AM_AP_RR: { nome: 'Amazonas + Amapá + Roraima (soma)', areas: ['AM', 'AP', 'RR'] },
  AM: { nome: 'Amazonas', areas: ['AM'] },
  AP: { nome: 'Amapá', areas: ['AP'] },
  RR: { nome: 'Roraima', areas: ['RR'] },
  N: { nome: 'Subsistema Norte (referência)', areas: ['N'] },
};
const PADRAO = 'AM_AP_RR';
module.exports = { REGIOES, PADRAO };
