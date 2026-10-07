# Análise do workflow v3.5.7 e correções aplicadas na v3.6.0

Workflow: **WhatsApp IA CECAPE - Agente Master Google Sheets** (n8n, WhatsApp Cloud API, OpenAI, Google Sheets).
Sintomas relatados em 07/10/2026: respostas demoradas ou ausentes; mensagens de áudio sem nenhuma resposta.

## 1. Resumo executivo

A análise do JSON (80 nós) não mostrou nenhum modelo ou API desligado hoje. O que existe é um conjunto de pontos em que qualquer falha transitória (cota do Google Sheets, lentidão da OpenAI, erro da Meta) derruba a execução inteira **sem avisar ninguém**: o usuário não recebe nada, a planilha fica com status "Recebida" e o erro só aparece na lista de execuções do n8n. Na v3.6.0 todos esses pontos foram blindados, o caminho de áudio ganhou reservas automáticas e o fluxo responde mais rápido.

O que a v3.6.0 não consegue resolver sozinha são três causas externas que só você pode verificar na sua instância (seção 4): token do WhatsApp, saúde do n8n e saldo/limites da conta OpenAI.

## 2. Causas prováveis encontradas no workflow

### 2.1 Nós sem tratamento de erro que derrubam a execução (sem resposta)

| Nó | Problema na v3.5.7 | Efeito |
|---|---|---|
| WhatsApp - Mostrar digitando | Sem `onError`, sem timeout | Qualquer erro 4xx/5xx da Meta ou lentidão encerra a execução antes de ler contatos. Usuário fica sem resposta. |
| Google Sheets - Ler contatos, Ler log recente, Ler base oficial, Ler cursos do mês, 6 nós Docente | Sem retentativa e sem `onError` | A API do Google Sheets permite **60 leituras por minuto por usuário**. Cada mensagem faz de 4 a 10 leituras. Em testes seguidos a cota estoura, o Google devolve 429 e a execução morre. |
| Google Sheets - Salvar contato | Sem retentativa e sem `onError`, no caminho crítico | Mesmo efeito do item acima, com custo de 1 leitura + 1 escrita antes de qualquer resposta. |
| Ajustar arquivo de mídia, Preparar imagem (base64), Preparar áudio para envio | `throw` sem `onError` | Erro no binário encerra a execução sem registro no CRM. |
| Agente Master, IA Especialista, IA Variar, Transcrever, Analisar imagem | Erro vai para o CRM, mas o usuário não recebe nada | Para quem manda a mensagem, parece que o atendimento "não responde". |

### 2.2 Caminho de áudio

1. **Binário do TTS sem nome de arquivo.** O nó `OpenAI - Gerar áudio (TTS)` recebe a resposta sem cabeçalho `Content-Disposition`. Dependendo da versão do n8n, o binário chega sem `fileName`, e o nó `WhatsApp - Enviar áudio` falha com `No file name given for media upload`. Na v3.5.7 esse erro só ia para o CRM: o usuário não recebia áudio nem texto. Na v3.6.0 o nó `Preparar áudio para envio` fixa `fileName`, `fileExtension` e `mimeType` (`resposta-cecape.mp3`, `audio/mpeg`), e qualquer falha no TTS ou no envio do áudio cai para resposta em texto.
2. **Transcrição sem reserva.** `whisper-1` era o único caminho. A OpenAI anunciou em 26/08/2026 a aposentadoria do `whisper-1` (desligamento em 26/02/2027). A v3.6.0 mantém `whisper-1` como principal e, se ele falhar por qualquer motivo, repete automaticamente com `gpt-transcribe` (modelo recomendado pela OpenAI, mesmo endpoint `/v1/audio/transcriptions`).
3. **Indicador "gravando" experimental.** A Meta só aceita `typing_indicator.type = "text"`. A chamada com `"audio"` sempre devolvia 400 e gastava tempo. Removida.
4. **Sem timeout** em download de mídia, transcrição e TTS: uma chamada travada segurava a execução por minutos.

### 2.3 Lentidão

| Causa | Correção |
|---|---|
| `Salvar contato` (1 leitura + 1 escrita no Sheets) rodava **antes** de responder | Passou a rodar depois do envio, junto com a gravação do CRM. |
| `Ler log recente` lê a aba **LOG_ATENDIMENTOS inteira** a cada mensagem para montar 30 minutos de histórico. A aba cresce 1 linha por mensagem, com textos longos; quanto mais uso, mais lento. | Script `scripts/setup_crm_planilha.gs` (substitui o setup antigo) move linhas com mais de 30 dias para a aba `LOG_ARQUIVO` (gatilho diário) e o DASHBOARD_CRM passa a somar as duas abas. Mantém a aba de trabalho pequena sem perder histórico. |
| Chamadas HTTP sem timeout | Timeouts definidos: Meta 20 s (URL) e 60 s (download), OpenAI 30 a 90 s conforme o nó. |
| Chamadas à OpenAI sem retentativa em 429/5xx | 2 tentativas com 2 s de intervalo nos nós de chat, visão e TTS. |
| `Wait - Anti-spam 2s` | Mantido. São 2 s fixos em toda resposta; se quiser ganhar tempo, reduza para 1. |

