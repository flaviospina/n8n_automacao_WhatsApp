// scripts/arquivar_log_atendimentos.gs
// Google Apps Script para a planilha oficial do CECAPE (ID 1NDC8stBwdhc0yUNZNWNiEKHTrDEq5chQqIRP0WAc2RQ).
//
// Objetivo: manter a aba LOG_ATENDIMENTOS pequena. O workflow do n8n lê essa aba
// INTEIRA a cada mensagem (para montar o histórico de 30 minutos) e também na
// atualização do CRM. Quanto maior a aba, mais lenta a resposta no WhatsApp.
//
// O script move para a aba LOG_ARQUIVO as linhas com mais de DIAS_MANTER dias,
// exceto as que ainda estão com status "Recebida" (pendentes de acompanhamento).
//
// Como instalar (sem terminal):
// 1. Abra a planilha > Extensões > Apps Script.
// 2. Crie um arquivo novo, cole este conteúdo e salve.
// 3. Execute uma vez a função criarGatilhoDiario (autorize quando pedir).
//    A partir daí, arquivarLogAtendimentos roda todo dia às 3h.
// 4. Se o DASHBOARD_CRM somar dados históricos, inclua LOG_ARQUIVO nas fórmulas.

const LOG_ABA = 'LOG_ATENDIMENTOS';
const ARQUIVO_ABA = 'LOG_ARQUIVO';
const DIAS_MANTER = 30;

function arquivarLogAtendimentos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = ss.getSheetByName(LOG_ABA);
  if (!log) throw new Error('Aba ' + LOG_ABA + ' não encontrada.');

  const dados = log.getDataRange().getValues();
  if (dados.length < 2) return;

  const cabecalho = dados[0];
  const idxTimestamp = cabecalho.indexOf('timestamp_recebida');
  const idxDataHora = cabecalho.indexOf('data_hora');
  const idxStatus = cabecalho.indexOf('status');
  if (idxTimestamp < 0 && idxDataHora < 0) {
    throw new Error('Nenhuma coluna de data encontrada (timestamp_recebida ou data_hora).');
  }

  const limite = Date.now() - DIAS_MANTER * 24 * 60 * 60 * 1000;
  const manter = [];
  const mover = [];

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const vazia = linha.every(function (v) { return v === '' || v === null; });
    if (vazia) continue;

    const dataLinha = lerData_(idxTimestamp >= 0 ? linha[idxTimestamp] : null) ||
                      lerData_(idxDataHora >= 0 ? linha[idxDataHora] : null);
    const status = idxStatus >= 0 ? String(linha[idxStatus] || '').trim() : '';
    const pendente = status === 'Recebida';

    if (dataLinha && dataLinha.getTime() < limite && !pendente) {
      mover.push(linha);
    } else {
      manter.push(linha);
    }
  }

  if (mover.length === 0) {
    Logger.log('Nada a arquivar. Linhas na aba: ' + manter.length);
    return;
  }

  let arquivo = ss.getSheetByName(ARQUIVO_ABA);
  if (!arquivo) arquivo = ss.insertSheet(ARQUIVO_ABA);
  if (arquivo.getLastRow() === 0) {
    arquivo.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  }
  arquivo.getRange(arquivo.getLastRow() + 1, 1, mover.length, cabecalho.length).setValues(mover);

  // Reescreve a aba de trabalho só com as linhas mantidas.
  log.getRange(2, 1, dados.length - 1, cabecalho.length).clearContent();
  if (manter.length > 0) {
    log.getRange(2, 1, manter.length, cabecalho.length).setValues(manter);
  }

  Logger.log('Arquivadas ' + mover.length + ' linhas. Mantidas ' + manter.length + '.');
}

// Aceita Date, ISO 8601 ("2026-10-07T14:00:00.000Z") ou "dd/mm/aaaa, hh:mm:ss".
function lerData_(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !isNaN(valor)) return valor;
  const texto = String(valor).trim();
  const br = texto.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2}):(\d{2})/);
  if (br) {
    return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), Number(br[4]), Number(br[5]), Number(br[6]));
  }
  const d = new Date(texto);
  return isNaN(d) ? null : d;
}

function criarGatilhoDiario() {
  const existentes = ScriptApp.getProjectTriggers();
  for (const t of existentes) {
    if (t.getHandlerFunction() === 'arquivarLogAtendimentos') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('arquivarLogAtendimentos').timeBased().everyDays(1).atHour(3).create();
  Logger.log('Gatilho diário criado (3h).');
}
