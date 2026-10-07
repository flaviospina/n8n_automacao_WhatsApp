/**
 * scripts/setup_crm_planilha.gs
 * CRM de atendimento WhatsApp CECAPE - workflow n8n v3.6.0
 *
 * Substitui 100% o script anterior (setup v3.5). Um único arquivo com:
 *  1. setupCRM()                 - garante as abas LOG_ATENDIMENTOS, LOG_ARQUIVO e
 *                                  CONTATOS com todas as colunas (nada é apagado
 *                                  nem reordenado; colunas novas vão à direita).
 *  2. montarDashboard_()         - cria/atualiza a aba DASHBOARD_CRM somando
 *                                  LOG_ATENDIMENTOS + LOG_ARQUIVO (histórico completo).
 *  3. arquivarLogAtendimentos()  - move para LOG_ARQUIVO as linhas com mais de
 *                                  DIAS_MANTER dias (exceto status "Recebida"),
 *                                  mantendo a aba de trabalho pequena. O workflow lê
 *                                  LOG_ATENDIMENTOS inteira a cada mensagem; quanto
 *                                  menor, mais rápida a resposta no WhatsApp.
 *  4. criarGatilhoDiario()       - agenda o arquivamento todo dia às 3h.
 *  5. onOpen()                   - menu "CRM CECAPE" na planilha para rodar tudo
 *                                  sem abrir o editor.
 *
 * Como usar (sem terminal):
 *  1. Abra a planilha do atendimento (a mesma configurada no workflow).
 *  2. Extensões > Apps Script. Apague o conteúdo do arquivo antigo e cole este.
 *  3. Salve. Execute setupCRM() uma vez e autorize quando solicitado.
 *  4. Execute criarGatilhoDiario() uma vez.
 *  5. Recarregue a planilha: o menu "CRM CECAPE" aparece ao lado de "Ajuda".
 */

var ABA_LOG = 'LOG_ATENDIMENTOS';
var ABA_ARQUIVO = 'LOG_ARQUIVO';
var ABA_CONTATOS = 'CONTATOS';
var ABA_DASHBOARD = 'DASHBOARD_CRM';

// Linhas mais antigas que isto (em dias) saem de LOG_ATENDIMENTOS para LOG_ARQUIVO.
// O workflow só usa os últimos 30 minutos para montar o histórico da conversa,
// então qualquer valor acima de 1 dia é seguro. 30 mantém um mês visível na aba.
var DIAS_MANTER = 30;

var COLUNAS_LOG = [
  'id_mensagem',            // ID único da mensagem do WhatsApp (chave do CRM)
  'timestamp_recebida',     // ISO 8601 - momento em que a mensagem chegou
  'data_hora',              // dd/mm/aaaa, hh:mm:ss (America/Sao_Paulo)
  'numero_usuario',
  'nome_usuario',
  'formato_recebido',       // texto | áudio | imagem | vídeo | botão | interativo
  'mensagem_recebida',
  'categoria_identificada',
  'agente_acionado',
  'resposta_enviada',
  'formato_resposta',       // texto | áudio | texto (fallback TTS)
  'timestamp_resposta',     // ISO 8601 - momento do envio da resposta
  'tempo_resposta_segundos',
  'status',                 // Recebida | Respondida | Erro
  'erro',
  'encaminhamento_humano'   // Sim | Não
];

var COLUNAS_CONTATOS = [
  'numero',
  'nome',
  'primeiro_contato',
  'ultima_interacao',
  'apresentado'
];

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CRM CECAPE')
    .addItem('Setup / atualizar colunas e dashboard', 'setupCRM')
    .addItem('Arquivar log antigo agora', 'arquivarLogAtendimentos')
    .addItem('Ativar arquivamento diário (3h)', 'criarGatilhoDiario')
    .addToUi();
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function setupCRM() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  garantirAbaComColunas_(ss, ABA_LOG, COLUNAS_LOG);
  garantirAbaComColunas_(ss, ABA_ARQUIVO, COLUNAS_LOG);
  garantirAbaComColunas_(ss, ABA_CONTATOS, COLUNAS_CONTATOS);
  montarDashboard_(ss);
  Logger.log('Setup do CRM concluído. Abas: %s, %s, %s, %s', ABA_LOG, ABA_ARQUIVO, ABA_CONTATOS, ABA_DASHBOARD);
}