### 2.4 Outros ajustes

- Reações (emoji sobre uma mensagem) chegam com `type = reaction` e caíam em "tipo não suportado", gerando uma resposta indevida. Agora são ignoradas.
- Coluna `erro` do CRM passa a registrar também o motivo quando um áudio não pôde ser enviado e a resposta foi em texto.
- Erros do Google Sheets com `onError = continuar` geram um item `{ error: ... }`; todos os nós de código que leem planilha agora descartam esse item.

## 3. Mapa das mudanças por nó

| Nó | Mudança |
|---|---|
| Extrair dados da mensagem | Ignora `reaction`. |
| WhatsApp - Mostrar digitando | `onError: continuar`, timeout 10 s. |
| Mídia - Obter URL (áudio/imagem/vídeo) | Timeout 20 s, 2 tentativas. |
| Mídia - Baixar áudio/imagem/vídeo | Timeout 60 s, 2 tentativas. |
| OpenAI - Transcrever áudio | Timeout 90 s; saída de erro vai para o novo nó de reserva. |
| OpenAI - Transcrever áudio (reserva gpt-transcribe) | **Novo.** Mesmo request com `model = gpt-transcribe`. |
| Ajustar arquivo de mídia, Preparar imagem (base64) | `onError: saída de erro` ligada ao CRM. |
| OpenAI - Analisar imagem, Agente Master, IA Especialista, IA Variar, Gerar áudio (TTS) | Timeout + 2 tentativas. |
| Preparar áudio para envio | Define nome/extensão/mime do MP3; valida tamanho; erro cai no fallback de texto. |
| WhatsApp - Enviar áudio | Saída de erro vai para `Fallback TTS - Enviar texto` (antes ia só para o CRM). |
| Fallback TTS - Enviar texto | Guarda o motivo da falha (`motivoFallbackAudio`). |
| Restaurar dados após enviar resposta / CRM - Preparar registro de resposta | Propagam o motivo para a coluna `erro`. |
| 10 nós de leitura Google Sheets | 3 tentativas (3 s), `onError: continuar`. |
| Filtrar registros, Montar contexto de cursos, Montar contexto de corpo docente, Montar histórico, Identificar contato | Descartam item de erro da planilha. |
| Google Sheets - Salvar contato | Movido para depois da resposta; 3 tentativas; falha alerta o admin. |
| CRM - Preparar dados do contato | **Novo.** Monta os campos para `Salvar contato` a partir de `Identificar contato`. |
| Restaurar dados após salvar contato | Removido (não é mais necessário). |
| CRM - Preparar registro de erro | Trata erro em formato string ou objeto; decide se avisa o usuário. |
| Preparar aviso de erro ao usuário, WhatsApp - Aviso de erro ao usuário | **Novos.** Mensagem de erro seguro para o usuário quando uma etapa crítica falha. |
| IF - Resposta será áudio?, WhatsApp - Indicador gravando (experimental) | Removidos. |
| Notas LEIA | Atualizadas com o changelog v3.6.0. |

Nenhuma credencial, ID de planilha, nome de aba, path de webhook ou prompt de IA foi alterado.

## 4. O que verificar na sua instância (não dá para corrigir pelo JSON)

Faça nesta ordem. Cada item explica o sintoma "funcionava ontem, hoje não".

1. **Token do WhatsApp (credencial "WhatsApp account").** Token temporário do painel da Meta vence em 24 h; token de usuário vence em 60 dias. Sintoma: nenhum envio sai e o log do n8n mostra `401 / Error validating access token`. Use um token de **System User** (permanente) no Business Manager.
2. **Execuções do n8n.** Abra *Executions*, filtre por *Error* nas últimas 24 h e veja em qual nó parou. Na v3.6.0 o mesmo motivo aparece na coluna `erro` do LOG_ATENDIMENTOS.
3. **Cota do Google Sheets.** Em Google Cloud Console, APIs & Services, Google Sheets API, Quotas: veja se há erros 429 "Read requests per minute per user". A v3.6.0 já faz retentativa, mas se o volume for alto é preciso espaçar os testes ou pedir aumento de cota.
4. **Conta OpenAI.** Em *Usage/Limits* confira saldo e limites de requisições. Erros 429 `insufficient_quota` derrubavam o fluxo silenciosamente na v3.5.7.
5. **Saúde do n8n.** Banco de execuções grande (áudios e imagens em base64 ficam gravados em cada execução) deixa tudo lento. Ative a limpeza de execuções (`EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168`) e confira o espaço em disco da VPS.
6. **Tamanho da aba LOG_ATENDIMENTOS.** Se tiver milhares de linhas, rode o script de arquivamento (seção 5).
7. **Dois workflows ativos no mesmo path** (`whatsapp-cecape-prod`). Desative a v3.5.7 antes de ativar a v3.6.0.

