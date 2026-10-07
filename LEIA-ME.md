# n8n - Automação WhatsApp IA CECAPE

Workflow do atendimento automático do CECAPE via WhatsApp Cloud API, com Agente Master (classificação), agentes especialistas por aba da planilha oficial, suporte a áudio/imagem/vídeo e CRM no Google Sheets.

## Estrutura

```
workflows/
  WhatsApp_IA_CECAPE_v3.6.1.json      <- versão atual (importar esta)
  anterior/
    WhatsApp_IA_CECAPE_v3.6.0.json    <- versões anteriores, só para comparação
    WhatsApp_IA_CECAPE_v3.5.7.json
docs/
  ANALISE_E_CORRECOES_v3.6.0.md       <- diagnóstico completo, checklist e prazos da OpenAI
scripts/
  setup_crm_planilha.gs               <- Apps Script único: colunas, dashboard e arquivamento do LOG
```

## Como publicar a v3.6.1 (sem terminal)

1. No n8n, **Workflows > Import from File** e escolha `workflows/WhatsApp_IA_CECAPE_v3.6.1.json`.
2. Abra os nós com credencial e confirme que estão selecionadas: WhatsApp account (nós WhatsApp e Mídia), OpenAI - CECAPE - New (nós OpenAI/IA), Google Sheets account 2 (nós Google Sheets). O nó novo `WhatsApp - Aviso de erro ao usuário` usa a mesma credencial do WhatsApp.
3. Salve. **Desative** qualquer versão anterior (mesmo path `whatsapp-cecape-prod`). Ative o v3.6.1.
4. Na planilha oficial, Extensões > Apps Script: substitua o script antigo por `scripts/setup_crm_planilha.gs`, execute `setupCRM` e depois `criarGatilhoDiario` uma vez.
5. Faça os testes da seção 6 de `docs/ANALISE_E_CORRECOES_v3.6.0.md`.

## O que mudou na v3.6.1

- Cursos **on-line / EAD / a distância** consultam a aba AUTORIASCS_PLATAFORMA da planilha oficial (`1NDC8st...`).
- Cursos **presenciais** consultam a planilha mensal de cursos (`11_isrd...`), uma aba por mês.
- Pergunta sobre cursos **sem dizer a modalidade**: o bot pergunta "presencial ou on-line?" antes de responder. A resposta curta seguinte ("presencial" / "on-line") segue com a pergunta original recuperada do histórico. Perguntas de continuação na mesma conversa (30 min) reaproveitam a modalidade já informada.
- Regra implementada no prompt do classificador e, por segurança, em código no nó `Parse Classificação IA`.

## O que mudou na v3.6.0

- Nenhuma falha de planilha, Meta ou OpenAI derruba mais a execução sem resposta: o usuário recebe a mensagem de erro seguro e o motivo vai para a coluna `erro` do LOG_ATENDIMENTOS.
- Áudio: nome/mime do MP3 garantidos, transcrição com reserva (`gpt-transcribe`), fallback para texto se o áudio falhar.
- Timeout e retentativa em todas as chamadas externas; retentativa nas leituras do Google Sheets (cota de 60/min).
- `Salvar contato` sai do caminho crítico (roda depois da resposta).
- Reações ignoradas; indicador "gravando" experimental removido.

Prazos importantes: `gpt-4o-mini-tts` é desligado pela OpenAI em **06/01/2027** (resposta em áudio precisará de outro provedor de TTS) e `whisper-1` em **26/02/2027** (já coberto pela reserva). Detalhes em `docs/ANALISE_E_CORRECOES_v3.6.0.md`.
