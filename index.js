const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { GoogleGenAI } = require('@google/genai');
const qrcode = require('qrcode-terminal');
const http = require('http');

// IDs do Google Docs e Sheets do Nany's Coffee Break
const ID_PLANILHA = "1Dlw54YOcyDhd_32qyVdjCWFvHRmCbTTyK5e9Re9SVs"; 
const ID_DOCS = "1O_669rGMid1xbe7wTpxZkQBgrMs2TRzJGbJUJNJA6Fc";

// Chave da IA injetada secretamente pelo Render
const GEMINI_KEY = process.env.GEMINI_API_KEY; 
const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

// Memória de curto prazo para as conversas do François
const memoriaClientes = {};

async function startBot() {
    // Puxa a versão mais recente do WhatsApp para evitar quedas de conexão
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: ["Ubuntu", "Chrome", "22.04.4"]
    });

    sock.ev.on('creds.update', saveCreds);

    // Gerenciador de conexão
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('🤖 Escaneie o QR Code abaixo com o seu WhatsApp:');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== 401;
            console.log('Conexão fechada. Tentando reconectar...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            } else {
                console.log('Conexão recusada. Apague a pasta auth_info e gere o QR Code novamente.');
            }
        } else if (connection === 'open') {
            console.log('✅ François conectado com sucesso ao WhatsApp!');
        }
    });

    // O coração do atendimento: Mensagens do WhatsApp
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const numeroWhatsApp = remoteJid.replace('@s.whatsapp.net', '');
        const textoCliente = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!textoCliente) return;

        // Inicializa a memória do cliente se for a primeira mensagem
        if (!memoriaClientes[numeroWhatsApp]) {
            memoriaClientes[numeroWhatsApp] = [];
        }

        memoriaClientes[numeroWhatsApp].push(`Cliente: ${textoCliente}`);
        if (memoriaClientes[numeroWhatsApp].length > 10) {
            memoriaClientes[numeroWhatsApp].shift();
        }

        try {
            // 1. Lê as diretrizes de atendimento no Google Docs
            const resDocs = await fetch(`https://docs.google.com/document/d/${ID_DOCS}/export?format=txt`);
            const regrasNegocio = await resDocs.text();

            // 2. Lê a planilha de clientes e produtos (CSV)
            const resSheets = await fetch(`https://docs.google.com/spreadsheets/d/${ID_PLANILHA}/export?format=csv`);
            const dadosPlanilha = await resSheets.text();
            
            const historicoChat = memoriaClientes[numeroWhatsApp].join('\n');
            
            // 3. Monta o prompt completo para o Gemini agir como François
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
            3. SE NÃO EXISTIR: Dê as boas-vindas e converse de forma fluida para coletar o CPF e Nome, um dado por vez, sem telas chatas. Nunca peça senha.
            
            HISTÓRICO DA CONVERSA:
            ${historicoChat}
            
            Responda agora ao cliente (apenas a fala do François, sem colocar "François:" no início):
            `;
            
            const response = await ai.models.generateContent({
                model: 'gemini-1.5-flash',
                contents: promptCompleto,
            });

            const respostaIA = response.text;

            memoriaClientes[numeroWhatsApp].push(`François: ${respostaIA}`);

            await sock.sendMessage(remoteJid, { text: respostaIA });

        } catch (err) {
            console.error("Erro ao processar mensagem com a IA:", err);
        }
    });
}

// 🌐 Servidor web de fachada obrigatório para o Render manter o bot online
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.end("François do Nany's Coffee Break rodando com sucesso!");
}).listen(PORT, () => {
    console.log(`🌐 Servidor web de fachada rodando na porta ${PORT}`);
});

startBot();