/**
 * Garante que a aba exista e contenha todos os cabeçalhos esperados.
 * Cabeçalhos que faltam são acrescentados à direita; nada é removido nem
 * reordenado (o node Google Sheets do n8n localiza colunas pelo nome).
 */
function garantirAbaComColunas_(ss, nomeAba, colunas) {
  var aba = ss.getSheetByName(nomeAba);
  if (!aba) {
    aba = ss.insertSheet(nomeAba);
    Logger.log('Aba criada: %s', nomeAba);
  }

  var cabecalhosAtuais = lerCabecalhos_(aba);
  var faltantes = colunas.filter(function (c) {
    return cabecalhosAtuais.indexOf(c) === -1;
  });

  if (cabecalhosAtuais.length === 0) {
    aba.getRange(1, 1, 1, colunas.length).setValues([colunas]);
    Logger.log('%s: cabeçalhos criados (%s colunas).', nomeAba, colunas.length);
  } else if (faltantes.length > 0) {
    aba.getRange(1, cabecalhosAtuais.length + 1, 1, faltantes.length).setValues([faltantes]);
    Logger.log('%s: colunas adicionadas: %s', nomeAba, faltantes.join(', '));
  } else {
    Logger.log('%s: todas as colunas já existem.', nomeAba);
  }

  aba.setFrozenRows(1);
  aba.getRange(1, 1, 1, Math.max(aba.getLastColumn(), 1))
    .setFontWeight('bold')
    .setBackground('#1a3c6e')
    .setFontColor('#ffffff');
}

/** Cabeçalhos da linha 1 (sem células vazias no fim). */
function lerCabecalhos_(aba) {
  var ultimaColuna = Math.max(aba.getLastColumn(), 1);
  var valores = aba.getRange(1, 1, 1, ultimaColuna).getValues()[0]
    .map(function (v) { return String(v).trim(); });
  // Mantém a posição original; só remove vazias do final.
  while (valores.length > 0 && valores[valores.length - 1] === '') valores.pop();
  return valores;
}