## 5. Prazos da OpenAI que vão afetar este workflow

| Modelo | Uso aqui | Desligamento | Ação |
|---|---|---|---|
| `gpt-4o-mini-tts` | Resposta em áudio | **06/01/2027** | A OpenAI indica `gpt-realtime-2.1-mini`, que só funciona via Realtime API (WebSocket), inviável no nó HTTP do n8n. Opções: Google Cloud Text-to-Speech (já há credencial Google na instância) ou ElevenLabs. Até lá a v3.6.0 continua funcionando; depois dessa data toda resposta a áudio cai automaticamente em texto. |
| `whisper-1` | Transcrição de áudio | **26/02/2027** | Já coberto: a reserva `gpt-transcribe` assume automaticamente. Depois de validar o `gpt-transcribe` em produção, inverta a ordem dos dois nós para evitar a chamada extra. |
| `gpt-4o-mini` | Classificação, especialista, visão | Sem data anunciada na API | Nada a fazer agora. |

Fontes: [Deprecations OpenAI](https://developers.openai.com/api/docs/deprecations), [aviso de desligamento do TTS](https://community.openai.com/t/tts-shutdown-email-tts-1-gpt-4o-mini-tts-jan-6-2027-isnt-on-the-deprecations-page/1402731), [whisper-1 sendo aposentado](https://github.com/labring/FastGPT/issues/7905), [guia speech-to-text (gpt-transcribe)](https://developers.openai.com/api/docs/guides/speech-to-text).

## 6. Como testar após importar

1. Importe `workflows/WhatsApp_IA_CECAPE_v3.6.0.json`. Confira as credenciais nos nós (WhatsApp, OpenAI, Google Sheets) e no nó novo `WhatsApp - Aviso de erro ao usuário`.
2. Desative a v3.5.7. Ative a v3.6.0.
3. Envie um **texto** simples ("o que é o CECAPE?"). Esperado: resposta em texto; linha no LOG com status Respondida e `tempo_resposta_segundos` preenchido.
4. Envie um **áudio** curto. Esperado: resposta em áudio. Se vier texto, abra a coluna `erro` da linha: ela diz se foi TTS ou envio e o motivo.
5. Envie uma **imagem** com legenda. Esperado: resposta reconhecendo a imagem.
6. Reaja com emoji a uma mensagem do bot. Esperado: nenhuma resposta.
7. Para simular falha, troque temporariamente o ID da planilha em `Google Sheets - Ler contatos`. Esperado: a execução segue, a pessoa recebe a mensagem de erro seguro e o admin recebe o alerta.

## 7. v3.6.1: roteamento de cursos por modalidade

| Pergunta do usuário | Categoria final | Base consultada |
|---|---|---|
| Menciona cursos **on-line**, EAD, a distância, remoto, virtual, pela plataforma, AutoriaSCS | `autoriascs_plataforma` | Planilha oficial `1NDC8st...`, aba AUTORIASCS_PLATAFORMA |
| Menciona cursos **presenciais** | `cursos_formacoes` | Planilha de cursos `11_isrd...`, abas por mês (do mês seguinte até dezembro) |
| Menciona cursos **sem modalidade** | `cursos_formacoes` com resposta direta | Nenhuma: o bot pergunta "presencial ou on-line?" |
| Responde só "presencial" ou "on-line" logo após essa pergunta | Conforme a resposta | A pergunta original é recuperada do histórico e enviada ao especialista |
| Pergunta de continuação ("e a carga horária?") em conversa que já definiu a modalidade | Conforme a modalidade anterior | Idem, sem perguntar de novo |
| Acesso/login à plataforma, sem a palavra curso | `autoriascs_plataforma` | Sem alteração |
| Inscrições, certificados, corpo docente etc. | Inalterado | Inalterado |

A regra está no prompt do classificador (campo novo `modalidade_curso` e regra 8) e, por segurança, em código no nó `Parse Classificação IA`, que prevalece sobre a IA. A mensagem da pergunta de modalidade fica em `CONFIG - Agente Master` (`mensagens.modalidade_curso`). O contexto de cursos presenciais passa a ser rotulado como PRESENCIAL para o especialista, que foi instruído a dizer a modalidade dos cursos listados.

Testes de mesa executados sobre a lógica do nó (10 cenários, todos com o resultado esperado): pergunta genérica, on-line, presencial, resposta curta "online", resposta curta "Presencial", continuação com modalidade no histórico, corpo docente, acesso à plataforma, inscrições e "formação EAD".
