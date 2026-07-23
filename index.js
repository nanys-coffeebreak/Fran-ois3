const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { GoogleGenAI } = require('@google/genai');
const http = require('http');

// IDs do Google Docs e Sheets do Nany's Coffee Break
const ID_PLANILHA = "1Dlw54YOcyDhd_32qyVdjCWFvHRmCbTTyK5e9Re9SVs"; 
const ID_DOCS = "1O_669rGMid1xbe7wTpxZkQBgrMs2TRzJGbJUJNJA6Fc";

// Chave da IA injetada secretamente pelo Render
const GEMINI_KEY = process.env.GEMINI_API_KEY; 
const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

// Memória de curto prazo para as conversas do François
const memoriaClientes = {};

// Variável para guardar o QR Code atual e exibir no navegador
let qrAtual = '';

async function startBot() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // Desativado no terminal para evitar distorção
        browser: ["Ubuntu", "Chrome", "22.04.4"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrAtual = qr; // Salva o QR Code para a página web
            console.log('🤖 QR Code gerado! Acesse https://fran-ois3.onrender.com no seu navegador para escanear.');
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
            qrAtual = ''; // Limpa o QR Code após conectar
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

        if (!memoriaClientes[numeroWhatsApp]) {
            memoriaClientes[numeroWhatsApp] = [];
        }

        memoriaClientes[numeroWhatsApp].push(`Cliente: ${textoCliente}`);
        if (memoriaClientes[numeroWhatsApp].length > 10) {
            memoriaClientes[numeroWhatsApp].shift();
        }

        try {
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

// 🌐 Servidor web que exibe o QR Code perfeitamente no navegador
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (qrAtual) {
        res.end(`
            <html>
                <head><title>Conectar François - Nany's Coffee Break</title></head>
                <body style="text-align:center; font-family:sans-serif; margin-top:50px; background-color:#f9f9f9;">
                    <h2>🤖 Escaneie o QR Code abaixo com o WhatsApp do Nany's</h2>
                    <br>
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrAtual)}" alt="QR Code WhatsApp" style="border: 5px solid #fff; box-shadow: 0 4px 10px rgba(0,0,0,0.1); border-radius: 10px;"/>
                    <p style="margin-top:20px; color:#666;">Abra o WhatsApp do seu celular > Aparelhos Conectados > Conectar um aparelho.</p>
                </body>
            </html>
        `);
    } else {
        res.end(`
            <html>
                <body style="text-align:center; font-family:sans-serif; margin-top:50px;">
                    <h2>✅ François já está conectado ou inicializando!</h2>
                    <p>Se o bot estiver online, esta página ficará assim. Verifique os logs no Render.</p>
                </body>
            </html>
        `);
    }
}).listen(PORT, () => {
    console.log(`🌐 Servidor web rodando na porta ${PORT}`);
});

startBot();