/** Letra da coluna (A, B, ..., AA) de um cabeçalho em uma aba. */
function letraColuna_(aba, nomeCabecalho) {
  var cabecalhos = lerCabecalhos_(aba);
  var idx = cabecalhos.indexOf(nomeCabecalho);
  if (idx === -1) throw new Error('Cabeçalho não encontrado em ' + aba.getName() + ': ' + nomeCabecalho);
  var n = idx + 1, letra = '';
  while (n > 0) {
    var resto = (n - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    n = Math.floor((n - 1) / 26);
  }
  return letra;
}

/* ------------------------------------------------------------------ */
/* Dashboard (LOG_ATENDIMENTOS + LOG_ARQUIVO)                          */
/* ------------------------------------------------------------------ */

function montarDashboard_(ss) {
  var log = ss.getSheetByName(ABA_LOG);
  var arq = ss.getSheetByName(ABA_ARQUIVO);
  var dash = ss.getSheetByName(ABA_DASHBOARD);
  if (!dash) dash = ss.insertSheet(ABA_DASHBOARD);
  dash.clear();

  // Faixa de uma coluna (linha 2 até o fim) em cada aba, localizada pelo nome.
  function faixaLog(nome) { return "'" + ABA_LOG + "'!" + letraColuna_(log, nome) + '2:' + letraColuna_(log, nome); }
  function faixaArq(nome) { return "'" + ABA_ARQUIVO + "'!" + letraColuna_(arq, nome) + '2:' + letraColuna_(arq, nome); }
  // As duas abas empilhadas em uma única coluna virtual.
  function ambas(nome) { return '{' + faixaLog(nome) + ';' + faixaArq(nome) + '}'; }
  function contaSe(nome, criterio) {
    return 'COUNTIF(' + faixaLog(nome) + ',' + criterio + ')+COUNTIF(' + faixaArq(nome) + ',' + criterio + ')';
  }

  var linhas = [
    ['📊 DASHBOARD CRM - Atendimento WhatsApp CECAPE', ''],
    ['Totais somam ' + ABA_LOG + ' (últimos ' + DIAS_MANTER + ' dias) + ' + ABA_ARQUIVO + ' (histórico)', ''],
    ['', ''],
    // data_hora existe em todos os registros (id_mensagem só a partir da v3.5)
    ['Total de mensagens registradas', '=COUNTA(' + faixaLog('data_hora') + ')+COUNTA(' + faixaArq('data_hora') + ')'],
    // "Respondid*" cobre "Respondida" (v3.5+) e "Respondido" (registros antigos v3.4)
    ['Respondidas', '=' + contaSe('status', '"Respondid*"')],
    ['Pendentes (recebidas sem resposta)', '=' + contaSe('status', '"Recebida"')],
    ['Com erro (verificar!)', '=' + contaSe('status', '"Erro"')],
    ['Encaminhadas para atendimento humano', '=' + contaSe('encaminhamento_humano', '"Sim"')],
    ['Contatos únicos atendidos', '=IFERROR(ROWS(UNIQUE(FILTER(' + ambas('numero_usuario') + ',' + ambas('numero_usuario') + '<>""))),0)'],
    ['Tempo médio de resposta (segundos)', '=IFERROR(ROUND(AVERAGE(ARRAYFORMULA(IFERROR(VALUE(' + ambas('tempo_resposta_segundos') + ')))),1),"-")'],
    ['Mensagens hoje', '=COUNTIF(' + faixaLog('data_hora') + ',TEXT(TODAY(),"dd/mm/yyyy")&"*")'],
    ['Mensagens nos últimos 7 dias', '=SUMPRODUCT((' + faixaLog('timestamp_recebida') + '<>"")*(IFERROR(DATEVALUE(LEFT(' + faixaLog('timestamp_recebida') + ',10)),0)>=TODAY()-7))'],
    ['Respostas em áudio', '=' + contaSe('formato_resposta', '"áudio"')],
    ['Áudios que caíram em texto (fallback)', '=' + contaSe('formato_resposta', '"texto (fallback TTS)"')],
    ['Linhas na aba de trabalho (' + ABA_LOG + ')', '=COUNTA(' + faixaLog('data_hora') + ')'],
    ['', ''],
    ['Top categorias (histórico completo)', ''],
    ['', '']
  ];

  for (var i = 0; i < linhas.length; i++) {
    dash.getRange(i + 1, 1).setValue(linhas[i][0]);
    var valor = linhas[i][1];
    if (valor) dash.getRange(i + 1, 2).setFormula(valor);
  }

  // Tabela de categorias, logo abaixo do título "Top categorias".
  var linhaTabela = linhas.length;
  dash.getRange(linhaTabela, 1).setFormula(
    '=IFERROR(QUERY({' +
      faixaLog('categoria_identificada') + ',' + faixaLog('id_mensagem') + ';' +
      faixaArq('categoria_identificada') + ',' + faixaArq('id_mensagem') + '},' +
    '"select Col1, count(Col2) where Col1 <> \'\' group by Col1 order by count(Col2) desc limit 10 ' +
    'label Col1 \'Categoria\', count(Col2) \'Mensagens\'"),"(sem dados ainda)")'
  );

  dash.getRange('A1').setFontSize(14).setFontWeight('bold');
  dash.getRange('A2').setFontStyle('italic').setFontColor('#666666');
  dash.getRange(4, 1, linhas.length - 3, 1).setFontWeight('bold');
  dash.getRange(linhaTabela - 1, 1).setFontSize(12);
  dash.setColumnWidth(1, 340);
  dash.setColumnWidth(2, 160);
  Logger.log('Dashboard montado/atualizado: %s', ABA_DASHBOARD);
}

/* ------------------------------------------------------------------ */
/* Arquivamento                                                        */
/* ------------------------------------------------------------------ */

function arquivarLogAtendimentos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(ABA_LOG);
  if (!log) throw new Error('Aba ' + ABA_LOG + ' não encontrada.');

  var dados = log.getDataRange().getValues();
  if (dados.length < 2) {
    Logger.log('Nada a arquivar: aba vazia.');
    return;
  }

  var cabLog = dados[0].map(function (v) { return String(v).trim(); });
  var idxTimestamp = cabLog.indexOf('timestamp_recebida');
  var idxDataHora = cabLog.indexOf('data_hora');
  var idxStatus = cabLog.indexOf('status');
  if (idxTimestamp < 0 && idxDataHora < 0) {
    throw new Error('Nenhuma coluna de data encontrada (timestamp_recebida ou data_hora). Rode setupCRM.');
  }

  var limite = Date.now() - DIAS_MANTER * 24 * 60 * 60 * 1000;
  var manter = [];
  var mover = [];

  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    var vazia = linha.every(function (v) { return v === '' || v === null; });
    if (vazia) continue;

    var dataLinha = lerData_(idxTimestamp >= 0 ? linha[idxTimestamp] : null) ||
                    lerData_(idxDataHora >= 0 ? linha[idxDataHora] : null);
    var status = idxStatus >= 0 ? String(linha[idxStatus] || '').trim() : '';
    var pendente = status === 'Recebida';

    if (dataLinha && dataLinha.getTime() < limite && !pendente) {
      mover.push(linha);
    } else {
      manter.push(linha);
    }
  }

  if (mover.length === 0) {
    Logger.log('Nada a arquivar. Linhas mantidas: %s', manter.length);
    return;
  }

  // Garante a aba de arquivo com TODOS os cabeçalhos do log (ordem pode diferir).
  var arq = ss.getSheetByName(ABA_ARQUIVO);
  if (!arq) {
    arq = ss.insertSheet(ABA_ARQUIVO);
    arq.getRange(1, 1, 1, cabLog.length).setValues([cabLog]);
    arq.setFrozenRows(1);
  }
  var cabArq = lerCabecalhos_(arq);
  var faltantes = cabLog.filter(function (c) { return c !== '' && cabArq.indexOf(c) === -1; });
  if (faltantes.length > 0) {
    arq.getRange(1, cabArq.length + 1, 1, faltantes.length).setValues([faltantes]);
    cabArq = lerCabecalhos_(arq);
  }

  // Copia cada linha mapeando pelo NOME do cabeçalho (nunca pela posição).
  var linhasArquivo = mover.map(function (linha) {
    var saida = new Array(cabArq.length);
    for (var c = 0; c < cabArq.length; c++) {
      var pos = cabLog.indexOf(cabArq[c]);
      saida[c] = pos >= 0 ? linha[pos] : '';
    }
    return saida;
  });

  // Grava primeiro no arquivo; só depois limpa a aba de trabalho.
  arq.getRange(arq.getLastRow() + 1, 1, linhasArquivo.length, cabArq.length).setValues(linhasArquivo);

  log.getRange(2, 1, dados.length - 1, cabLog.length).clearContent();
  if (manter.length > 0) {
    log.getRange(2, 1, manter.length, cabLog.length).setValues(manter);
  }

  Logger.log('Arquivadas %s linhas em %s. Mantidas %s em %s.', mover.length, ABA_ARQUIVO, manter.length, ABA_LOG);
}

/** Aceita Date, ISO 8601 ("2026-10-07T14:00:00.000Z") ou "dd/mm/aaaa, hh:mm:ss". */
function lerData_(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !isNaN(valor)) return valor;
  var texto = String(valor).trim();
  var br = texto.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2}):(\d{2})/);
  if (br) {
    return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), Number(br[4]), Number(br[5]), Number(br[6]));
  }
  var d = new Date(texto);
  return isNaN(d) ? null : d;
}

/** Agenda arquivarLogAtendimentos() todo dia às 3h (remove gatilhos repetidos). */
function criarGatilhoDiario() {
  var existentes = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existentes.length; i++) {
    if (existentes[i].getHandlerFunction() === 'arquivarLogAtendimentos') {
      ScriptApp.deleteTrigger(existentes[i]);
    }
  }
  ScriptApp.newTrigger('arquivarLogAtendimentos').timeBased().everyDays(1).atHour(3).create();
  Logger.log('Gatilho diário criado: arquivarLogAtendimentos às 3h.');
}
