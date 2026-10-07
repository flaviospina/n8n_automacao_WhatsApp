# n8n - Automação WhatsApp IA CECAPE

Workflow do atendimento automático do CECAPE via WhatsApp Cloud API, com Agente Master (classificação), agentes especialistas por aba da planilha oficial, suporte a áudio/imagem/vídeo e CRM no Google Sheets.

## Estrutura

```
workflows/
  WhatsApp_IA_CECAPE_v3.6.0.json      <- versão atual (importar esta)
  anterior/
    WhatsApp_IA_CECAPE_v3.5.7.json    <- versão anterior, só para comparação
docs/
  ANALISE_E_CORRECOES_v3.6.0.md       <- diagnóstico completo, checklist e prazos da OpenAI
scripts/
  arquivar_log_atendimentos.gs        <- Apps Script: mantém a aba LOG_ATENDIMENTOS pequena
```

## Como publicar a v3.6.0 (sem terminal)

1. No n8n, **Workflows > Import from File** e escolha `workflows/WhatsApp_IA_CECAPE_v3.6.0.json`.
2. Abra os nós com credencial e confirme que estão selecionadas: WhatsApp account (nós WhatsApp e Mídia), OpenAI - CECAPE - New (nós OpenAI/IA), Google Sheets account 2 (nós Google Sheets). O nó novo `WhatsApp - Aviso de erro ao usuário` usa a mesma credencial do WhatsApp.
3. Salve. **Desative** o workflow v3.5.7 (mesmo path `whatsapp-cecape-prod`). Ative o v3.6.0.
4. Na planilha oficial, Extensões > Apps Script: cole `scripts/arquivar_log_atendimentos.gs` e execute `criarGatilhoDiario` uma vez.
5. Faça os testes da seção 6 de `docs/ANALISE_E_CORRECOES_v3.6.0.md`.

## O que mudou na v3.6.0

- Nenhuma falha de planilha, Meta ou OpenAI derruba mais a execução sem resposta: o usuário recebe a mensagem de erro seguro e o motivo vai para a coluna `erro` do LOG_ATENDIMENTOS.
- Áudio: nome/mime do MP3 garantidos, transcrição com reserva (`gpt-transcribe`), fallback para texto se o áudio falhar.
- Timeout e retentativa em todas as chamadas externas; retentativa nas leituras do Google Sheets (cota de 60/min).
- `Salvar contato` sai do caminho crítico (roda depois da resposta).
- Reações ignoradas; indicador "gravando" experimental removido.

Prazos importantes: `gpt-4o-mini-tts` é desligado pela OpenAI em **06/01/2027** (resposta em áudio precisará de outro provedor de TTS) e `whisper-1` em **26/02/2027** (já coberto pela reserva). Detalhes em `docs/ANALISE_E_CORRECOES_v3.6.0.md`.
