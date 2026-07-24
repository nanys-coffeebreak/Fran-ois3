const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { GoogleGenAI } = require('@google/genai');
const http = require('http');

// IDs do Google Docs e Sheets do Nany's Coffee Break
const ID_PLANILHA = "1Dlw54YOcYDhd_32qyVdjCWFvHRrnCbTTyK5e9Re9SVs"; 
const ID_DOCS = "1669rGMid1xbe7wTpxZkQBgrMs2TRzjGbJUJNJA6FcO-";

// Variáveis de Ambiente configuradas no cofre do Render
const GEMINI_KEY = process.env.GEMINI_API_KEY; 
const WEBAPP_URL = process.env.GOOGLE_WEBAPP_URL;

const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

// Memória de curto prazo (últimas mensagens por cliente)
const memoriaClientes = {};
let qrAtual = '';

async function startBot() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "22.04.4"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrAtual = qr;
            console.log('🤖 Novo QR Code gerado. Acesse a URL do Render para escanear.');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            console.log('⚠️ Conexão fechada. Tentando reconectar...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            } else {
                console.log('❌ Sessão expirada. Limpe a pasta auth_info e escaneie o QR novamente.');
            }
        } else if (connection === 'open') {
            qrAtual = '';
            console.log('✅ François conectado com sucesso ao WhatsApp!');
        }
    });

    // ESCUTA DE MENSAGENS
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.endsWith('@g.us')) return;

        const remoteJid = msg.key.remoteJid;
        const numeroWhatsApp = remoteJid.replace('@s.whatsapp.net', '');
        const textoCliente = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

        if (!textoCliente) return;

        console.log(`📩 Mensagem recebida de ${numeroWhatsApp}: "${textoCliente}"`);

        // =========================================================================
        // 1. DESVIO PARA COMANDOS DA EQUIPE (Ex: "01 01 1")
        // =========================================================================
        const partes = textoCliente.split(' ');
        if (partes.length === 3 && !isNaN(partes[0]) && !isNaN(partes[1]) && !isNaN(partes[2])) {
            console.log(`⚙️ Processando comando de equipe: ${textoCliente}`);
            await processarComandoEquipe(textoCliente, sock, remoteJid);
            return; // Encerra aqui para não acionar a IA
        }

        // =========================================================================
        // 2. ATENDIMENTO AO CLIENTE (IA FRANÇOIS + ANTI-SPAM)
        // =========================================================================
        if (!memoriaClientes[numeroWhatsApp]) {
            memoriaClientes[numeroWhatsApp] = [];
        }

        memoriaClientes[numeroWhatsApp].push(`Cliente: ${textoCliente}`);
        if (memoriaClientes[numeroWhatsApp].length > 10) {
            memoriaClientes[numeroWhatsApp].shift();
        }

        try {
            // Sinalização Anti-Spam: Mostra "Digitando..." no WhatsApp do cliente
            await sock.sendPresenceUpdate('composing', remoteJid);

            // Leitura de contexto do Docs e Sheets para alimentar a IA
            const resDocs = await fetch(`https://docs.google.com/document/d/${ID_DOCS}/export?format=txt`);
            const regrasNegocio = await resDocs.text();

            const resSheets = await fetch(`https://docs.google.com/spreadsheets/d/${ID_PLANILHA}/export?format=csv`);
            const dadosPlanilha = await resSheets.text();
            
            const historicoChat = memoriaClientes[numeroWhatsApp].join('\n');
            
            const promptCompleto = `
Você é François, o atendente virtual do Nany's Coffee Break. Você age como um garçom e concierge de alto nível, acolhedor e humanizado.

DIRETRIZES DO DOCS:
${regrasNegocio}

DADOS DOS CLIENTES E PRODUTOS (Planilha):
${dadosPlanilha}

NÚMERO DO WHATSAPP DESTE CLIENTE: ${numeroWhatsApp}

INSTRUÇÕES:
1. Verifique nos DADOS DOS CLIENTES se o número ${numeroWhatsApp} já existe.
2. SE EXISTIR: Trate-o pelo nome e seja caloroso.
3. SE NÃO EXISTIR: Dê as boas-vindas e oriente de forma cortês sobre nosso Web App para pedidos.
4. Mantenha as respostas breves e refinadas.

HISTÓRICO DA CONVERSA:
${historicoChat}

Responda ao cliente (apenas a fala do François, sem prefixos):
`;
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: promptCompleto,
            });

            const respostaIA = response.text || "Peço desculpas, tive uma breve hesitação. Como posso servi-lo?";

            // Atraso intencional de 2 segundos para simular digitação humana (Anti-Spam)
            setTimeout(async () => {
                console.log(`📤 Enviando resposta para ${numeroWhatsApp}`);
                memoriaClientes[numeroWhatsApp].push(`François: ${respostaIA}`);
                await sock.sendMessage(remoteJid, { text: respostaIA });
            }, 2000);

        } catch (err) {
            console.error("❌ Erro ao processar mensagem com a IA:", err.message);
            await sock.sendMessage(remoteJid, { text: "Olá! Sou o François. Tive um pequeno ajuste técnico aqui, mas já estou à disposição. Como posso ajudar?" });
        }
    });
}

// =========================================================================
// FUNÇÃO AUXILIAR: ENVIO DE COMANDOS PARA O GOOGLE APPS SCRIPT
// =========================================================================
async function processarComandoEquipe(comandoTexto, sock, remoteJid) {
    if (!WEBAPP_URL) {
        console.error("❌ GOOGLE_WEBAPP_URL não configurada no Render.");
        await sock.sendMessage(remoteJid, { text: "⚠️ Erro: URL da planilha não configurada no servidor." });
        return;
    }

    try {
        const res = await fetch(WEBAPP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'COMANDO_EQUIPE',
                mensagem: comandoTexto
            })
        });

        const data = await res.json();
        if (data.status === 'COMANDO_ACEITO') {
            await sock.sendMessage(remoteJid, { 
                text: `✅ *Mesa Diretora NCB*\n\nComanda #${data.comanda} (Cliente ${data.cliente}) -> Status: *${data.novoStatus}*` 
            });
        } else {
            await sock.sendMessage(remoteJid, { text: "⚠️ Comando recebido, mas a planilha não confirmou a atualização." });
        }
    } catch (err) {
        console.error("❌ Erro ao enviar comando para Apps Script:", err.message);
        await sock.sendMessage(remoteJid, { text: "❌ Falha na conexão com a planilha principal." });
    }
}

// =========================================================================
// SERVIDOR WEB FACHADA (EXIBIÇÃO DO QR CODE)
// =========================================================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (qrAtual) {
        res.end(`
            <html>
                <head><title>Conectar François - Nany's Coffee Break</title></head>
                <body style="text-align:center; font-family:sans-serif; margin-top:50px; background-color:#f9f9f9;">
                    <h2>🤖 Escaneie o QR Code abaixo para conectar o François</h2>
                    <br>
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrAtual)}" alt="QR Code WhatsApp" style="border: 5px solid #fff; box-shadow: 0 4px 10px rgba(0,0,0,0.1); border-radius: 10px;"/>
                </body>
            </html>
        `);
    } else {
        res.end(`
            <html>
                <body style="text-align:center; font-family:sans-serif; margin-top:50px;">
                    <h2>✅ François está online e operando normalmente!</h2>
                </body>
            </html>
        `);
    }
}).listen(PORT, () => {
    console.log(`🌐 Servidor web rodando na porta ${PORT}`);
});

startBot();
